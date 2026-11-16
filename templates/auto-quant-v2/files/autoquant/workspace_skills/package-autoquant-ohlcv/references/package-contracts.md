# AutoQuant OHLCV package selection

| Version | Use |
| --- | --- |
| V1 | Common aligned daily session observations for fixed or multi-lane research |
| V2 | Complete continuous UTC 1h bars with declared derived intervals |
| V3 | Configurable continuous or calendar-verified XNYS intraday base |
| V4 | Ragged observed-only daily Factor panel; never fixed Portfolio/RL |
| V5 | Close-time-aware observed base-bar Factor panel through `1d` |
| V6 | Compatible complete V5 inventories from distinct provider claims, with per-asset source identity |

## Required daily checks

- Conventional date/open/high/low/close/volume columns.
- Parseable ordered unique dates.
- Nonnegative volume and consistent OHLC bounds.
- Exact per-asset observed range and row count.
- Union/intersection coverage and missing-observation policy.
- Explicit market, calendar, timezone, venue, currency, and asset class.
- Explicit raw/split/dividend/provider adjustment claim.

## Required intraday checks

Additionally prove timezone-aware bar-close timestamps, base-grid
completeness or observed-only authority, session boundaries, DST/early-close
behavior where applicable, terminal partial-bucket policy, and causal
completed aggregation.

A provider's timestamp may label bucket start rather than completed bar close.
That provider Skill must preserve the raw label and prove an exact calendar
mapping before it emits V3. Packaging never fixes labels by adding one nominal
duration blindly: XNYS's terminal bucket may be shorter, and a provider close
marker may not be the missing bucket's OHLCV.

Never select a richer version simply because it accepts more fields.

## Required V5 cross-market checks

- Preserve an exact timezone-aware completed close timestamp for every row,
  including daily rows; a civil date is insufficient authority.
- Disclose how date-only provider data was mapped to exchange close instants.
- Keep later same-date market closes unavailable to an earlier target close.
- Preserve absent rows without fill; candidate code owns any explicit backward
  as-of use of already completed context.

## Daily close-time authority manifest

Use this exact JSON shape with
`scripts/materialize_daily_close_time.py`:

```json
{
  "schemaVersion": 1,
  "kind": "autoquant-daily-close-time-authority",
  "sourcePackage": {
    "id": "date-labelled-cross-market-daily",
    "version": "2024-01-02_2026-07-31",
    "sha256": "<exact lowercase package SHA-256>"
  },
  "outputDataset": {
    "id": "calendar-close-cross-market-daily",
    "version": "2024-01-02_2026-07-31-close-v1"
  },
  "calendarAuthority": {
    "library": "exchange_calendars",
    "version": "4.13.2",
    "closeSemantics": "scheduled-regular-session-close",
    "limitations": [
      "Pinned library schedules are research authority, not authenticated exchange records."
    ]
  },
  "assets": [
    {
      "symbol": "7203.T",
      "calendar": "XTKS",
      "timezone": "Asia/Tokyo",
      "volumeSemantics": "provider-reported-nonnegative"
    },
    {
      "symbol": "SPY",
      "calendar": "XNYS",
      "timezone": "America/New_York",
      "volumeSemantics": "provider-reported-nonnegative"
    }
  ]
}
```

Get `sourcePackage.sha256` from `audit_ohlcv_package.py`'s
`packageSha256`. Query the installed calendar version when needed:

```bash
aq-python -c 'from importlib.metadata import version; print(version("exchange-calendars"))'
```

The source must be one structurally strict V4 `1d` observed-only,
absent-no-fill package with complete per-asset classes and date-first OHLCV
files. The authority asset set must exactly equal the source inventory. Use
canonical calendar names rather than aliases. The declared timezone must equal
the selected calendar's timezone, and every source date must be a real session
in that pinned schedule.

`provider-reported-nonnegative` preserves nonnegative source volume.
`unavailable-zero` is accepted only when every source volume is zero. The V5
package preserves source provider, adjustment, class, venue, currency, rows,
and OHLCV values. Its fixed top-level market becomes `provider-observed`/UTC;
the source V4 market claim and all per-asset calendar mappings remain in the
transformation audit.

The procedure maps only session date → scheduled regular close UTC. It does
not authenticate an exchange, infer a calendar, handle an intraday bucket,
align calendars, fill absence, drop a non-session row, or approximate a close
with a fixed UTC time.

## V6 observed-package composition authority

Use this exact JSON shape with
`scripts/compose_observed_packages.py`:

```json
{
  "schemaVersion": 1,
  "kind": "autoquant-observed-package-composition",
  "outputDataset": {
    "id": "toyota-spy-dual-provider-daily",
    "version": "2024-01-02_2026-07-31-v1"
  },
  "sourcePackages": [
    {
      "id": "tokyo-yahoo",
      "path": "sources/tokyo/dataset-package.json",
      "sha256": "<exact lowercase source-manifest SHA-256>"
    },
    {
      "id": "us-nasdaq",
      "path": "sources/us/dataset-package.json",
      "sha256": "<exact lowercase source-manifest SHA-256>"
    }
  ]
}
```

Resolve each POSIX-relative `path` from the authority file's directory. Every
source must be a strict, independently audited V5 package. The source id is a
lowercase path-safe identity recorded on every output asset. Source ids,
manifest hashes, and all symbols must be unique; every declared source must
contribute at least one asset; and at least two normalized provider claims
must differ.

All sources must agree exactly on `baseInterval`, bar-close timestamp
semantics, observed-only panel policy, provider-observed UTC market, and
top-level price adjustment. The output contains the complete ordered union of
the source inventories. Composition copies the original CSV, Parquet, or
Feather bytes and records input/output hashes, rows, timestamps, and
preservation claims in `composition-audit.json`. It does not authenticate a
provider, select assets, align clocks, fill missing observations, convert
adjustments, or resolve duplicate symbols.
