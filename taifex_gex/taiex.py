# -*- coding: utf-8 -*-
"""TAIEX(加權指數)每日收盤,GEX 的現貨基準。

端點(實測):
    GET https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date=YYYYMM01&response=json
    「每日市場成交資訊」,一次回傳整個月,第 5 欄是『發行量加權股價指數』收盤。
    一次一整月,回補歷史時只需要 ~80 個請求(2020 年起),不用逐日打。
    日期是民國年(115/08/03),要轉西元。

跟 taifex_vix/twse.py 抓的 0050 是不同端點 —— 0050 是 ETF 價格,這裡要的是
指數本身(文章對照的「現貨 S」用的就是這個)。
"""
import os
import time
from datetime import date

import pandas as pd

from . import config
import requests  # noqa: E402 (config import 先跑過 SSL bootstrap)

FMTQIK_URL = "https://www.twse.com.tw/rwd/zh/afterTrading/FMTQIK?date={ym}01&response=json"


def _cache_path(y, m):
    return os.path.join(config.META_DIR, f"taiex_{y}{m:02d}.csv")


def fetch_month(y, m, use_cache=True):
    """單月 TAIEX 收盤 → DataFrame(trade_date, taiex_close)。查無資料回空表。"""
    config.ensure_dirs()
    cp = _cache_path(y, m)
    fresh = (y, m) == (date.today().year, date.today().month)
    if use_cache and os.path.exists(cp) and not fresh:
        return pd.read_csv(cp, parse_dates=["trade_date"])

    url = FMTQIK_URL.format(ym=f"{y}{m:02d}")
    r = requests.get(url, headers={"User-Agent": config.USER_AGENT},
                     timeout=config.HTTP_TIMEOUT)
    r.raise_for_status()
    r.encoding = "utf-8"
    time.sleep(0.5)
    j = r.json()
    if j.get("stat") != "OK" or not j.get("data"):
        return pd.DataFrame(columns=["trade_date", "taiex_close"])

    rows = []
    for rec in j["data"]:
        try:
            roc_y, mm, dd = rec[0].split("/")
            d = date(int(roc_y) + 1911, int(mm), int(dd))
            close = float(str(rec[4]).replace(",", ""))
        except (ValueError, IndexError):
            continue
        rows.append({"trade_date": pd.Timestamp(d), "taiex_close": close})
    out = pd.DataFrame(rows)
    if len(out) and not fresh:
        out.to_csv(cp, index=False, encoding="utf-8-sig")
    return out


def load_range(start, end, verbose=True):
    """區間收盤(逐月抓,有快取)。回傳 DataFrame(trade_date, taiex_close)。"""
    frames = []
    y, m = start.year, start.month
    while (y, m) <= (end.year, end.month):
        try:
            d = fetch_month(y, m)
            if len(d):
                frames.append(d)
        except Exception as e:                      # noqa: BLE001
            if verbose:
                print(f"[warn] TAIEX {y}-{m:02d} 取得失敗: {e}")
        m += 1
        if m == 13:
            y, m = y + 1, 1
    if not frames:
        return pd.DataFrame(columns=["trade_date", "taiex_close"])
    out = (pd.concat(frames, ignore_index=True)
             .drop_duplicates("trade_date")
             .sort_values("trade_date")
             .reset_index(drop=True))
    return out[(out.trade_date >= pd.Timestamp(start)) &
               (out.trade_date <= pd.Timestamp(end))].reset_index(drop=True)


def fetch_day(d, use_cache=True):
    """單日 TAIEX 收盤(內部走月快取)。非交易日或查無資料回 None。"""
    if isinstance(d, pd.Timestamp):
        d = d.date()
    if d.weekday() >= 5:
        return None
    month_df = fetch_month(d.year, d.month, use_cache=use_cache)
    if month_df.empty:
        return None
    hit = month_df.loc[month_df["trade_date"] == pd.Timestamp(d), "taiex_close"]
    return float(hit.iloc[0]) if len(hit) else None
