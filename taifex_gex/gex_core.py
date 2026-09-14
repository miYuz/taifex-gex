# -*- coding: utf-8 -*-
"""GEX / VEX / Gamma Flip 核心計算。

模型:Black-76(對 forward 定價),理由見 README——TXF 除息季常有逆價差,
直接拿 TAIEX 現貨當 underlying 會讓價平位置歪掉。改用 put-call parity 從
選擇權結算價自己反推隱含 forward,除息/利率效應自動被吸收進 F,不用另外
抓股利資料。r=0(近月 e^{-rT} 影響 <0.05%,同 taifex_vix 的作法)。

IV 反推用**結算價**,不用最後買賣價 —— 深度價外的最後買賣價常是隔很久的
殘留報價(taifex_vix 已踩過這個雷),期交所結算價連冷門履約價都有合理理論值,
反而是最乾淨的來源。

Gamma Flip 曲線用 sticky-strike 簡化:重算不同假設現貨價時,每個履約價的
IV 固定不動,只有 forward 隨假設價位等比例平移。
"""
import math

import numpy as np
import pandas as pd
from scipy.optimize import brentq
from scipy.stats import norm

from . import config


# ---------------------------------------------------------------- Black-76
def _d1_d2(F, K, T, sigma):
    vt = sigma * math.sqrt(T)
    d1 = (math.log(F / K) + 0.5 * sigma * sigma * T) / vt
    return d1, d1 - vt


def black76_price(F, K, T, sigma, right):
    if T <= 0 or sigma <= 0 or F <= 0 or K <= 0:
        return float("nan")
    d1, d2 = _d1_d2(F, K, T, sigma)
    if right == "C":
        return F * norm.cdf(d1) - K * norm.cdf(d2)
    return K * norm.cdf(-d2) - F * norm.cdf(-d1)


def intrinsic(F, K, right):
    return max(F - K, 0.0) if right == "C" else max(K - F, 0.0)


def implied_vol(price, F, K, T, right):
    """Brent 法反推 IV。反推失敗(不收斂/低於內含價值)回 NaN。"""
    if pd.isna(price) or price <= 0 or T <= 0 or F <= 0 or K <= 0:
        return float("nan")
    if price < intrinsic(F, K, right) - 1e-6:
        return float("nan")     # 違反內含價值下限,價格本身有問題

    def f(sigma):
        return black76_price(F, K, T, sigma, right) - price

    lo, hi = config.IV_MIN, config.IV_MAX
    flo, fhi = f(lo), f(hi)
    if flo * fhi > 0:
        return float("nan")     # 反推範圍夾不住
    try:
        return brentq(f, lo, hi, maxiter=config.IV_SOLVE_MAX_ITER, xtol=1e-6)
    except Exception:                                    # noqa: BLE001
        return float("nan")


def gamma_vega(F, K, T, sigma):
    """回傳 (gamma, vega_per_1vol點)。call/put 共用同一組公式。"""
    if T <= 0 or sigma <= 0 or F <= 0 or K <= 0:
        return float("nan"), float("nan")
    d1, _ = _d1_d2(F, K, T, sigma)
    pdf = norm.pdf(d1)
    gamma = pdf / (F * sigma * math.sqrt(T))
    vega_raw = F * pdf * math.sqrt(T)          # per 1.00 (=100 vol points) 變動
    return gamma, vega_raw * 0.01              # 換成「每 1 vol 點」


# ---------------------------------------------------------------- forward
def estimate_forward_settle(df_exp):
    """單一到期日:用結算價做 put-call parity 估 F。

    K* = argmin|C-P|(結算價),F = K* + (C-P)。回傳 dict(F, K_star, n_pairs)
    或 None(沒有足夠成對的結算價)。
    """
    c = df_exp[df_exp["right"] == "C"][["strike", "settle"]].rename(
        columns={"settle": "call_settle"})
    p = df_exp[df_exp["right"] == "P"][["strike", "settle"]].rename(
        columns={"settle": "put_settle"})
    m = pd.merge(c, p, on="strike", how="inner").dropna()
    m = m[(m["call_settle"] > 0) & (m["put_settle"] > 0)]
    if m.empty:
        return None
    m = m.assign(_gap=(m["call_settle"] - m["put_settle"]).abs())
    row = m.sort_values("_gap").iloc[0]
    F = float(row["strike"] + row["call_settle"] - row["put_settle"])
    return {"F": F, "K_star": float(row["strike"]), "n_pairs": len(m)}


# ---------------------------------------------------------------- per-day prep
def select_nearest_expiry(df):
    """df 為 expiry.attach() 後的單日 tidy 表(可含多個到期日)。

    回傳 (df_nearest, expiry_code, dte)。取 dte>=1 中最小者;
    dte==0(當天已結算)一律排除。找不到合格到期日回 (None, None, None)。
    """
    cand = df[df["dte"] >= 1]
    if cand.empty:
        return None, None, None
    min_dte = int(cand["dte"].min())
    code = cand.loc[cand["dte"] == min_dte, "expiry_code"].iloc[0]
    return cand[cand["expiry_code"] == code].copy(), code, min_dte


def prep_contracts(df_exp, dte, T_days_override=None):
    """單一到期日的契約表 → 每檔加上 F/IV/gamma/vega/GEX/VEX 貢獻。

    T_days_override 給呼叫端在 dte 太小時套 config.MIN_T_DAYS 下限用。
    回傳 (contracts_df, meta_dict)。meta_dict['ok']=False 時 contracts_df 為空。
    """
    meta = {"dte": dte, "ok": False, "reason": None, "F": None, "K_star": None,
            "n_pairs": None, "n_contracts": 0, "n_iv_ok": 0}

    fwd = estimate_forward_settle(df_exp)
    if fwd is None:
        meta["reason"] = "parity 候選不足,無法估 forward(結算價成對不足)"
        return pd.DataFrame(), meta
    meta.update({"F": fwd["F"], "K_star": fwd["K_star"], "n_pairs": fwd["n_pairs"]})

    T_days = max(dte, config.MIN_T_DAYS) if T_days_override is None else T_days_override
    T = T_days / config.DAYS_PER_YEAR

    rows = []
    for r in df_exp.itertuples():
        settle = getattr(r, "settle", None)
        oi = getattr(r, "oi", None)
        if pd.isna(settle) or settle <= config.MIN_STRIKE_PRICE:
            continue
        if pd.isna(oi) or oi <= 0:
            continue
        iv = implied_vol(float(settle), fwd["F"], float(r.strike), T, r.right)
        if pd.isna(iv):
            continue
        gamma, vega = gamma_vega(fwd["F"], float(r.strike), T, iv)
        if pd.isna(gamma):
            continue
        sign = 1.0 if r.right == "C" else -1.0
        rows.append({
            "strike": float(r.strike), "right": r.right, "oi": float(oi),
            "settle": float(settle), "iv": iv, "T": T, "gamma": gamma,
            "vega_per_1pt": vega, "sign": sign,
        })
    meta["n_contracts"] = len(df_exp)
    contracts = pd.DataFrame(rows)
    meta["n_iv_ok"] = len(contracts)
    if contracts.empty:
        meta["reason"] = "所有契約 IV 反推失敗或 OI 為 0"
        return contracts, meta

    S_proxy = fwd["F"]     # dollar gamma 用 F 當現貨代理(近月 F≈S,差在合理誤差內)
    contracts["dollar_gamma_1pct"] = (contracts["gamma"] * contracts["oi"] *
                                       config.CONTRACT_MULTIPLIER *
                                       S_proxy ** 2 * 0.01 * contracts["sign"])
    contracts["dollar_vega_1pt"] = (contracts["vega_per_1pt"] * contracts["oi"] *
                                     config.CONTRACT_MULTIPLIER * contracts["sign"])
    # 另一種假設:造市商全面淨空 vega,不分 call/put(GEX 的 call+/put- 對 vega
    # 會因為 call/put vega 相等而抵消,這個版本改成兩邊都算負,不會抵消)。
    contracts["dollar_vega_uniform_1pt"] = -(contracts["vega_per_1pt"] *
                                             contracts["oi"] *
                                             config.CONTRACT_MULTIPLIER)
    meta["ok"] = True
    return contracts, meta


# ---------------------------------------------------------------- aggregation
def aggregate_by_strike(contracts):
    """逐履約價加總 GEX/VEX(億 NT$)。"""
    g = contracts.groupby("strike").agg(
        gex=("dollar_gamma_1pct", "sum"),
        vex=("dollar_vega_1pt", "sum"),
        vex_uniform=("dollar_vega_uniform_1pt", "sum"),
    ).reset_index()
    g["gex_e8"] = g["gex"] / 1e8
    g["vex_e8"] = g["vex"] / 1e8
    g["vex_uniform_e8"] = g["vex_uniform"] / 1e8
    return g.sort_values("strike").reset_index(drop=True)


def gex_curve(contracts, F0, grid_pct_range=None, grid_points=None):
    """sticky-strike:對假設現貨價網格重算總 GEX/VEX(IV 固定,F 等比例平移)。

    回傳 DataFrame(S_hyp, gex_e8, vex_e8)。
    """
    lo, hi = grid_pct_range or config.FLIP_GRID_PCT_RANGE
    n = grid_points or config.FLIP_GRID_POINTS
    grid = np.linspace(F0 * lo, F0 * hi, n)

    K = contracts["strike"].to_numpy()
    T = contracts["T"].to_numpy()
    iv = contracts["iv"].to_numpy()
    oi = contracts["oi"].to_numpy()
    sign = contracts["sign"].to_numpy()
    right = contracts["right"].to_numpy()

    gex_tot = np.empty(len(grid))
    vex_tot = np.empty(len(grid))
    for i, S_hyp in enumerate(grid):
        d1 = (np.log(S_hyp / K) + 0.5 * iv * iv * T) / (iv * np.sqrt(T))
        pdf = norm.pdf(d1)
        gamma = pdf / (S_hyp * iv * np.sqrt(T))
        vega_1pt = S_hyp * pdf * np.sqrt(T) * 0.01
        dgex = gamma * oi * config.CONTRACT_MULTIPLIER * S_hyp ** 2 * 0.01 * sign
        dvex = vega_1pt * oi * config.CONTRACT_MULTIPLIER * sign
        gex_tot[i] = dgex.sum()
        vex_tot[i] = dvex.sum()

    return pd.DataFrame({"S_hyp": grid, "gex_e8": gex_tot / 1e8,
                         "vex_e8": vex_tot / 1e8})


def _gex_total_at_S(contracts, S):
    """單一假設現貨價的總 GEX(sticky-strike,IV 固定)。給 brentq 精算零交叉用。"""
    K = contracts["strike"].to_numpy()
    T = contracts["T"].to_numpy()
    iv = contracts["iv"].to_numpy()
    oi = contracts["oi"].to_numpy()
    sign = contracts["sign"].to_numpy()
    d1 = (np.log(S / K) + 0.5 * iv * iv * T) / (iv * np.sqrt(T))
    gamma = norm.pdf(d1) / (S * iv * np.sqrt(T))
    dgex = gamma * oi * config.CONTRACT_MULTIPLIER * S ** 2 * 0.01 * sign
    return float(dgex.sum())


def find_gamma_flip(curve, contracts=None):
    """曲線由負轉正的零交叉點。找不到回 None(整條同號)。

    先用網格線性內插抓 bracket,若給了 contracts 再用 brentq 精算
    (網格解析度受限,粗內插可能有數十點誤差)。
    """
    s = curve.sort_values("S_hyp").reset_index(drop=True)
    sign = np.sign(s["gex_e8"].to_numpy())
    cross = np.where(np.diff(sign) > 0)[0]     # 負→正
    if len(cross) == 0:
        return None
    i = cross[0]
    x0, x1 = float(s["S_hyp"].iloc[i]), float(s["S_hyp"].iloc[i + 1])
    y0, y1 = s["gex_e8"].iloc[i], s["gex_e8"].iloc[i + 1]
    coarse = x0 + (0 - y0) * (x1 - x0) / (y1 - y0)

    if contracts is None:
        return float(coarse)
    try:
        return float(brentq(lambda S: _gex_total_at_S(contracts, S), x0, x1,
                            maxiter=100, xtol=1e-3))
    except Exception:                                      # noqa: BLE001
        return float(coarse)
