"""Outbound collectors: Yahoo news RSS (and future sources)."""

from __future__ import annotations

import logging
from datetime import datetime, timezone

import httpx

from market_data_gateway.db import GatewayStore, utc_now_iso
from market_data_gateway.normalize import normalize_yahoo_items, parse_feed_xml

logger = logging.getLogger(__name__)


async def fetch_yahoo_news(
    store: GatewayStore,
    *,
    url: str,
    user_agent: str,
    timeout: float = 20.0,
) -> int:
    """Pull Yahoo RSS, normalize, upsert. Returns inserted/updated row count."""
    headers = {
        "User-Agent": user_agent,
        "Accept": "application/rss+xml, application/xml, text/xml, */*",
    }
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=timeout) as client:
            res = await client.get(url, headers=headers)
            res.raise_for_status()
            xml = res.text
    except Exception as exc:  # noqa: BLE001 — surface as meta for operators
        store.set_meta("last_news_fetch_at", utc_now_iso())
        store.set_meta("last_news_fetch_ok", "0")
        store.set_meta("last_news_fetch_error", str(exc)[:500])
        logger.warning("yahoo news fetch failed: %s", exc)
        raise

    raw = parse_feed_xml(xml)
    now = datetime.now(timezone.utc)
    rows = normalize_yahoo_items(raw, origin_feed=url, fetched_at=now)
    count = store.upsert_headlines(rows)
    store.set_meta("last_news_fetch_at", utc_now_iso())
    store.set_meta("last_news_fetch_ok", "1")
    store.set_meta("last_news_fetch_error", "")
    store.set_meta("last_news_fetch_count", str(count))
    logger.info("yahoo news fetch ok: %s items", count)
    return count
