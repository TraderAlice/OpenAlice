---
name: acquire-market-ohlcv
description: Acquire and ingest historical OHLCV market data for AutoQuant Projects. Prioritizes OpenAlice's native `alice market bars` / `aq data fetch` or caller-provided CSV/Parquet files first, then routes venue-specific or adjustment-specific needs to the 14 bundled `fetch-*-ohlcv` scripts before honest quality inspection and direct ingestion into `<project>/data/`.
---

# Acquire Market OHLCV

Obtain clean, provenance-honest OHLCV bars for an AutoQuant Project and ingest them directly into `<project>/data/`.

Run any bundled Python skill script with `aq-python` (for example `uv run aq-python <script.py> ...`), never an ambient `python` or `python3`, so it always uses the AutoQuant Workspace environment.

## Priority Order

### 1. OpenAlice Native Market Data or Caller Files First

Before scraping or invoking external provider routes, check whether the required symbols, interval, and date history are already available cleanly:

- **Caller-supplied CSV or Parquet**: Inspect columns, timestamps, missing bars, and price-adjustment semantics, then ingest directly:
  ```bash
  uv run aq data ingest . /path/to/bars.csv --project <project-id> --dataset-id <dataset-id> --source caller
  ```
- **OpenAlice Market Bridge (`alice` CLI on `PATH`)**: Search canonical bar IDs with `alice market search-bars` and pull bars directly into the Project (or use `traderhub` when appropriate):
  ```bash
  alice market search-bars "SPY"
  uv run aq data fetch . --project <project-id> \
    --bar-id AMEX:SPY --bar-id NASDAQ:QQQ \
    --interval 1d --count 1500 --dataset-id <dataset-id> --json
  ```
  Or in Python:
  ```python
  import autoquant as aq

  df = aq.fetch_alice_bars(["AMEX:SPY", "NASDAQ:QQQ"], interval="1d", count=1500)
  aq.ingest_ohlcv("projects/<project-id>", df, dataset_id="<dataset-id>", source="alice-market")
  ```

### 2. Bundled Venue Fetcher Skills (`$fetch-*-ohlcv` via `aq-python`)

When `alice market bars` is unavailable or when a study needs a specific regional venue, deeper history, or explicit raw vs split/dividend adjustment semantics, consult the relevant market guide and run **one** appropriate bundled fetcher skill:

- **Checklist**: [common-acquisition-checklist.md](references/common-acquisition-checklist.md)
- **U.S. equities & ETFs** (`$fetch-yahoo-ohlcv`, `$fetch-nasdaq-ohlcv`): [us-equities.md](references/us-equities.md)
- **Crypto Spot `1h`** (`$fetch-binance-ohlcv`): continuous UTC closed K-lines
- **Mainland China A-shares `XSHG`/`XSHE`/`XBSE`** (`$fetch-eastmoney-ohlcv`, `$fetch-sina-ohlcv`, `$fetch-tencent-ohlcv`, `$fetch-sohu-ohlcv`, `$fetch-yahoo-ohlcv`): [cn-a-shares.md](references/cn-a-shares.md)
- **Taiwan `TWSE`** (`$fetch-twse-ohlcv`, `$fetch-finmind-ohlcv`, `$fetch-yahoo-ohlcv`): [taiwan-equities.md](references/taiwan-equities.md)
- **South Korea `XKRX`** (`$fetch-naver-ohlcv`, `$fetch-daum-ohlcv`, `$fetch-yahoo-ohlcv`): [south-korea-equities.md](references/south-korea-equities.md)
- **Japan `XTKS`** (`$fetch-yahoo-ohlcv`, `$fetch-nikkei-ohlcv`): [japan-equities.md](references/japan-equities.md)
- **Vietnam `HOSE`/`HNX`/`UPCoM`** (`$fetch-vndirect-ohlcv`, `$fetch-yahoo-ohlcv`): [vietnam-equities.md](references/vietnam-equities.md)
- **European Union (`XPAR`)** (`$fetch-euronext-ohlcv`, `$fetch-yahoo-ohlcv`): [eu-equity-venues.md](references/eu-equity-venues.md)

## Inspect Data Quality Honestly & Ingest Directly

There is **no mandatory two-source scraping gate**, **no `route-failure.json` wrapper requirement**, and **no `staging/` manifest ceremony**:

1. **Fetch into a temporary or local download folder** (for example `/tmp/aq-fetch/<dataset-id>`) when running a `fetch-*-ohlcv` script.
2. **Verify data quality before research**:
   - Confirm exact start/end dates, bar count, completed-bar close semantics (never include a forming intraday/current-session bar), and `high >= max(open, close) >= min(open, close) >= low`.
   - Check missing sessions, trading halts/suspensions, zero-volume bars, volume units (shares vs 100-share lots), and corporate-action adjustments (`raw` vs `split-adjusted` vs `split-and-dividend-adjusted`).
   - Cross-check a second source only when splits, jumps, or missing observations look suspicious.
   - Never silently forward-fill market closures or trading suspensions.
3. **Ingest directly into `<project>/data/`**:
   ```bash
   uv run aq data ingest . /tmp/aq-fetch/<dataset-id> \
     --project <project-id> \
     --dataset-id <dataset-id> \
     --source <provider-name> \
     --json
   ```
   Or pass the folder, CSV, Parquet, or normalized `DataFrame` to `aq.ingest_ohlcv("projects/<project-id>", ..., dataset_id=..., source=...)`. See `$package-autoquant-ohlcv` if you need multi-exchange daily close-time mapping (`exchange_calendars`) or optional cross-provider comparison utilities.
