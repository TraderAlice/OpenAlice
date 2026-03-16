# Running OpenTypeBB with OpenAlice

OpenTypeBB is a TypeScript-native port of the [OpenBB Platform](https://github.com/OpenBB-finance/OpenBB) — the open-source financial data infrastructure. It ships as an internal package (`@traderalice/opentypebb`) inside OpenAlice, giving you access to equity, crypto, currency, commodity, economy, and news data without spinning up a Python sidecar or messing with `uv`.

This tutorial walks you through getting OpenAlice up and running with OpenTypeBB as the data backend.

---

## Prerequisites

| Requirement | Version |
|-------------|---------|
| [Node.js](https://nodejs.org/) | 22+ |
| [pnpm](https://pnpm.io/) | 10+ |
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) | latest (installed & authenticated) |

That's it. No Python, no `uv`, no Docker.

---

## 1. Clone & Install

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install
pnpm build
```

`pnpm install` resolves the monorepo workspace — the `@traderalice/opentypebb` package under `packages/opentypebb/` is linked automatically.

## 2. Start the Dev Server

```bash
pnpm dev
```

Open [http://localhost:3002](http://localhost:3002) and start chatting. No API keys or extra config required — the default setup uses Claude Code as the AI backend with your existing login, and OpenTypeBB as the data engine via in-process SDK mode.

> For frontend hot-reload during development, run `pnpm dev:ui` (port 5173) in a separate terminal.

## 3. Verify OpenTypeBB Is Active

OpenTypeBB is the **default** data backend. You don't need to configure anything — it's already on.

Under the hood, OpenAlice reads `data/config/market-data.json`. If that file doesn't exist yet, it falls back to these defaults:

```json
{
  "enabled": true,
  "backend": "typebb-sdk",
  "providers": {
    "equity": "yfinance",
    "crypto": "yfinance",
    "currency": "yfinance"
  },
  "providerKeys": {},
  "apiServer": {
    "enabled": false,
    "port": 6901
  }
}
```

Key settings:

- **`backend: "typebb-sdk"`** — This is the in-process mode. OpenTypeBB's `QueryExecutor` runs directly inside the Node.js process — no HTTP, no sidecar. This is the default.
- **`backend: "openbb-api"`** — Switches to making HTTP requests to an external OpenBB-compatible API server. You probably don't want this.
- **`providers`** — Which data provider to use per asset class. `yfinance` works out of the box with no API key.

## 4. Available Data Providers

OpenTypeBB ships with 14 providers:

| Provider | Covers | API Key? |
|----------|--------|----------|
| **yfinance** | Equity, crypto, currency, news | No |
| **fmp** | Equity fundamentals, news, discovery | Required |
| **intrinio** | Options data | Required |
| **eia** | Energy (petroleum, natural gas, electricity) | Required |
| **econdb** | Global economic data | Optional (higher rate limits) |
| **federal_reserve** | FRED, FOMC, payrolls, PCE, Michigan, etc. | Optional (higher rate limits) |
| **bls** | Bureau of Labor Statistics employment data | Optional (higher rate limits) |
| **deribit** | Crypto derivatives | No |
| **cboe** | Index data | No |
| **multpl** | S&P 500 multiples (PE, earnings yield) | No |
| **oecd** | GDP, economic indicators | No |
| **imf** | International trade, CPI, balance of payments | No |
| **ecb** | European balance of payments | No |
| **stub** | Test/placeholder | No |

**Most things work without any API key** — `yfinance` covers equity quotes, crypto prices, forex rates, and company news. `federal_reserve`, `bls`, and `econdb` also work keyless but with stricter rate limits. Only `fmp`, `intrinio`, and `eia` strictly require a key.

## 5. Adding API Keys (Optional)

To unlock additional providers (FMP, EIA, Intrinio, etc.), create or edit `data/config/market-data.json`:

```json
{
  "providerKeys": {
    "fmp": "your_fmp_api_key_here",
    "eia": "your_eia_api_key_here"
  }
}
```

Or set them through the Web UI: open [http://localhost:3002](http://localhost:3002), go to the config panel, and edit the OpenBB section. Changes take effect immediately — no restart needed.

The key names map to OpenBB credential fields automatically:
`fmp` → `fmp_api_key`, `eia` → `eia_api_key`, `fred` → `fred_api_key`, etc.

## 6. What Can You Do?

Once running, Alice has access to a rich set of market data tools powered by OpenTypeBB:

### Market Search
Ask Alice to find any symbol across equities, crypto, and forex:
> "Search for Tesla stock"
> "Find crypto pairs with SOL"

### Equity Data
- Price quotes and historical OHLCV
- Company profiles and financial statements
- Analyst estimates and earnings calendar
- Insider trading and institutional ownership
- Market movers (top gainers, losers, most active)

### Crypto & Forex
- Real-time price data
- Historical OHLCV with configurable intervals

### Technical Analysis
Built-in indicator calculator with formula expressions:
> "Calculate RSI(14) for AAPL on the daily chart"
> "Show me the 50-day and 200-day SMA crossover for BTC/USD"

Uses syntax like `SMA(CLOSE('AAPL', '1d'), 50)`, `RSI(CLOSE('BTC/USD', '1d'), 14)`, etc.

### Economy & Macro
- GDP data (OECD, IMF)
- FRED economic series (rates, inflation, employment)
- PCE, CPI, nonfarm payrolls, FOMC documents
- University of Michigan consumer sentiment
- Fed manufacturing outlook surveys

### Commodities
- EIA petroleum & natural gas data
- Spot commodity prices

### News
- Company-specific news
- World market news
- Background RSS collection with searchable archive

## 7. Running OpenTypeBB as a Standalone HTTP Server

If you want to use OpenTypeBB independently — for example, to connect it to [OpenBB Workspace](https://pro.openbb.co) or other tools — you can run it as a standalone API server:

```bash
# From the repo root:
cd packages/opentypebb

# Set your API key (optional — yfinance works without one)
export FMP_API_KEY=your_key_here

# Run the server
npx tsx src/server.ts
```

The server starts on port 6901 (configurable via `OPENTYPEBB_PORT`):
```
Built widgets.json with 88 widgets
OpenTypeBB listening on http://localhost:6901
```

### API Endpoints

The server exposes OpenBB-compatible REST endpoints:

```bash
# Health check
curl http://localhost:6901/api/v1/health

# Get a stock quote
curl "http://localhost:6901/api/v1/equity/price/quote?symbol=AAPL&provider=yfinance"

# Get historical data
curl "http://localhost:6901/api/v1/equity/price/historical?symbol=MSFT&provider=yfinance&start_date=2024-01-01"

# Get crypto price
curl "http://localhost:6901/api/v1/crypto/price/historical?symbol=BTC-USD&provider=yfinance"

# Get world news (requires FMP key)
curl "http://localhost:6901/api/v1/news/world?provider=fmp&limit=5"

# GDP data from OECD
curl "http://localhost:6901/api/v1/economy/gdp/nominal?provider=oecd&country=united_states"

# Pass credentials per-request
curl -H 'X-OpenBB-Credentials: {"fmp_api_key": "your_key"}' \
  "http://localhost:6901/api/v1/equity/fundamental/income?symbol=AAPL&provider=fmp"

# Discover available widgets (for OpenBB Workspace)
curl http://localhost:6901/widgets.json
```

### Embedded Server Mode

You can also run the API server embedded inside OpenAlice (alongside the agent). Edit `data/config/market-data.json`:

```json
{
  "apiServer": {
    "enabled": true,
    "port": 6901
  }
}
```

Then `pnpm dev` will start both Alice and the OpenTypeBB HTTP API.

## 8. Using OpenTypeBB as a Library

You can also import OpenTypeBB directly in your own TypeScript project:

```typescript
import { createExecutor } from '@traderalice/opentypebb'

const executor = createExecutor()

// Get a stock quote (yfinance — no API key needed)
const quotes = await executor.execute('yfinance', 'EquityQuote', {
  symbol: 'AAPL',
}, {})

console.log(quotes)

// Get historical crypto data
const btcHistory = await executor.execute('yfinance', 'CryptoHistorical', {
  symbol: 'BTC-USD',
  start_date: '2024-01-01',
}, {})

// With an FMP API key
const income = await executor.execute('fmp', 'IncomeStatement', {
  symbol: 'AAPL',
  period: 'annual',
}, {
  fmp_api_key: 'your_key_here',
})
```

## 9. Architecture Overview

```
OpenAlice
├── packages/opentypebb/          # The OpenTypeBB library
│   ├── src/
│   │   ├── index.ts              # Library entry point
│   │   ├── server.ts             # Standalone HTTP server
│   │   ├── core/                 # Registry, executor, router, REST API
│   │   ├── providers/            # 14 data providers (yfinance, fmp, oecd, ...)
│   │   └── extensions/           # 9 domain routers (equity, crypto, economy, ...)
│   └── package.json
│
├── src/openbb/
│   ├── sdk/                      # In-process SDK clients (equity, crypto, ...)
│   │   ├── executor.ts           # Singleton QueryExecutor
│   │   ├── base-client.ts        # Base class for SDK clients
│   │   └── *-client.ts           # Domain-specific SDK clients
│   ├── equity/                   # Equity data layer + SymbolIndex
│   ├── crypto/                   # Crypto data layer
│   ├── currency/                 # Currency/forex data layer
│   ├── commodity/                # Commodity data layer
│   ├── economy/                  # Economy data layer
│   ├── news/                     # News data layer
│   └── credential-map.ts         # Config key → OpenBB credential mapping
│
├── src/extension/
│   ├── analysis-kit/             # Technical indicator calculator
│   ├── equity/                   # Equity research tools
│   ├── market/                   # Unified symbol search
│   └── news/                     # News tools
│
└── data/config/market-data.json       # Runtime configuration
```

**Data flow (SDK mode):**
```
Alice asks for AAPL quote
  → ToolCenter dispatches to equity extension
    → SDKEquityClient.getQuote()
      → QueryExecutor.execute('yfinance', 'EquityQuote', { symbol: 'AAPL' })
        → YFinanceFetcher hits Yahoo Finance API
          → Returns structured data
```

No HTTP. No Python. No sidecar. Just TypeScript all the way down.

---

## TL;DR

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install && pnpm build
pnpm dev
# Open http://localhost:3002 and ask Alice about any stock, crypto, or macro data
```

Everything works out of the box. OpenTypeBB is the default data backend, `yfinance` is the default provider, and neither requires an API key. Add keys to `data/config/market-data.json` when you want to unlock more providers.
