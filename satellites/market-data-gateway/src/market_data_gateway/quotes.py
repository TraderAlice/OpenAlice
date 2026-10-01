"""Thin Yahoo quote fetch + cache (optional; not a raw proxy)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any

import httpx

from market_data_gateway.db import GatewayStore, utc_now_iso
from market_data_gateway.normalize import iso_z

logger = logging.getLogger(__name__)

# Chart API used by many public clients; gateway normalizes fields only.
_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/{symbol}"


def _parse_chart(payload: dict[str, Any], symbol: str) -> dict[str, Any]:
    result = (payload.get("chart") or {}).get("result") or []
    if not result:
        error = (payload.get("chart") or {}).get("error")
        msg = None
        if isinstance(error, dict):
            msg = error.get("description") or error.get("code")
        raise ValueError(msg or "empty chart result")

    meta = result[0].get("meta") or {}
    price = meta.get("regularMarketPrice")
    prev = meta.get("chartPreviousClose") or meta.get("previousClose")
    change = None
    change_pct = None
    if isinstance(price, (int, float)) and isinstance(prev, (int, float)) and prev != 0:
        change = float(price) - float(prev)
        change_pct = (change / float(prev)) * 100.0

    ts_raw = meta.get("regularMarketTime")
    timestamp = None
    if isinstance(ts_raw, (int, float)):
        timestamp = iso_z(datetime.fromtimestamp(ts_raw, tz=timezone.utc))

    status = "unknown"
    if meta.get("marketState"):
        status = str(meta["marketState"]).lower()

    return {
        "symbol": symbol.upper(),
        "price": float(price) if isinstance(price, (int, float)) else None,
        "change": change,
        "change_pct": change_pct,
        "currency": meta.get("currency"),
        "market_status": status,
        "timestamp": timestamp,
        "source": "yahoo",
        "source_type": "vendor_quote",
        "quality": "B",
        "domain": "market",
        "is_proxy": False,
        "proxy_for": None,
        "source_symbol": symbol.upper(),
        "fetched_at": utc_now_iso(),
        "error": None,
    }


async def fetch_quote(
    store: GatewayStore,
    symbol: str,
    *,
    user_agent: str,
    cache_seconds: int,
    timeout: float = 15.0,
) -> dict[str, Any]:
    symbol_u = symbol.strip().upper()
    if not symbol_u:
        return {
            "symbol": "",
            "source": "yahoo",
            "fetched_at": utc_now_iso(),
            "error": "empty_symbol",
            "quality": "B",
            "domain": "market",
            "is_proxy": False,
            "source_type": "vendor_quote",
        }

    cached = store.get_quote(symbol_u)
    if cached and not cached.get("error"):
        fetched_at = cached.get("fetched_at")
        try:
            if fetched_at:
                age = (
                    datetime.now(timezone.utc)
                    - datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
                ).total_seconds()
                if age <= cache_seconds:
                    return cached
        except ValueError:
            pass

    url = _CHART_URL.format(symbol=symbol_u)
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/json",
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            res = await client.get(url, headers=headers, params={"interval": "1d", "range": "1d"})
            res.raise_for_status()
            payload = res.json()
        row = _parse_chart(payload, symbol_u)
        store.put_quote(symbol_u, row)
        return row
    except Exception as exc:  # noqa: BLE001
        logger.warning("quote fetch failed for %s: %s", symbol_u, exc)
        err_row = {
            "symbol": symbol_u,
            "price": None,
            "change": None,
            "change_pct": None,
            "currency": None,
            "market_status": None,
            "timestamp": None,
            "source": "yahoo",
            "source_type": "vendor_quote",
            "quality": "B",
            "domain": "market",
            "is_proxy": False,
            "proxy_for": None,
            "source_symbol": symbol_u,
            "fetched_at": utc_now_iso(),
            "error": str(exc)[:300],
        }
        # Do not poison cache with hard failures for long — still store briefly
        # so health/debug can see last error shape.
        store.put_quote(symbol_u, err_row)
        return err_row
