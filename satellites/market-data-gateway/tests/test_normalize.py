from pathlib import Path

from market_data_gateway.normalize import (
    make_headline_id,
    normalize_yahoo_items,
    parse_feed_xml,
    parse_rfc2822_or_iso,
)


FIXTURE = Path(__file__).parent / "fixtures" / "yahoo_rss_sample.xml"


def test_parse_feed_xml_sample() -> None:
    raw = parse_feed_xml(FIXTURE.read_text(encoding="utf-8"))
    assert len(raw) == 2
    assert raw[0]["title"].startswith("Sample NVDA")
    assert raw[1]["guid"] == "yahoo-fed-2"


def test_normalize_yahoo_items_provenance() -> None:
    raw = parse_feed_xml(FIXTURE.read_text(encoding="utf-8"))
    rows = normalize_yahoo_items(raw, origin_feed="https://finance.yahoo.com/news/rssindex")
    assert len(rows) == 2
    first = rows[0]
    assert first["source"] == "yahoo-finance"
    assert first["quality"] == "B"
    assert first["domain"] == "news"
    assert first["is_proxy"] is False
    assert first["proxy_for"] is None
    assert first["published_at"] == "2026-09-30T20:00:00Z"
    assert first["id"].startswith("yahoo-finance:")
    assert first["origin_feed"].endswith("rssindex")


def test_make_headline_id_stable() -> None:
    a = make_headline_id("yahoo-finance", "g1", "https://x", "t")
    b = make_headline_id("yahoo-finance", "g1", "https://other", "other")
    assert a == b


def test_parse_rfc2822() -> None:
    dt = parse_rfc2822_or_iso("Tue, 30 Sep 2026 20:00:00 GMT")
    assert dt is not None
    assert dt.year == 2026
    assert dt.month == 9
