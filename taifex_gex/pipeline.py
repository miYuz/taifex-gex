# -*- coding: utf-8 -*-
"""單日 GEX/VEX/Gamma Flip orchestration。

mode='all'     全部到期日加總(拿來跟文章對答案用)
mode='nearest' 只算最近到期日(dte>=1 中最小者;正式產出用這個)
"""
import os
from datetime import datetime, timedelta

import pandas as pd

from taifex_vix import expiry as vix_expiry
from taifex_vix import fetch as vix_fetch

from . import config, gex_core, taiex


def _load_option_day(d):
    """讀 taifex_vix 的 raw 快取(純吃快取,不連網)。"""
    df = vix_fetch.load_day(d, use_cache=True, allow_http=False)
    if df is None or df.empty:
        return None
    return vix_expiry.attach(df)


def run_day(d, mode="nearest", spot=None):
    """回傳 dict:summary + per_strike(DataFrame) + curve(DataFrame) + contracts(DataFrame)。

    非交易日 / 無資料 / 反推失敗回 summary['ok']=False。
    """
    if isinstance(d, datetime):
        d = d.date()

    out = {"trade_date": pd.Timestamp(d), "mode": mode, "ok": False,
           "reason": None, "spot": spot, "per_strike": pd.DataFrame(),
           "curve": pd.DataFrame(), "contracts": pd.DataFrame(),
           "gamma_flip": None, "gex_total_e8": None, "vex_total_e8": None,
           "expiries_used": None, "dte": None, "F": None,
           "max_pain": None, "pain": pd.DataFrame()}

    df = _load_option_day(d)
    if df is None:
        out["reason"] = "無選擇權行情(非交易日或快取缺失)"
        return out

    if spot is None:
        spot = taiex.fetch_day(d)
    out["spot"] = spot

    if mode == "nearest":
        df_exp, code, dte = gex_core.select_nearest_expiry(df)
        if df_exp is None:
            out["reason"] = "找不到 dte>=1 的到期日"
            return out
        contracts, meta = gex_core.prep_contracts(df_exp, dte)
        metas = [dict(meta, expiry_code=code)]
        out["expiries_used"] = str(code)
        out["dte"] = int(dte)
        out["F"] = meta.get("F")
        out["max_pain"], out["pain"] = gex_core.compute_max_pain(df_exp)
    else:  # 'all'
        cand = df[df["dte"] >= 1]
        if cand.empty:
            out["reason"] = "找不到 dte>=1 的到期日"
            return out
        parts, metas = [], []
        for (code, dte), g in cand.groupby(["expiry_code", "dte"], sort=True):
            c, meta = gex_core.prep_contracts(g, dte)
            meta["expiry_code"] = code
            metas.append(meta)
            if not c.empty:
                c = c.assign(expiry_code=code, dte=dte)
                parts.append(c)
        contracts = pd.concat(parts, ignore_index=True) if parts else pd.DataFrame()
        out["expiries_used"] = ",".join(str(m["expiry_code"]) for m in metas if m["ok"])

    if contracts.empty:
        out["reason"] = "所有到期日的契約反推都失敗"
        out["meta"] = metas
        return out

    per_strike = gex_core.aggregate_by_strike(contracts)
    F0 = float((contracts["oi"] * contracts["strike"]).sum() / contracts["oi"].sum()) \
        if spot is None else spot
    curve = gex_core.gex_curve(contracts, F0)
    flip = gex_core.find_gamma_flip(curve, contracts=contracts)

    out.update({
        "ok": True, "per_strike": per_strike, "curve": curve,
        "contracts": contracts, "gamma_flip": flip,
        "gex_total_e8": float(per_strike["gex_e8"].sum()),
        "vex_total_e8": float(per_strike["vex_e8"].sum()),
        "vex_uniform_total_e8": float(per_strike["vex_uniform_e8"].sum()),
        "meta": metas,
    })
    return out


# ---------------------------------------------------------------- backfill
def summarize_row(res):
    """把 run_day() 的完整結果壓成一列摘要,給主輸出時序表用。"""
    row = {
        "trade_date": res["trade_date"], "ok": res["ok"], "reason": res["reason"],
        "expiry_used": res["expiries_used"], "dte": res["dte"], "spot": res["spot"],
        "F": res["F"], "gamma_flip": res["gamma_flip"],
        "gex_total_e8": res["gex_total_e8"], "vex_total_e8": res["vex_total_e8"],
        "vex_uniform_total_e8": res.get("vex_uniform_total_e8"),
        "flip_dist": None, "gex_regime": None,
        "max_pain": res.get("max_pain"), "max_pain_dist": None,
        "top_wall_strike": None, "top_wall_gex_e8": None,
        "top_accel_strike": None, "top_accel_gex_e8": None,
        "n_contracts": None, "n_iv_ok": None, "iv_ok_ratio": None,
    }
    if not res["ok"]:
        return row

    if res["spot"] is not None and res["gamma_flip"] is not None:
        row["flip_dist"] = float(res["spot"] - res["gamma_flip"])
    if res["spot"] is not None and res.get("max_pain") is not None:
        row["max_pain_dist"] = float(res["spot"] - res["max_pain"])
    row["gex_regime"] = "positive" if res["gex_total_e8"] >= 0 else "negative"

    ps = res["per_strike"]
    if len(ps):
        pos = ps[ps["gex_e8"] > 0]
        neg = ps[ps["gex_e8"] < 0]
        if len(pos):
            top = pos.loc[pos["gex_e8"].idxmax()]
            row["top_wall_strike"], row["top_wall_gex_e8"] = float(top["strike"]), float(top["gex_e8"])
        if len(neg):
            bot = neg.loc[neg["gex_e8"].idxmin()]
            row["top_accel_strike"], row["top_accel_gex_e8"] = float(bot["strike"]), float(bot["gex_e8"])

    metas = res.get("meta") or []
    if metas:
        m = metas[0]
        row["n_contracts"] = m.get("n_contracts")
        row["n_iv_ok"] = m.get("n_iv_ok")
        if m.get("n_contracts"):
            row["iv_ok_ratio"] = m["n_iv_ok"] / m["n_contracts"]
    return row


def save_detail(d, res):
    """把當日 per_strike 表存進 detail/,供之後回頭查特定日期的完整履約價分佈用。"""
    if not res["ok"] or res["per_strike"].empty:
        return
    config.ensure_dirs()
    ps = res["per_strike"].copy()
    ps.insert(0, "trade_date", res["trade_date"])
    ps.to_csv(os.path.join(config.DETAIL_DIR, f"{d:%Y%m%d}.csv"),
              index=False, encoding="utf-8-sig")


def load_output():
    if not os.path.exists(config.OUT_CSV):
        return pd.DataFrame()
    return pd.read_csv(config.OUT_CSV, parse_dates=["trade_date"],
                       dtype={"expiry_used": str})


def upsert(rows):
    """以 trade_date 為 key 覆蓋寫入,重跑同一天不會產生重複列。"""
    if not rows:
        return load_output()
    config.ensure_dirs()
    new = pd.DataFrame(rows)
    old = load_output()
    if len(old):
        old = old[~old["trade_date"].isin(new["trade_date"])]
        out = pd.concat([old, new], ignore_index=True)
    else:
        out = new
    out = out.sort_values("trade_date").reset_index(drop=True)
    out.to_csv(config.OUT_CSV, index=False, encoding="utf-8-sig")
    try:
        out.to_parquet(config.OUT_PARQUET, index=False)
    except Exception as e:                 # noqa: BLE001
        print(f"[warn] parquet 寫入略過 ({e})")
    return out


def run_range(start, end, mode="nearest", skip_done=True, save_details=True,
             verbose=True):
    """逐日跑 run_day 並落地。純吃 taifex_vix 的 raw 快取,不連網抓選擇權;

    TAIEX 現貨第一次跑會逐月打 FMTQIK(有快取,之後重跑不再打)。
    回傳 (主輸出 DataFrame, 統計 dict)。
    """
    done = set()
    if skip_done:
        prev = load_output()
        if len(prev):
            done = set(pd.to_datetime(prev["trade_date"]).dt.date)

    stat = {"trading": 0, "skipped_done": 0, "non_trading": 0, "failed": 0}
    rows = []
    d = start
    while d <= end:
        if d.weekday() >= 5:
            d += timedelta(days=1)
            continue
        if d in done:
            stat["skipped_done"] += 1
            d += timedelta(days=1)
            continue
        try:
            res = run_day(d, mode=mode)
        except Exception as e:              # noqa: BLE001
            stat["failed"] += 1
            if verbose:
                print(f"  {d} 失敗: {e}")
            d += timedelta(days=1)
            continue

        if not res["ok"]:
            stat["non_trading"] += 1
            if verbose and "無選擇權行情" not in str(res["reason"]):
                print(f"  {d} 略過: {res['reason']}")
        else:
            rows.append(summarize_row(res))
            if save_details:
                save_detail(d, res)
            stat["trading"] += 1
            if verbose and stat["trading"] % 100 == 0:
                print(f"  …{d}(已完成 {stat['trading']} 個交易日)")
        d += timedelta(days=1)

    out = upsert(rows)
    if verbose:
        print(f"完成:{stat}")
    return out, stat
