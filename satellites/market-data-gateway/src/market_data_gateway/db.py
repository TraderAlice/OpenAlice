"""SQLite persistence for headlines, quotes, and collector meta."""

from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


SCHEMA = """
CREATE TABLE IF NOT EXISTS headlines (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  url TEXT,
  summary TEXT NOT NULL DEFAULT '',
  published_at TEXT,
  source TEXT NOT NULL,
  quality TEXT NOT NULL DEFAULT 'B',
  domain TEXT NOT NULL DEFAULT 'news',
  is_proxy INTEGER NOT NULL DEFAULT 0,
  proxy_for TEXT,
  fetched_at TEXT NOT NULL,
  origin_feed TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_headlines_published ON headlines(published_at DESC);
CREATE INDEX IF NOT EXISTS idx_headlines_source ON headlines(source);

CREATE TABLE IF NOT EXISTS quotes (
  symbol TEXT PRIMARY KEY,
  payload_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
"""


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


class GatewayStore:
    def __init__(self, db_path: Path) -> None:
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    def set_meta(self, key: str, value: str) -> None:
        self._conn.execute(
            "INSERT INTO meta(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )
        self._conn.commit()

    def get_meta(self, key: str) -> str | None:
        row = self._conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
        return None if row is None else str(row["value"])

    def upsert_headlines(self, rows: list[dict[str, Any]]) -> int:
        if not rows:
            return 0
        now = utc_now_iso()
        self._conn.executemany(
            """
            INSERT INTO headlines(
              id, title, url, summary, published_at, source, quality, domain,
              is_proxy, proxy_for, fetched_at, origin_feed, updated_at
            ) VALUES (
              :id, :title, :url, :summary, :published_at, :source, :quality, :domain,
              :is_proxy, :proxy_for, :fetched_at, :origin_feed, :updated_at
            )
            ON CONFLICT(id) DO UPDATE SET
              title=excluded.title,
              url=excluded.url,
              summary=excluded.summary,
              published_at=excluded.published_at,
              source=excluded.source,
              quality=excluded.quality,
              domain=excluded.domain,
              is_proxy=excluded.is_proxy,
              proxy_for=excluded.proxy_for,
              fetched_at=excluded.fetched_at,
              origin_feed=excluded.origin_feed,
              updated_at=excluded.updated_at
            """,
            [
                {
                    **row,
                    "is_proxy": 1 if row.get("is_proxy") else 0,
                    "updated_at": now,
                }
                for row in rows
            ],
        )
        self._conn.commit()
        return len(rows)

    def list_headlines(
        self,
        *,
        source: str | None = None,
        limit: int = 50,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(limit, 200))
        if source:
            cur = self._conn.execute(
                """
                SELECT * FROM headlines
                WHERE source = ?
                ORDER BY COALESCE(published_at, fetched_at) DESC
                LIMIT ?
                """,
                (source, limit),
            )
        else:
            cur = self._conn.execute(
                """
                SELECT * FROM headlines
                ORDER BY COALESCE(published_at, fetched_at) DESC
                LIMIT ?
                """,
                (limit,),
            )
        return [self._row_to_headline(r) for r in cur.fetchall()]

    def get_headline(self, item_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM headlines WHERE id = ?",
            (item_id,),
        ).fetchone()
        return None if row is None else self._row_to_headline(row)

    def headline_count(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) AS c FROM headlines").fetchone()
        return int(row["c"]) if row else 0

    def get_quote(self, symbol: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT payload_json, fetched_at FROM quotes WHERE symbol = ?",
            (symbol.upper(),),
        ).fetchone()
        if row is None:
            return None
        payload = json.loads(row["payload_json"])
        payload["fetched_at"] = row["fetched_at"]
        return payload

    def put_quote(self, symbol: str, payload: dict[str, Any]) -> None:
        fetched_at = payload.get("fetched_at") or utc_now_iso()
        self._conn.execute(
            """
            INSERT INTO quotes(symbol, payload_json, fetched_at) VALUES(?, ?, ?)
            ON CONFLICT(symbol) DO UPDATE SET
              payload_json=excluded.payload_json,
              fetched_at=excluded.fetched_at
            """,
            (symbol.upper(), json.dumps(payload, ensure_ascii=False), fetched_at),
        )
        self._conn.commit()

    @staticmethod
    def _row_to_headline(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "title": row["title"],
            "url": row["url"],
            "summary": row["summary"] or "",
            "published_at": row["published_at"],
            "source": row["source"],
            "quality": row["quality"],
            "domain": row["domain"],
            "is_proxy": bool(row["is_proxy"]),
            "proxy_for": row["proxy_for"],
            "fetched_at": row["fetched_at"],
            "origin_feed": row["origin_feed"],
        }
