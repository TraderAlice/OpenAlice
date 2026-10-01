"""HK (and optional US/CN/SG) trading calendar via Longbridge OpenAPI.

Usage:
  py -3 hk_calendar.py
  py -3 hk_calendar.py --markets HK,US --out hk_calendar.json

Credentials (env only — never commit):
  LONGPORT_APP_KEY, LONGPORT_APP_SECRET, LONGPORT_ACCESS_TOKEN

Always exits 0 so collect.ps1 can continue on MISSING.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from typing import Iterable

CST = timezone(timedelta(hours=8))
# Longbridge trading_days rejects windows >= 1 month.
WINDOW_DAYS = 27
REQUIRED_ENV = ("LONGPORT_APP_KEY", "LONGPORT_APP_SECRET", "LONGPORT_ACCESS_TOKEN")


def derive_calendar(
    today: date,
    full_days: Iterable[date],
    half_days: Iterable[date],
) -> dict:
    """Pure calendar derivation (no network). Used by tests and live fetch."""
    full = set(full_days)
    half = set(half_days)
    days = sorted(full | half)
    past = [d for d in days if d < today]
    upcoming = [d for d in days if d > today]
    open_today = today in full or today in half
    next_day = upcoming[0] if upcoming else None
    return {
        "date": today.isoformat(),
        "isTradingDay": open_today,
        "isHalfDay": today in half,
        "prevTradingDay": past[-1].isoformat() if past else None,
        "nextTradingDay": next_day.isoformat() if next_day else None,
        "nextIsHalfDay": bool(next_day) and next_day in half,
        "upcomingHalfDays": sorted(d.isoformat() for d in half if d > today),
    }


def _merge_windows(ctx, market, today: date) -> tuple[set[date], set[date]]:
    full: set[date] = set()
    half: set[date] = set()

    def pull(begin: date, end: date) -> None:
        resp = ctx.trading_days(market, begin, end)
        full.update(resp.trading_days)
        half.update(resp.half_trading_days)

    pull(today - timedelta(days=WINDOW_DAYS), today - timedelta(days=1))
    pull(today, today + timedelta(days=WINDOW_DAYS))
    upcoming = sorted(d for d in (full | half) if d > today)
    if not upcoming:
        start = today + timedelta(days=WINDOW_DAYS + 1)
        pull(start, start + timedelta(days=WINDOW_DAYS))
    return full, half


def format_summary_line(code: str, cal: dict, stamp: str) -> str:
    halfs = ",".join(cal["upcomingHalfDays"]) or "-"
    return (
        f"{code} date={cal['date']} open={cal['isTradingDay']} halfDay={cal['isHalfDay']} "
        f"prev={cal['prevTradingDay']} next={cal['nextTradingDay']} nextHalfDay={cal['nextIsHalfDay']} "
        f"upcomingHalfDays={halfs} queriedAt={stamp}"
    )


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description="Longbridge trading calendar for daily briefs")
    ap.add_argument("--out", help="Write JSON result path")
    ap.add_argument("--markets", default="HK", help="Comma-separated Market codes (default HK)")
    args = ap.parse_args(argv)

    now = datetime.now(CST)
    today = now.date()
    stamp = now.strftime("%Y-%m-%d %H:%M:%S +08:00")

    missing = [k for k in REQUIRED_ENV if not os.environ.get(k)]
    if missing:
        print(f"calendar MISSING (env not set: {', '.join(missing)})")
        return 0

    try:
        from longport.openapi import Config, Market, QuoteContext
    except ImportError:
        print("calendar MISSING (longport SDK not installed: py -m pip install longport)")
        return 0

    try:
        ctx = QuoteContext(Config.from_apikey_env())
    except Exception as exc:  # noqa: BLE001
        print(f"calendar MISSING (connect failed: {type(exc).__name__}: {str(exc)[:200]})")
        return 0

    result: dict = {
        "source": "longport.QuoteContext.trading_days",
        "quality": "B",
        "queriedAt": stamp,
        "markets": {},
    }

    for code in [m.strip().upper() for m in args.markets.split(",") if m.strip()]:
        market = getattr(Market, code, None)
        if market is None:
            print(f"{code} calendar MISSING (unknown market code)")
            continue
        try:
            full, half = _merge_windows(ctx, market, today)
            cal = derive_calendar(today, full, half)
        except Exception as exc:  # noqa: BLE001
            print(
                f"{code} calendar MISSING "
                f"(trading_days failed: {type(exc).__name__}: {str(exc)[:200]})"
            )
            continue
        result["markets"][code] = cal
        print(format_summary_line(code, cal, stamp))

    if args.out and result["markets"]:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump(result, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"calendar MISSING (unexpected: {type(exc).__name__}: {str(exc)[:200]})")
        raise SystemExit(0)
