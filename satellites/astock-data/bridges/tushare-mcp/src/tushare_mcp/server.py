from __future__ import annotations

import json
from typing import Any

from mcp.server.fastmcp import FastMCP

from .client import TushareClient, TushareError

mcp = FastMCP(
    "astock-tushare",
    instructions=(
        "A-share data via Tushare Pro. "
        "Use Tushare codes (600000.SH). "
        "daily_bar returns OHLCV; volume is in 手 (lots), not shares. "
        "funds_holding_stock means which funds hold a given stock. "
        "Do not invent numbers; cite source=tushare and as_of."
    ),
)

_client = TushareClient()


def _dump(payload: dict[str, Any]) -> str:
    return json.dumps(payload, ensure_ascii=False, indent=2)


def _run(fn: Any, **kwargs: Any) -> str:
    try:
        return _dump(fn(**kwargs))
    except TushareError as exc:
        return _dump(exc.as_dict())


@mcp.tool()
def health() -> str:
    """Check bridge readiness (does not reveal TUSHARE_TOKEN)."""
    return _run(_client.health)


@mcp.tool()
def income_statement(
    ts_code: str,
    start_date: str | None = None,
    end_date: str | None = None,
    period: str | None = None,
    limit: int | None = None,
) -> str:
    """Fetch income statement (利润表) rows for an A-share."""
    return _run(
        _client.income_statement,
        ts_code=ts_code,
        start_date=start_date,
        end_date=end_date,
        period=period,
        limit=limit,
    )


@mcp.tool()
def balance_sheet(
    ts_code: str,
    start_date: str | None = None,
    end_date: str | None = None,
    period: str | None = None,
    limit: int | None = None,
) -> str:
    """Fetch balance sheet (资产负债表) rows for an A-share."""
    return _run(
        _client.balance_sheet,
        ts_code=ts_code,
        start_date=start_date,
        end_date=end_date,
        period=period,
        limit=limit,
    )


@mcp.tool()
def cash_flow(
    ts_code: str,
    start_date: str | None = None,
    end_date: str | None = None,
    period: str | None = None,
    limit: int | None = None,
) -> str:
    """Fetch cash-flow statement (现金流量表) rows for an A-share."""
    return _run(
        _client.cash_flow,
        ts_code=ts_code,
        start_date=start_date,
        end_date=end_date,
        period=period,
        limit=limit,
    )


@mcp.tool()
def daily_bar(
    ts_code: str,
    trade_date: str | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int | None = None,
) -> str:
    """Fetch daily OHLCV (开高低收、成交量). volume=手, amount=千元."""
    return _run(
        _client.daily_bar,
        ts_code=ts_code,
        trade_date=trade_date,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )


@mcp.tool()
def margin_detail(
    ts_code: str,
    start_date: str | None = None,
    end_date: str | None = None,
    limit: int | None = None,
) -> str:
    """Fetch financing/securities lending (融资融券) detail for an A-share."""
    return _run(
        _client.margin_detail,
        ts_code=ts_code,
        start_date=start_date,
        end_date=end_date,
        limit=limit,
    )


@mcp.tool()
def funds_holding_stock(
    ts_code: str,
    start_date: str | None = None,
    end_date: str | None = None,
    period: str | None = None,
    limit: int | None = None,
) -> str:
    """List mutual funds holding this stock (semantic A: stock → funds)."""
    return _run(
        _client.funds_holding_stock,
        ts_code=ts_code,
        start_date=start_date,
        end_date=end_date,
        period=period,
        limit=limit,
    )


def main() -> None:
    mcp.run(transport="stdio")


if __name__ == "__main__":
    main()
