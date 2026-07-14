# UTA Acceptance Tests

This directory contains two deliberately separate acceptance layers:

- `uta-lifecycle.e2e.spec.ts` uses `MockBroker` and is part of the ordinary,
  non-trading product E2E suite.
- The broker and `uta-*` paper/demo specs talk to configured external accounts.
  Several of them submit and cancel orders, so they only run through the
  explicit live-paper command.

## Running

```bash
# Safe product/integration E2E. Never submits broker orders.
pnpm test:e2e

# Explicit UTA acceptance against configured demo/paper accounts.
# Verify the accounts first and leave them flat when the suite finishes.
OPENALICE_UTA_LIVE_PAPER=1 pnpm test:uta:live-paper
```

The live-paper tests run sequentially (`fileParallelism: false`) because broker
APIs and accounts are shared resources. Without the acknowledgement variable,
the live-paper config exits before collecting tests or initializing a broker.

## File Naming

| Pattern | Level | Example |
|---------|-------|---------|
| `{broker}.e2e.spec.ts` | Broker API | `alpaca-paper`, `ibkr-paper` — calls `broker.placeOrder()` directly |
| `uta-{broker}.e2e.spec.ts` | UTA (Trading-as-Git) | `uta-alpaca`, `uta-ibkr` — uses `stagePlaceOrder → commit → push` |
| `uta-lifecycle.e2e.spec.ts` | UTA + MockBroker | Pure in-memory; ordinary `test:e2e` |

## Precondition Pattern

Use `beforeEach(({ skip }) => ...)` for preconditions — **never** `if (!x) return` inside test bodies.

```typescript
// ✅ Correct — shows as "skipped" in report
beforeEach(({ skip }) => {
  if (!broker) skip('no account configured')
  if (!marketOpen) skip('market closed')
})

it('fetches account', async () => {
  const account = await broker!.getAccount()  // broker guaranteed non-null
})

// ❌ Wrong — shows as "passed" even though nothing ran
it('fetches account', async () => {
  if (!broker) return  // silent pass, misleading
})
```

For runtime data dependencies inside a test (e.g., contract search fails), use `skip()` from the test context:

```typescript
it('places order', async ({ skip }) => {
  const matches = await broker!.searchContracts('ETH')
  const perp = matches.find(...)
  if (!perp) skip('ETH perp not found')
})
```

## Market Hours

- **Crypto (CCXT)**: 24/7, no market hours check needed
- **Equities (Alpaca, IBKR)**: Split into three `describe` groups:
  - **Connectivity** — any time (getAccount, getPositions, searchContracts, getMarketClock)
  - **Order lifecycle** — any time (limit order place → query → cancel — exchanges accept orders outside trading hours, they just don't fill)
  - **Fill + position** — market hours only (market order → fill → verify position → close)

Check `broker.getMarketClock().isOpen` in `beforeAll`, skip fill group via `beforeEach`. Connectivity and order lifecycle always run.

## Setup

`setup.ts` provides a lazy singleton `getTestAccounts()` that:
1. Reads `accounts.json`
2. Filters for paper/sandbox accounts only via `isPaper()`:
   - Alpaca: `paper === true`
   - CCXT: `sandbox || demoTrading`
   - IBKR: `paper === true`
3. Checks credentials (API key for REST brokers; TCP reachability for local-process brokers like IBKR)
4. Calls `broker.init()` — if init fails, account is skipped with a warning

Brokers are shared across test files via module-level caching.

## IBKR-Specific

IBKR tests require TWS or IB Gateway running with paper trading enabled. Unlike REST-based brokers, IBKR connects via a local TCP socket — no API key is needed.

If TWS is not running, IBKR tests are automatically skipped (setup checks TCP reachability before attempting connection).

Default connection: `127.0.0.1:7497` (TWS paper). Override via `accounts.json`.
