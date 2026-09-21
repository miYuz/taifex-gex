# -*- coding: utf-8 -*-
"""taifex_gex 進入點(排程/CI 用)。

    python -m taifex_gex.cli daily --wait 45

跟 taifex_vix.cli 的 daily 指令同一套邏輯(等結算價 → 找最近交易日 → 算 → upsert),
獨立寫一份是因為這裡用的是 taifex_gex.pipeline(nearest-expiry 口徑),
不是 taifex_vix.pipeline(VIX 口徑)。
"""
import argparse
import sys
import time
from datetime import date, datetime

if __package__ in (None, ""):
    import os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    from taifex_gex import config, pipeline, taiex
else:
    from . import config, pipeline, taiex

from taifex_vix import fetch as vix_fetch

POLL_SEC = 180


def _wait_for_settlement(wait_min, verbose=True):
    """排程用:當天是交易日但結算價還沒出時,原地等到它出來(或等到逾時)。

    非交易日(週末/假日)不會空等,直接放行讓後面退回前一個交易日。
    """
    if wait_min <= 0:
        return
    target = date.today()
    deadline = time.monotonic() + wait_min * 60
    while True:
        _, status = vix_fetch.load_day_status(target, verbose=False)
        if status == "ok":
            if verbose:
                print(f"{target} 結算價已公布 @ {datetime.now():%H:%M:%S}")
            return
        if status == "non_trading":
            if verbose:
                print(f"{target} 非交易日,不等待")
            return
        if time.monotonic() >= deadline:
            if verbose:
                print(f"等待逾時({wait_min} 分),改用前一個交易日")
            return
        if verbose:
            print(f"[wait] {datetime.now():%H:%M:%S} {target} 尚未結算,"
                 f"{POLL_SEC // 60} 分後重試")
        time.sleep(POLL_SEC)


def _latest_trading_day(lookback=10):
    """往回找最近一個有選擇權行情的交易日(跟 taifex_vix.pipeline 同款邏輯)。"""
    from datetime import timedelta
    ref = date.today()
    for i in range(lookback):
        d = ref - timedelta(days=i)
        if d.weekday() >= 5:
            continue
        if vix_fetch.load_day(d) is not None:
            return d
    return None


def cmd_daily(args):
    _wait_for_settlement(args.wait)
    d = _latest_trading_day()
    if d is None:
        print("往回 10 天都找不到交易日的選擇權行情")
        return 1

    # 大盤收盤(證交所)常常比期交所結算價晚公布,而且從 GitHub runner 看到的時間點
    # 可能又比本機晚一兩分鐘。現貨拿不到的話,寫進去的那一天現貨是空的、距離/Flip 位置
    # 都不完整,還會連同儀表板一起部署上線。所以先短暫等一下,等不到就整天不寫入,
    # 網站維持上一個完整交易日,下一個排程時段再補。
    spot = taiex.fetch_day(d)
    if spot is None and d == date.today() and args.wait > 0:
        deadline = time.monotonic() + min(args.wait, 20) * 60
        while spot is None and time.monotonic() < deadline:
            print(f"[wait] {datetime.now():%H:%M:%S} {d} TAIEX 收盤尚未公布,{POLL_SEC // 60} 分後重試")
            time.sleep(POLL_SEC)
            spot = taiex.fetch_day(d)
    if spot is None:
        print(f"{d} TAIEX 收盤還沒公布,不寫入這一天(保留上一個完整交易日,等下一個排程時段)")
        return 0

    res = pipeline.run_day(d, mode="nearest", spot=spot)
    if not res["ok"]:
        print(f"{d} 算不出來: {res['reason']}")
        return 1

    row = pipeline.summarize_row(res)
    pipeline.save_detail(d, res)
    out = pipeline.upsert([row])
    flip = row.get("gamma_flip")
    print(f"{d}  spot={row.get('spot')}  flip={flip if flip is None else round(flip, 1)}  "
         f"gex={row.get('gex_total_e8')}  regime={row.get('gex_regime')}  "
         f"expiry={row.get('expiry_used')}  dte={row.get('dte')}")
    print(f"主輸出共 {len(out)} 列 → {config.OUT_CSV}")
    return 0


def main(argv=None):
    p = argparse.ArgumentParser(prog="taifex_gex", description="TXO → 最近到期日 GEX/Gamma Flip")
    sub = p.add_subparsers(dest="cmd", required=True)

    dl = sub.add_parser("daily", help="抓最近一個交易日並 append")
    dl.add_argument("--wait", type=int, default=0, metavar="分鐘",
                    help="當天結算價還沒出時,最多等幾分鐘(排程用,預設 0=不等)")
    dl.set_defaults(func=cmd_daily)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
