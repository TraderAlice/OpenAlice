# Contract search normalization rules

## What this is

A small set of pure functions that translate a **data-vendor symbol**
(what yfinance / FMP / similar return — e.g. `BTCUSD`, `EURUSD`,
`AAPL`) into a **broker search pattern** (what each `Broker.searchContracts`
implementation actually expects — e.g. `BTC`, `EUR`, `AAPL`).

Lives in `contract-search-rules.ts`, alongside the rest of the
contract-search domain layer.

## Why it lives in its own file

Three places call broker-side contract search, all of them needing the
same normalization:

- AI tool `searchContracts` (`src/tool/trading.ts`) — invoked by an LLM
  that may have just been looking at market-data symbols.
- HTTP route `/api/trading/contracts/search` (`src/connectors/web/routes/trading.ts`)
  — invoked by the UI from a `/market/:assetClass/:symbol` page.
- UI panel `TradeableContractsPanel` (the route's only current consumer).

If the rules lived inside any one of them, the others would silently
drift. Pulling them out gives one place to fix conventions when a new
broker shows up or when a vendor changes how it spells crypto pairs.

## The non-negotiable rule

**Data-vendor symbol identity is NOT trading symbol identity.**

This module's job is *not* to make them equal. It does the smallest
possible normalization that lets a broker's deliberately-strict
matcher return something useful for the user. After that, the
canonical identity downstream is the broker's `aliceId`
(`alias:broker:exchange-id`) — that's what `placeOrder` and friends
key off, never the raw symbol the data vendor reported.

The bridge is heuristic on purpose. If we get hits, great. If we
don't, the user-facing card says "no matches" and the user moves on.
We don't try to be clever in either direction.

## Current rules

| Asset class            | Rule                                                                                                | Why                                                                                                                                                                |
|------------------------|-----------------------------------------------------------------------------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `equity` / `commodity` | identity (no change)                                                                                | Data vendor and broker conventions match — `AAPL` is `AAPL` everywhere we currently care about.                                                                    |
| `crypto` / `currency`  | strip a known quote-currency suffix (USDT/USDC/BUSD/USD/EUR/JPY/GBP/CNY); base must be ≥ 2 chars     | Vendors concatenate (`BTCUSD`, `EURUSD`); CCXT's `searchContracts` does base-only equality. Stripping the quote currency recovers the broker's expected pattern. The ≥ 2 floor avoids murdering tickers like `LUSD` (the Liquity stablecoin) into `L`. |
| `unknown` / not given  | identity                                                                                            | Don't speculate. Caller knows the asset class or they don't — guessing produces worse failures than passing through.                                              |

## When to add a rule

Only when an actual provider/broker case has been observed failing in
production or QA. Examples we expect to bump into eventually:

- IBKR option chains return symbols with embedded expiry/strike that
  brokers don't accept verbatim.
- Some brokers want `BRK.B`, others want `BRK-B`.
- yfinance currency pairs come as `EUR=X` (note the `=X` suffix).

When that happens: add a branch in `normalizeBrokerSearchPattern`,
add a test to `contract-search-rules.spec.ts`, add a row to the
table above. Each rule should be the smallest change that fixes the
observed case.

## When NOT to add a rule

- **Don't loosen the broker's strict matching to compensate.** Strict
  matching is a feature — `CcxtBroker.searchContracts` uses base-only
  equality on purpose so a search for `BTC` doesn't pollute the result
  list with every meme token whose symbol happens to contain those
  three letters.
- **Don't try to bridge identities.** If a normalization rule starts
  reaching for the broker's `aliceId` or the contract's `conId`, stop.
  That belongs at a different layer (and probably means we're using
  this function for the wrong purpose).
- **Don't add speculative rules.** "What if some broker someday wants
  X" is not a reason. Wait for the actual case; the rule will be
  cleaner when you can see it.

## How a future change should look

```ts
// inside normalizeBrokerSearchPattern
case 'crypto':
case 'currency':
  return stripQuoteCurrency(symbol)
case 'option':                                    // <- new
  return parseOccSymbol(symbol)?.underlying ?? symbol
```

Plus:

- A new test in `contract-search-rules.spec.ts` covering one happy
  case and at least one shape that *shouldn't* match the new rule
  (so future edits know the rule's boundary).
- A new row in the table above.
- A line in the relevant `Broker.searchContracts` docstring if the
  broker side has matching expectations.
