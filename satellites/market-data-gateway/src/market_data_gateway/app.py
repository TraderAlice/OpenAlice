"""FastAPI application: news headlines, RSS re-export, thin quotes."""

from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.responses import PlainTextResponse, Response

from market_data_gateway import __version__
from market_data_gateway.auth import require_token
from market_data_gateway.collector import fetch_yahoo_news
from market_data_gateway.config import Settings, get_settings
from market_data_gateway.db import GatewayStore, utc_now_iso
from market_data_gateway.models import (
    Headline,
    HeadlinesResponse,
    HealthResponse,
    QuoteResponse,
)
from market_data_gateway.quotes import fetch_quote
from market_data_gateway.rss_out import headlines_to_rss

logger = logging.getLogger(__name__)

SOURCE_PRIORITY = [
    "gateway_normalized",
    "gateway_yahoo_rss",
    "local_yahoo_direct_disabled",
]


def create_app(
    settings: Settings | None = None,
    *,
    enable_poller: bool = True,
    store: GatewayStore | None = None,
) -> FastAPI:
    settings = settings or get_settings()
    store = store or GatewayStore(settings.gateway_db_path)
    poll_task: asyncio.Task[None] | None = None

    async def _poll_loop() -> None:
        while True:
            try:
                await fetch_yahoo_news(
                    store,
                    url=settings.yahoo_news_rss_url,
                    user_agent=settings.http_user_agent,
                )
            except Exception:  # noqa: BLE001
                logger.exception("scheduled news poll failed")
            await asyncio.sleep(settings.news_poll_seconds)

    @asynccontextmanager
    async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
        nonlocal poll_task
        if enable_poller:
            try:
                await fetch_yahoo_news(
                    store,
                    url=settings.yahoo_news_rss_url,
                    user_agent=settings.http_user_agent,
                )
            except Exception:  # noqa: BLE001
                logger.exception("initial news poll failed")
            poll_task = asyncio.create_task(_poll_loop())
        try:
            yield
        finally:
            if poll_task:
                poll_task.cancel()
                try:
                    await poll_task
                except asyncio.CancelledError:
                    pass
            store.close()

    app = FastAPI(
        title="OpenAlice Market Data Gateway",
        version=__version__,
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.state.store = store

    @app.get("/health", response_model=HealthResponse)
    def health() -> HealthResponse:
        ok_flag = store.get_meta("last_news_fetch_ok")
        return HealthResponse(
            ok=True,
            version=__version__,
            news_items=store.headline_count(),
            last_news_fetch_at=store.get_meta("last_news_fetch_at"),
            last_news_fetch_ok=None if ok_flag is None else ok_flag == "1",
            auth_required=bool((settings.gateway_token or "").strip()),
        )

    @app.get(
        "/api/v1/news/headlines",
        response_model=HeadlinesResponse,
        dependencies=[Depends(require_token)],
    )
    def headlines(
        market: str = Query(default="us"),
        limit: int = Query(default=50, ge=1, le=200),
        source: str | None = Query(default=None),
    ) -> HeadlinesResponse:
        _ = market  # reserved for multi-market routing
        rows = store.list_headlines(source=source, limit=limit)
        return HeadlinesResponse(
            items=[Headline.model_validate(r) for r in rows],
            count=len(rows),
            as_of=utc_now_iso(),
            source_priority=SOURCE_PRIORITY,
        )

    @app.get(
        "/api/v1/news/item/{item_id}",
        response_model=Headline,
        dependencies=[Depends(require_token)],
    )
    def headline_item(item_id: str) -> Headline:
        row = store.get_headline(item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="headline not found")
        return Headline.model_validate(row)

    @app.post(
        "/api/v1/news/refresh",
        dependencies=[Depends(require_token)],
    )
    async def refresh_news() -> dict[str, object]:
        count = await fetch_yahoo_news(
            store,
            url=settings.yahoo_news_rss_url,
            user_agent=settings.http_user_agent,
        )
        return {"ok": True, "upserted": count, "as_of": utc_now_iso()}

    @app.get(
        "/feeds/us-markets.xml",
        dependencies=[Depends(require_token)],
    )
    def us_markets_rss(request: Request) -> Response:
        rows = store.list_headlines(limit=100)
        base = str(request.base_url).rstrip("/")
        xml = headlines_to_rss(
            rows,
            link=f"{base}/feeds/us-markets.xml",
        )
        return Response(content=xml, media_type="application/rss+xml; charset=utf-8")

    @app.get(
        "/api/v1/quote",
        response_model=QuoteResponse,
        dependencies=[Depends(require_token)],
    )
    async def quote(symbol: str = Query(..., min_length=1, max_length=32)) -> QuoteResponse:
        row = await fetch_quote(
            store,
            symbol,
            user_agent=settings.http_user_agent,
            cache_seconds=settings.quote_cache_seconds,
        )
        return QuoteResponse.model_validate(row)

    @app.get("/api/v1/ping", dependencies=[Depends(require_token)])
    def ping() -> PlainTextResponse:
        return PlainTextResponse("ok")

    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    settings = get_settings()
    uvicorn.run(
        "market_data_gateway.app:create_app",
        factory=True,
        host=settings.gateway_host,
        port=settings.gateway_port,
        log_level="info",
    )


if __name__ == "__main__":
    main()
