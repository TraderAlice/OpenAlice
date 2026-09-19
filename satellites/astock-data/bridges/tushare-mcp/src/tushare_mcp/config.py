from __future__ import annotations

import os
import time
from dataclasses import dataclass
from threading import Lock
from typing import Any


@dataclass(frozen=True)
class Settings:
    token: str | None
    http_url: str | None
    min_interval_sec: float
    cache_ttl_sec: float
    daily_cache_ttl_sec: float
    statement_limit: int
    margin_limit: int
    fund_limit: int
    daily_limit: int


def load_settings() -> Settings:
    token = os.environ.get("TUSHARE_TOKEN", "").strip() or None
    http_url = os.environ.get("TUSHARE_HTTP_URL", "").strip().rstrip("/") or None
    return Settings(
        token=token,
        http_url=http_url,
        min_interval_sec=_env_float("TUSHARE_MCP_MIN_INTERVAL_SEC", 0.35),
        cache_ttl_sec=_env_float("TUSHARE_MCP_CACHE_TTL_SEC", 6 * 3600),
        daily_cache_ttl_sec=_env_float("TUSHARE_MCP_DAILY_CACHE_TTL_SEC", 15 * 60),
        statement_limit=_env_int("TUSHARE_MCP_STATEMENT_LIMIT", 24),
        margin_limit=_env_int("TUSHARE_MCP_MARGIN_LIMIT", 120),
        fund_limit=_env_int("TUSHARE_MCP_FUND_LIMIT", 80),
        daily_limit=_env_int("TUSHARE_MCP_DAILY_LIMIT", 60),
    )


def _env_float(name: str, default: float) -> float:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return float(raw)
    except ValueError:
        return default


def _env_int(name: str, default: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return default
    try:
        return max(1, int(raw))
    except ValueError:
        return default


class RateLimiter:
    """Simple process-wide spacing between Tushare calls."""

    def __init__(self, min_interval_sec: float) -> None:
        self._min_interval = max(0.0, min_interval_sec)
        self._lock = Lock()
        self._last = 0.0

    def wait(self) -> None:
        with self._lock:
            now = time.monotonic()
            gap = self._min_interval - (now - self._last)
            if gap > 0:
                time.sleep(gap)
            self._last = time.monotonic()


class TtlCache:
    def __init__(self, ttl_sec: float) -> None:
        self._ttl = max(0.0, ttl_sec)
        self._lock = Lock()
        self._store: dict[str, tuple[float, Any]] = {}

    def get(self, key: str) -> Any | None:
        if self._ttl <= 0:
            return None
        with self._lock:
            hit = self._store.get(key)
            if hit is None:
                return None
            expires_at, value = hit
            if time.time() >= expires_at:
                self._store.pop(key, None)
                return None
            return value

    def set(self, key: str, value: Any) -> None:
        if self._ttl <= 0:
            return
        with self._lock:
            self._store[key] = (time.time() + self._ttl, value)
