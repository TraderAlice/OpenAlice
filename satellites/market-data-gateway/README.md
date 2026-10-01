# Market Data Gateway (satellite)

OpenAlice **satellite** for offshore news (and thin quotes). It is **not**
part of the Node/pnpm build graph. Deploy it on a Japan or North America VPS
where Yahoo RSS is reachable, then point China-side OpenAlice / Cursor at
**your** API — never at a raw Yahoo proxy.

## Why this exists

On a China mainland host (2026-10-01 probe from this workspace), Yahoo Finance
RSS returned **HTTP 403** with Yahoo’s regional interstitial. Network location
is the problem this gateway solves. It does **not** grant Yahoo redistribution
rights; keep use personal, low-frequency, and summary-only.

## Layout

```text
market-data-gateway/
├── README.md
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── pyproject.toml
├── src/market_data_gateway/
└── tests/
```

## Endpoints

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/health` | no | Liveness + last fetch meta |
| GET | `/api/v1/news/headlines?market=us&limit=50` | Bearer / `?token=` | Normalized headlines |
| GET | `/api/v1/news/item/{id}` | Bearer / `?token=` | Single headline |
| POST | `/api/v1/news/refresh` | Bearer / `?token=` | Force Yahoo RSS pull |
| GET | `/feeds/us-markets.xml` | Bearer / `?token=` | RSS re-export for Alice |
| GET | `/api/v1/quote?symbol=NVDA` | Bearer / `?token=` | Thin normalized quote |

Headline / quote JSON carries brief-aligned provenance: `source`, `quality`,
`domain`, `is_proxy`, `fetched_at` (and quote `source_symbol`).

**Do not** expose `GET /proxy?url=…`. This service only returns normalized
fields it collected.

## Install (local / VPS)

```powershell
cd satellites/market-data-gateway
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -e ".[dev]"
copy .env.example .env
# edit GATEWAY_TOKEN
python -m market_data_gateway
```

```bash
cd satellites/market-data-gateway
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
cp .env.example .env
# edit GATEWAY_TOKEN
python -m market_data_gateway
```

## Docker

```bash
cd satellites/market-data-gateway
cp .env.example .env
# set GATEWAY_TOKEN
docker compose up -d --build
curl -s http://127.0.0.1:8787/health
curl -s -H "Authorization: Bearer $GATEWAY_TOKEN" \
  "http://127.0.0.1:8787/api/v1/news/headlines?limit=5"
```

Suggested first host: **Japan VPS** (lower latency from CN than US). Move to
North America only if Yahoo access from Japan is unstable.

## Wire into OpenAlice (lowest intrusion)

1. Run the gateway on the VPS (port `8787`, HTTPS reverse proxy recommended).
2. In OpenAlice News Sources / `news.json`, enable the shipped
   **Gateway US Markets** feed (or set its URL):

   ```text
   https://YOUR_GATEWAY_HOST/feeds/us-markets.xml?token=YOUR_TOKEN
   ```

   Alice’s RSS collector has no custom auth headers; use the query `token`.
3. Keep the direct Yahoo Finance feed **disabled** on China hosts.
4. Cursor / skills can instead call JSON:

   ```http
   GET /api/v1/news/headlines
   Authorization: Bearer YOUR_TOKEN
   ```

Alice never learns how Yahoo was reached. Cite headlines as `yahoo-finance`
or `via gateway` in briefs; quality remains `B`.

## Tests

```powershell
cd satellites/market-data-gateway
.\.venv\Scripts\Activate.ps1
pytest -q
```

Tests are hermetic (fixture XML + mocked quote HTTP). They do not call Yahoo.

## Source priority (news)

```text
1. gateway_normalized   (multi-source later)
2. gateway_yahoo_rss    (this collector)
3. local_yahoo_direct   (disable on CN)
```

## Disclaimer

Personal research sidecar. Not investment advice. Respect Yahoo Terms of
Service / API terms for automation, caching, and any redistribution. Do not
store full article HTML or open this service to the public internet without
auth.
