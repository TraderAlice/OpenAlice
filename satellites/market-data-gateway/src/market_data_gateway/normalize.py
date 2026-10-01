"""RSS / Atom parsing and headline normalization (stdlib only)."""

from __future__ import annotations

import hashlib
import html
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from xml.etree import ElementTree as ET


_ITEM_TAG = re.compile(r"^(?:\{.*\})?(item|entry)$", re.I)


def _local(tag: str) -> str:
    if "}" in tag:
        return tag.rsplit("}", 1)[-1]
    return tag


def _text(el: ET.Element | None) -> str:
    if el is None or el.text is None:
        return ""
    return html.unescape(el.text).strip()


def _child_text(parent: ET.Element, *names: str) -> str:
    wanted = {n.lower() for n in names}
    for child in parent:
        if _local(child.tag).lower() in wanted:
            return _text(child)
    return ""


def _child_link(parent: ET.Element) -> str | None:
    for child in parent:
        if _local(child.tag).lower() != "link":
            continue
        href = child.attrib.get("href")
        if href:
            return href.strip()
        text = _text(child)
        if text:
            return text
    return None


def parse_rfc2822_or_iso(value: str | None) -> datetime | None:
    if not value:
        return None
    raw = value.strip()
    if not raw:
        return None
    try:
        dt = parsedate_to_datetime(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, IndexError):
        pass
    try:
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except ValueError:
        return None


def iso_z(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def make_headline_id(source: str, guid: str | None, link: str | None, title: str) -> str:
    basis = (guid or link or title or "").strip()
    digest = hashlib.sha256(f"{source}|{basis}".encode("utf-8")).hexdigest()[:16]
    return f"{source}:{digest}"


def parse_feed_xml(xml: str) -> list[dict[str, Any]]:
    """Parse RSS 2.0 / Atom XML into raw item dicts."""
    root = ET.fromstring(xml)
    items: list[dict[str, Any]] = []

    for el in root.iter():
        if not _ITEM_TAG.match(_local(el.tag)):
            continue
        title = _child_text(el, "title")
        summary = (
            _child_text(el, "description")
            or _child_text(el, "summary")
            or _child_text(el, "content")
        )
        link = _child_link(el)
        guid = _child_text(el, "guid", "id") or None
        published_raw = (
            _child_text(el, "pubDate")
            or _child_text(el, "published")
            or _child_text(el, "updated")
            or None
        )
        items.append(
            {
                "title": title,
                "summary": summary,
                "link": link,
                "guid": guid,
                "published_raw": published_raw,
            }
        )
    return items


def normalize_yahoo_items(
    raw_items: list[dict[str, Any]],
    *,
    source: str = "yahoo-finance",
    origin_feed: str,
    fetched_at: datetime | None = None,
) -> list[dict[str, Any]]:
    """Map parsed RSS items into gateway headline rows (brief-aligned provenance)."""
    now = fetched_at or datetime.now(timezone.utc)
    fetched = iso_z(now) or ""
    out: list[dict[str, Any]] = []
    for raw in raw_items:
        title = (raw.get("title") or "").strip()
        if not title:
            continue
        link = raw.get("link")
        guid = raw.get("guid")
        published = parse_rfc2822_or_iso(raw.get("published_raw"))
        out.append(
            {
                "id": make_headline_id(source, guid, link, title),
                "title": title,
                "url": link,
                "summary": (raw.get("summary") or "").strip(),
                "published_at": iso_z(published),
                "source": source,
                "quality": "B",
                "domain": "news",
                "is_proxy": False,
                "proxy_for": None,
                "fetched_at": fetched,
                "origin_feed": origin_feed,
            }
        )
    return out
