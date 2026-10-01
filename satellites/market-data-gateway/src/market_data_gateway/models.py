"""Pydantic response models and provenance helpers."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


Quality = Literal["A", "B", "C"]
Domain = Literal["market", "flow", "macro", "event", "calendar", "derived", "news"]


class Headline(BaseModel):
    id: str
    title: str
    url: str | None = None
    summary: str = ""
    published_at: str | None = None
    source: str
    quality: Quality = "B"
    domain: Domain = "news"
    is_proxy: bool = False
    proxy_for: str | None = None
    fetched_at: str
    origin_feed: str | None = None


class HeadlinesResponse(BaseModel):
    items: list[Headline]
    count: int
    as_of: str
    source_priority: list[str] = Field(default_factory=list)


class QuoteResponse(BaseModel):
    symbol: str
    price: float | None = None
    change: float | None = None
    change_pct: float | None = None
    currency: str | None = None
    market_status: str | None = None
    timestamp: str | None = None
    source: str
    source_type: str = "vendor_quote"
    quality: Quality = "B"
    domain: Domain = "market"
    is_proxy: bool = False
    proxy_for: str | None = None
    source_symbol: str | None = None
    fetched_at: str
    error: str | None = None


class HealthResponse(BaseModel):
    ok: bool
    version: str
    news_items: int
    last_news_fetch_at: str | None = None
    last_news_fetch_ok: bool | None = None
    auth_required: bool
