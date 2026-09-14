# -*- coding: utf-8 -*-
"""taifex_gex 設定。

選擇權原始行情**直接讀 taifex_vix 的 raw 快取**(D:\\taifex_vix\\raw),不重複抓。
GEX 自己的輸出(TAIEX 現貨快取、每日 GEX/VEX 序列)落在獨立的 DATA_ROOT,
跟 taifex_vix 的產出分開,兩個專案互不干擾。

路徑分兩類,可各自用環境變數覆蓋(仿 taifex_vix 的做法,GitHub Actions 用得到):
    TAIFEX_GEX_DATA  快取與診斷檔(TAIEX 月檔、逐日明細),體積較大,不進版控
    TAIFEX_GEX_OUT   主輸出 CSV/parquet(小,要進版控);預設跟 DATA_ROOT 同位置
"""
import os

from taifex_vix import config as vix_config  # 借用 SSL bootstrap + raw 行情路徑

DATA_ROOT = os.environ.get("TAIFEX_GEX_DATA", r"D:\taifex_gex")
META_DIR = os.path.join(DATA_ROOT, "meta")
DETAIL_DIR = os.path.join(DATA_ROOT, "detail")

# 設 TAIFEX_GEX_OUT 指到 repo 的 data/,每日更新就直接寫進版控目錄,
# commit 前不用再搬檔案(GitHub Actions 用)。
OUT_DIR = os.environ.get("TAIFEX_GEX_OUT", DATA_ROOT)
OUT_CSV = os.path.join(OUT_DIR, "gex_txo_daily.csv")
OUT_PARQUET = os.path.join(OUT_DIR, "gex_txo_daily.parquet")

# 選擇權行情直接沿用 taifex_vix 的 raw 快取,不新建
OPT_RAW_DIR = vix_config.RAW_DIR

# ---- TAIEX 現貨端點 ----
TAIEX_URL = ("https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX"
             "?date={ymd}&type=IND&response=json")
TAIEX_ROW_LABEL = "發行量加權股價指數"

USER_AGENT = "Mozilla/5.0"
HTTP_TIMEOUT = 60

# ---- 契約規格 ----
CONTRACT_MULTIPLIER = 50.0   # TXO:新台幣 50 元 / 點
RISK_FREE = 0.0              # 近月 e^{-rT} 影響 <0.05%,取 0(同 taifex_vix)
DAYS_PER_YEAR = 365.0
MIN_T_DAYS = 0.5              # T 下限(日),避免到期日當天除以 0

# IV 反推的品質閘門
MIN_STRIKE_PRICE = 0.01       # 結算價 <= 0 的契約直接跳過
IV_MIN, IV_MAX = 0.01, 3.0    # 反推收斂範圍,超出視為失敗
IV_SOLVE_MAX_ITER = 100

# Gamma Flip 曲線的假設價位網格(相對現貨的比例範圍)
FLIP_GRID_PCT_RANGE = (0.80, 1.15)
FLIP_GRID_POINTS = 400


def ensure_dirs():
    for d in (DATA_ROOT, META_DIR, DETAIL_DIR, OUT_DIR):
        os.makedirs(d, exist_ok=True)
    return DATA_ROOT
