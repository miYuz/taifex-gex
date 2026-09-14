# -*- coding: utf-8 -*-
"""由主輸出 CSV 重建互動儀表板 HTML。

    python -m taifex_gex.build_dashboard [輸出路徑]

樣板放在 taifex_gex/dashboard/ 底下,結構仿 taifex_vix/build_dashboard.py:
    template_head.html  版面 + CSS + 靜態結構
    template_tail.js    繪圖與互動邏輯
全部圖表都是純 SVG,由前端 JS 直接吃 JSON payload 畫出來,不內嵌任何截圖 ——
資料每次重建都反映當下抓到的最新內容。只吃期交所/證交所公開資料,沒有任何
需要帳密的相依,可以放心跑在 GitHub Actions 的公開 runner 上。
"""
import json
import os
import re
import sys

import pandas as pd

if __package__ in (None, ""):
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from taifex_gex import pipeline
else:
    from . import pipeline

TPL_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dashboard")
DEFAULT_OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "gex_dashboard.html")

STRIKE_WINDOW_PCT = 0.10   # 各履約價 GEX 圖只顯示「現貨/Flip 中價」±10%,深度價外剪掉


def build_payload(df):
    df = df.sort_values("trade_date").reset_index(drop=True)

    def col(c, nd=1):
        if c not in df.columns:
            return [None] * len(df)
        return [None if pd.isna(v) else round(float(v), nd) for v in df[c]]

    def icol(c):
        if c not in df.columns:
            return [None] * len(df)
        return [None if pd.isna(v) else int(v) for v in df[c]]

    def scol(c):
        if c not in df.columns:
            return [None] * len(df)
        return [None if pd.isna(v) else str(v) for v in df[c]]

    return {
        "d": [d.strftime("%Y-%m-%d") for d in df.trade_date],
        "spot": col("spot", 2), "flip": col("gamma_flip", 1),
        "flip_dist": col("flip_dist", 1), "gex": col("gex_total_e8", 2),
        "regime": scol("gex_regime"), "expiry": scol("expiry_used"), "dte": icol("dte"),
    }


def _build_snapshot_payload(df, verbose=True):
    """最新一個交易日的「各履約價 GEX」+「GEX vs 假設價位曲線」——比照原始參考
    文章四格圖裡左邊那兩張。這兩張本質是單日快照,不是時序,所以跟 DATA
    分開存,前端畫一次就好,不吃日期區間篩選。

    各履約價圖只留「現貨/Flip 中價」±15% 範圍內的履約價:到期日越遠的月選常常有
    300+ 檔履約價,絕大部分深度價外幾乎是 0,全部畫出來只會讓圖擠成一片看不出重點。
    用中價(而不是單看現貨)當窗口中心,現貨、Flip 兩條線才都穩穩落在可視範圍內
    ——如果哪天 flip_dist 拉得比較開,單用現貨當中心可能會把 flip 那條線切到窗外。
    """
    latest = df["trade_date"].max().date()
    res = pipeline.run_day(latest, mode="nearest")
    if not res["ok"]:
        if verbose:
            print(f"[warn] 最新交易日快照算不出來: {res['reason']}")
        return None

    ps = res["per_strike"]
    curve = res["curve"]
    spot, flip = res["spot"], res["gamma_flip"]
    mid = None
    if spot is not None and flip is not None:
        mid = (spot + flip) / 2
    elif spot is not None:
        mid = spot
    if mid is not None:
        lo, hi = mid * (1 - STRIKE_WINDOW_PCT), mid * (1 + STRIKE_WINDOW_PCT)
        ps = ps[(ps["strike"] >= lo) & (ps["strike"] <= hi)]

    return {
        "date": latest.strftime("%Y-%m-%d"),
        "spot": round(float(spot), 1) if spot is not None else None,
        "flip": round(float(flip), 1) if flip is not None else None,
        "expiry": res["expiries_used"], "dte": res["dte"],
        "strike": [float(v) for v in ps["strike"]],
        "strike_gex": [round(float(v), 3) for v in ps["gex_e8"]],
        "curve_x": [round(float(v), 1) for v in curve["S_hyp"]],
        "curve_gex": [round(float(v), 3) for v in curve["gex_e8"]],
    }


def build(out_path=None, verbose=True):
    out_path = out_path or DEFAULT_OUT
    df = pipeline.load_output()
    if df.empty:
        raise RuntimeError("主輸出是空的,請先跑 backfill")
    df["trade_date"] = pd.to_datetime(df["trade_date"])

    payload = build_payload(df)

    try:
        snapshot = _build_snapshot_payload(df, verbose=verbose)
    except Exception as e:                          # noqa: BLE001
        snapshot = None
        if verbose:
            print(f"[warn] 最新一日 GEX 快照略過(不影響主圖表): {e}")

    head = open(os.path.join(TPL_DIR, "template_head.html"), encoding="utf-8").read()
    tail = open(os.path.join(TPL_DIR, "template_tail.js"), encoding="utf-8").read()

    head = _patch_footer(head, df)

    data_js = "const DATA = " + json.dumps(payload, separators=(",", ":")) + ";\n"
    data_js += "const SNAPSHOT = " + json.dumps(snapshot, separators=(",", ":")) + ";"
    html = head + "\n<script>\n" + data_js + "\n" + tail + "\n</" + "script>\n"
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)
    if verbose:
        print(f"儀表板已重建: {out_path}  ({len(html):,} bytes, "
              f"{len(df)} 個交易日, 最後 {df.trade_date.max():%Y-%m-%d}"
              f"{', 含最新日 GEX 快照' if snapshot else ''})")
    return out_path


def _patch_footer(head, df):
    new = (f"資料 {df.trade_date.min():%Y-%m-%d} ~ {df.trade_date.max():%Y-%m-%d},"
           f"共 {len(df)} 個交易日(只算最近到期日)。")
    return re.sub(r'<div id="footerRange">.*?</div>',
                  f'<div id="footerRange">{new}</div>', head, flags=re.S)


def main(argv=None):
    argv = argv or sys.argv[1:]
    build(argv[0] if argv else None)
    return 0


if __name__ == "__main__":
    sys.exit(main())
