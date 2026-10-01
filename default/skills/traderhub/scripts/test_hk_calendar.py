"""Hermetic tests for hk_calendar pure derivation (no Longbridge network)."""

from __future__ import annotations

from datetime import date

from hk_calendar import derive_calendar, format_summary_line


def test_national_day_holiday_prev_next() -> None:
    # 2026-10-01 Thu holiday; 9/30 Wed open; 10/2 Fri open (synthetic set).
    full = {
        date(2026, 9, 28),
        date(2026, 9, 29),
        date(2026, 9, 30),
        date(2026, 10, 2),
        date(2026, 10, 5),
    }
    cal = derive_calendar(date(2026, 10, 1), full, half_days=())
    assert cal["isTradingDay"] is False
    assert cal["isHalfDay"] is False
    assert cal["prevTradingDay"] == "2026-09-30"
    assert cal["nextTradingDay"] == "2026-10-02"
    assert cal["nextIsHalfDay"] is False


def test_half_day_christmas_eve() -> None:
    full = {date(2026, 12, 23), date(2026, 12, 28)}
    half = {date(2026, 12, 24)}
    cal = derive_calendar(date(2026, 12, 24), full, half)
    assert cal["isTradingDay"] is True
    assert cal["isHalfDay"] is True
    assert cal["prevTradingDay"] == "2026-12-23"
    assert cal["nextTradingDay"] == "2026-12-28"
    assert cal["upcomingHalfDays"] == []


def test_format_summary_line() -> None:
    cal = derive_calendar(
        date(2026, 10, 2),
        {date(2026, 9, 30), date(2026, 10, 2), date(2026, 10, 5)},
        (),
    )
    line = format_summary_line("HK", cal, "2026-10-02 09:00:00 +08:00")
    assert line.startswith("HK date=2026-10-02 open=True")
    assert "prev=2026-09-30" in line
    assert "next=2026-10-05" in line
