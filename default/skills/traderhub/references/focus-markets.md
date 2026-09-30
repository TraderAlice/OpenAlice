# Focus markets (client preference)

Canonical Workspace file: **`.alice/focus-markets.json`**.

Agents read that path for daily cross-asset / market-brief work. The UI
watchlist (`openalice.watchlist.v1`) is browser-local and is **not** this
file. Do not put focus markets in `.alice/settings.json` (runtime/launch only).

If `.alice/focus-markets.json` is missing, treat focus markets as
`cn-ashare`, `us-equity`, `hk-equity`, and `macro`. Market briefs still always
cover `cn-ashare` even when the file omits it — say that you added it.

## Format

```json
{
  "version": 1,
  "markets": ["cn-ashare", "us-equity", "hk-equity", "macro"],
  "notes": "optional free text for the desk"
}
```

- `version` — currently `1`
- `markets` — ordered list of market ids (strings)
- `notes` — optional

Offer to write this file when the user wants a durable selection. Prefer JSON
over a free-form markdown list so ids stay machine-readable.

## Known ids

| Id | Meaning | Primary evidence surface |
|---|---|---|
| `cn-ashare` | China A-shares | CSI/CNI indexes first, then ETF/`market-data` bars; optional Tushare; not US `movers` |
| `us-equity` | US equities | `traderhub board get --board movers` + `board rotation` |
| `hk-equity` | Hong Kong | `alice market` bars (e.g. Yahoo `.HK` / HSI); optional **Longbridge** live quote via `alice-uta` if that UTA is connected — LB is **not** a historical bar source in OpenAlice today |
| `macro` | Rates / USD / oil / cross-country | `board macro`, `board global-macro`, `board fed` |
| `fx` | FX | currency bars + dollar card on `macro` |
| `crypto` | Crypto | `board term-structure` + crypto bars |
| `commodity` | Commodities | commodity bars + oil on `macro` |

Unknown ids: keep them in the brief scope, pull what tools allow, and name gaps.
