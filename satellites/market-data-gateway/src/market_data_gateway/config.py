"""Environment-backed settings for the Market Data Gateway."""

from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    gateway_token: str = Field(default="", alias="GATEWAY_TOKEN")
    gateway_host: str = Field(default="0.0.0.0", alias="GATEWAY_HOST")
    gateway_port: int = Field(default=8787, alias="GATEWAY_PORT")
    gateway_db_path: Path = Field(default=Path("./data/gateway.db"), alias="GATEWAY_DB_PATH")

    yahoo_news_rss_url: str = Field(
        default="https://finance.yahoo.com/news/rssindex",
        alias="YAHOO_NEWS_RSS_URL",
    )
    news_poll_seconds: int = Field(default=600, alias="NEWS_POLL_SECONDS", ge=30)
    quote_cache_seconds: int = Field(default=60, alias="QUOTE_CACHE_SECONDS", ge=5)
    http_user_agent: str = Field(
        default="OpenAlice-MarketDataGateway/0.1",
        alias="HTTP_USER_AGENT",
    )


def get_settings() -> Settings:
    return Settings()
