"""Re-export cached headlines as RSS 2.0 for OpenAlice NewsCollector."""

from __future__ import annotations

import html
from typing import Any
from xml.sax.saxutils import escape


def headlines_to_rss(
    items: list[dict[str, Any]],
    *,
    title: str = "OpenAlice Market Data Gateway — US markets",
    link: str = "https://localhost/feeds/us-markets.xml",
    description: str = "Normalized offshore headlines (not a Yahoo proxy).",
) -> str:
    channel_items: list[str] = []
    for item in items:
        item_title = escape(item.get("title") or "")
        item_link = escape(item.get("url") or "")
        item_guid = escape(item.get("id") or item_link or item_title)
        summary = escape(item.get("summary") or "")
        # Keep RSS body to the vendor summary only — never full HTML articles.
        pub = item.get("published_at")
        # RSS prefers RFC 822; keep ISO if we lack a converter dependency.
        pub_tag = f"<pubDate>{escape(pub)}</pubDate>" if pub else ""
        source = escape(item.get("source") or "gateway")
        channel_items.append(
            f"<item>"
            f"<title>{item_title}</title>"
            f"<link>{item_link}</link>"
            f"<guid isPermaLink=\"false\">{item_guid}</guid>"
            f"<description>{summary}</description>"
            f"<source>{source}</source>"
            f"{pub_tag}"
            f"</item>"
        )

    body = "".join(channel_items)
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<rss version="2.0"><channel>'
        f"<title>{escape(title)}</title>"
        f"<link>{escape(link)}</link>"
        f"<description>{escape(description)}</description>"
        f"{body}"
        "</channel></rss>"
    )


def strip_html_to_text(value: str) -> str:
    """Lightweight HTML strip for summaries (tests / defensive)."""
    text = html.unescape(value or "")
    # Extremely small helper — gateway stores already-cleaned RSS text.
    return text.strip()
