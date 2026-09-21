# taifex-gex

用**台灣期交所公開資料**估算台指選擇權（TXO）造市商的 **Gamma 曝險（GEX）** 與
**Gamma Flip**（sticky-strike 零交叉點）。免帳號、免券商 API，每日收盤資料，
可回補歷史、可排程增量更新。

方法沿用業界標準假設（SqueezeMetrics 同款）：造市商 long call gamma、short put
gamma，用 Black-76 對每個履約價反推 IV 再算 Gamma。對照「羊叔開講」2026-08-11
公開文章的數字：全到期日加總的 GEX 排行誤差 <1%；只算最近到期日時 Gamma Flip
誤差僅 0.01%。

📈 **[互動儀表板](https://miyuz.github.io/taifex-gex/)** — 現貨/Flip/Max Pain 時序、
每日總 GEX、今日各履約價 GEX、GEX 曲線與 Max Pain 損益曲線、Call Wall/Put Wall 排行

---

## 資料現況

| | |
|---|---|
| 期間 | 2020-01-02 ~ 現在 |
| 口徑 | 只算**最近到期日**(`dte>=1` 中最小者)——跟全到期日加總的量級不同,但 Gamma Flip 位置更準 |
| 輸出 | [`data/gex_txo_daily.csv`](data/gex_txo_daily.csv) / `.parquet` |
| 交易時段 | 一般交易時段(日盤)收盤 |

---

## 快速開始

```bash
pip install -r requirements.txt
```

本專案依賴姊妹專案 [taifex-vix](https://github.com/miYuz/taifex-vix) 做到期日解析
與選擇權行情抓取,本機執行前先讓它在 `PYTHONPATH` 上找得到(GitHub Actions 的做法
見 [`daily.yml`](.github/workflows/daily.yml):另外簽出該 repo 加進 `PYTHONPATH`)。

```bash
python -m taifex_gex.cli daily --wait 45
python -m taifex_gex.build_dashboard docs/index.html
```

資料預設寫到 `D:\taifex_gex`,用環境變數改:

```bash
set TAIFEX_GEX_DATA=C:\your\path
set TAIFEX_GEX_OUT=C:\your\output\path
```

---

## 方法

1. **只取最近到期日**(`dte>=1` 中最小者):禮拜五/一/二收盤算下週三到期的週選,
   禮拜三/四收盤算週五到期,以此類推。到期當天一律看下一個到期日。

2. **Black-76** 對 forward 定價(不是對現貨的原始 BS)。理由:台指期除息季常有
   逆價差,直接拿 TAIEX 現貨當 underlying 會讓價平位置歪掉。改用 **put-call
   parity** 從選擇權結算價自己反推隱含 forward:`F = K* + (C-P)`,`K* =
   argmin|C-P|`。除息、利率效應自動被吸收進 F,不用另外抓股利資料。`r=0`
   (近月 `e^{-rT}` 影響 <0.05%)。

3. **IV 反推用結算價**,不用最後買賣價 —— 深度價外的最後買賣價常是隔很久的
   殘留報價(taifex_vix 專案已踩過這個雷),期交所結算價連冷門履約價都有合理
   理論值,反而是最乾淨的來源。

4. **GEX 符號慣例**(業界標準,SqueezeMetrics 同款):假設造市商 long call
   gamma、short put gamma:

   `GEX_strike = Σ ±(gamma × OI × 50 × S² × 1%)`(call 正、put 負)

5. **Gamma Flip** 用 sticky-strike 簡化:對一系列假設現貨價重算整條 GEX 曲線時,
   每個履約價的 IV 固定不動,只有 forward 隨假設價位等比例平移。曲線由負轉正的
   零交叉點就是 Gamma Flip。

6. **Max Pain**(跟美股版 [us-gex](https://github.com/miYuz/us-gex) 同一套定義):
   對每個實際掛牌的履約價當假設結算價 s,算全部買方(call+put)到期內含價值總額
   `Σ max(s-K,0)×OI_call + Σ max(K-s,0)×OI_put`,乘點值 50 換成 NT$;總額最小的 s 就是
   Max Pain。直接吃原始 OI,不受 IV 反推成功與否影響(反推失敗的契約未平倉量到期時
   一樣要算損益)。一樣只算最近到期日,用收盤後 OI,不是盤中即時。

7. **各履約價圖的顯示範圍自動抓有效區間**(`gex_core.active_window`):到期日越近,
   gamma 越集中在現貨附近,固定 ±10% 視窗會有大半張圖是空的。改成抓 `|GEX|` 超過
   最大值 3% 的履約價往外墊 3 檔,外框仍是 ±10%,Flip 與 Max Pain 一定在範圍內。

### 對答案:跟參考文章的誤差

用 2026-08-11 全到期日加總對照「羊叔開講」文章公開數字:

| | 文章 | 算出來 | 誤差 |
|---|---|---|---|
| 現貨 | 45,121 | 45,120.72 | ~0 |
| Gamma Flip | 44,922 | 44,845.9 | −0.17% |
| 總 GEX | +26.0 億 | +26.16 億 | +0.6% |

改成只算最近到期日之後,Gamma Flip 反而更準(44,926.3,誤差 0.01%)——這個位置本來
就是被近月契約主導的。總 GEX 量級變小是預期中的事(只算一個到期日,不是全部加總)。

### VEX(Vega 曝險)還沒解出來,暫不呈現

嘗試過兩種符號慣例(call+/put-、全面淨空),方向都對但量級跟參考文章對不上
(約文章的 1/12),精確公式沒有公開,無法反推。不確定的東西不放進儀表板,
避免看起來像可信的數字。

---

## 資料來源

| 用途 | 端點 |
|---|---|
| 選擇權每日行情 | 期交所 `/cht/3/optDailyMarketExcel?commodity_id=TXO&marketCode=0&queryDate=YYYY/MM/DD`(經 taifex-vix 抓取) |
| TAIEX 現貨收盤 | 證交所 `/rwd/zh/afterTrading/FMTQIK?date=YYYYMM01`(每日市場成交資訊,一次一整月) |

---

## 主輸出欄位

| 欄位 | 說明 |
|---|---|
| `trade_date` | 交易日 |
| `spot` | TAIEX 現貨收盤 |
| `gamma_flip` | Gamma Flip(sticky-strike 零交叉點) |
| `flip_dist` | 現貨 − Gamma Flip |
| `gex_total_e8` | 當日總 GEX(億 NT$/1%) |
| `gex_regime` | `positive`(煞車)/ `negative`(油門) |
| `max_pain` / `max_pain_dist` | 最近到期日的 Max Pain 履約價 / 現貨 − Max Pain(2020 起已回補) |
| `expiry_used` / `dte` | 採用的到期日代碼與剩餘天數 |
| `top_wall_strike` / `top_wall_gex_e8` | 正 GEX 最大的履約價(壓力/磁吸) |
| `top_accel_strike` / `top_accel_gex_e8` | 負 GEX 最大的履約價(加速點) |
| `n_contracts` / `n_iv_ok` / `iv_ok_ratio` | 當日契約數 / IV 反推成功數 / 成功率(品質指標) |

---

## 每日自動更新

[`.github/workflows/daily.yml`](.github/workflows/daily.yml) 每個交易日排三個時段
(台北 15:22 / 17:27 / 21:47,GitHub 的排程是 best-effort,錯開分鐘 + 多重備援避免
被延遲或丟掉),抓最新一個交易日、更新 CSV、重建儀表板,資料有變才 commit。

---

## 免責

本專案僅為公開資料的整理與計算,**不構成任何投資建議**。GEX 的正負號採業界標準
簡化假設(造市商 long call gamma、short put gamma),不是市場實際部位的直接觀測值。
資料來自台灣期貨交易所與證券交易所公開資訊,正確性以官方公告為準。
