from __future__ import annotations

from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from market_data_gateway.app import create_app
from market_data_gateway.config import Settings
from market_data_gateway.db import GatewayStore
from market_data_gateway.normalize import normalize_yahoo_items, parse_feed_xml


FIXTURE = Path(__file__).parent / "fixtures" / "yahoo_rss_sample.xml"


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    settings = Settings(
        GATEWAY_TOKEN="secret-token",
        GATEWAY_DB_PATH=tmp_path / "test.db",
        YAHOO_NEWS_RSS_URL="https://example.test/rss",
        NEWS_POLL_SECONDS=3600,
    )
    store = GatewayStore(settings.gateway_db_path)
    raw = parse_feed_xml(FIXTURE.read_text(encoding="utf-8"))
    store.upsert_headlines(
        normalize_yahoo_items(raw, origin_feed=settings.yahoo_news_rss_url)
    )
    app = create_app(settings, enable_poller=False, store=store)
    with TestClient(app) as tc:
        yield tc


def test_health_no_auth(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["ok"] is True
    assert body["auth_required"] is True
    assert body["news_items"] == 2


def test_headlines_requires_token(client: TestClient) -> None:
    assert client.get("/api/v1/news/headlines").status_code == 401
    res = client.get(
        "/api/v1/news/headlines",
        headers={"Authorization": "Bearer secret-token"},
    )
    assert res.status_code == 200
    body = res.json()
    assert body["count"] == 2
    assert body["items"][0]["source"] == "yahoo-finance"
    assert body["items"][0]["quality"] == "B"
    assert body["source_priority"][0] == "gateway_normalized"


def test_headline_item(client: TestClient) -> None:
    listed = client.get(
        "/api/v1/news/headlines",
        headers={"Authorization": "Bearer secret-token"},
    ).json()
    item_id = listed["items"][0]["id"]
    res = client.get(
        f"/api/v1/news/item/{item_id}",
        headers={"Authorization": "Bearer secret-token"},
    )
    assert res.status_code == 200
    assert res.json()["id"] == item_id


def test_rss_feed_query_token(client: TestClient) -> None:
    res = client.get("/feeds/us-markets.xml?token=secret-token")
    assert res.status_code == 200
    assert "application/rss+xml" in res.headers["content-type"]
    assert "Sample NVDA" in res.text
    assert "Fed officials" in res.text


def test_quote_stub_caches(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> None:
    settings = Settings(
        GATEWAY_TOKEN="t",
        GATEWAY_DB_PATH=tmp_path / "q.db",
        QUOTE_CACHE_SECONDS=120,
    )
    store = GatewayStore(settings.gateway_db_path)
    app = create_app(settings, enable_poller=False, store=store)

    calls = {"n": 0}

    class FakeResponse:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {
                "chart": {
                    "result": [
                        {
                            "meta": {
                                "regularMarketPrice": 100.5,
                                "previousClose": 100.0,
                                "currency": "USD",
                                "marketState": "CLOSED",
                                "regularMarketTime": 1727721600,
                            }
                        }
                    ],
                    "error": None,
                }
            }

    class FakeClient:
        def __init__(self, *args, **kwargs) -> None:  # noqa: ANN002, ANN003
            pass

        async def __aenter__(self) -> FakeClient:
            return self

        async def __aexit__(self, *args) -> None:  # noqa: ANN002
            return None

        async def get(self, *args, **kwargs):  # noqa: ANN002, ANN003
            calls["n"] += 1
            return FakeResponse()

    monkeypatch.setattr(httpx, "AsyncClient", FakeClient)

    with TestClient(app) as tc:
        headers = {"Authorization": "Bearer t"}
        a = tc.get("/api/v1/quote", params={"symbol": "NVDA"}, headers=headers)
        b = tc.get("/api/v1/quote", params={"symbol": "NVDA"}, headers=headers)
        assert a.status_code == 200
        assert b.status_code == 200
        assert a.json()["price"] == 100.5
        assert a.json()["is_proxy"] is False
        assert a.json()["source"] == "yahoo"
        assert calls["n"] == 1  # second hit served from SQLite cache
