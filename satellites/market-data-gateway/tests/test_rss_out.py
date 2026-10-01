from market_data_gateway.rss_out import headlines_to_rss


def test_headlines_to_rss_contains_items() -> None:
    xml = headlines_to_rss(
        [
            {
                "id": "yahoo-finance:abc",
                "title": "Hello & Co",
                "url": "https://example.com/a",
                "summary": "A <b>summary</b>",
                "published_at": "2026-09-30T20:00:00Z",
                "source": "yahoo-finance",
            }
        ]
    )
    assert "<rss version=\"2.0\">" in xml
    assert "Hello &amp; Co" in xml
    assert "yahoo-finance:abc" in xml
    assert "2026-09-30T20:00:00Z" in xml
    assert "<b>" not in xml  # escaped
