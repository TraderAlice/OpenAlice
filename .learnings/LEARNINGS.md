# Project Learnings: OpenAlice

This file logs key technical findings, architectural decisions, and bug root causes to prevent regressions and improve future implementation.

---

## [LRN-20260415-001] CCXT Exchange Demo Mode handling (OKX vs Bybit)

**Logged**: 2026-04-15T21:45:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend | trading

### Summary
OKX calls to `enableDemoTrading()` clear `urls.api` in CCXT; OKX needs `setSandboxMode(true)`, while Bybit needs `enableDemoTrading(true)`.

### Details
- Calling `enableDemoTrading()` on OKX in CCXT v4+ triggers an internal logic that clears the `urls.api` if no explicit `demo` URL is defined in the CCXT exchange configuration. This causes all subsequent API calls (like `fetchMarkets`) to fail with "undefined URL" errors.
- **Correct approach for OKX**: Only use `setSandboxMode(true)` which adds the `x-simulated-trading: 1` header.
- **Correct approach for Bybit**: Must use `enableDemoTrading(true)` to route to the correct demo endpoints.

### Suggested Action
Always use the exchange-specific routing logic in `CcxtBroker.ts` for sandbox/demo mode toggles.

### Metadata
- Source: error
- Related Files: src/domain/trading/brokers/ccxt/CcxtBroker.ts
- Tags: ccxt, okx, bybit, demo, sandbox
- Pattern-Key: broker.init.demo_mode

### Resolution
- **Resolved**: 2026-04-15
- **Notes**: Implemented exchange-specific branching in `CcxtBroker` constructor and added unit tests in `CcxtBroker.spec.ts`.

---

## [LRN-20260415-002] OKX fetchMarkets requires explicit `type` parameter

**Logged**: 2026-04-15T21:45:00Z
**Priority**: high
**Status**: resolved
**Area**: backend | trading

### Summary
OKX `fetchMarkets` defaults to `SPOT`; `{ type }` must be passed in `params` to fetch `SWAP` or `FUTURE`.

### Details
- By default, OKX API responses only return SPOT instruments if no `instType` is specified. CCXT's `fetchMarkets` implementation for OKX requires `type` (which maps to `instType`) to be passed in the second parameter object.
- Failure to pass this leads to `instType` missing or incorrect errors when attempting to trade swaps/futures.

### Suggested Action
When calling `fetchMarkets` in any broker, ensure common parameters like `type` are passed to the underlying CCXT method.

### Metadata
- Source: error
- Related Files: src/domain/trading/brokers/ccxt/CcxtBroker.ts
- Tags: okx, fetchMarkets, instType
- Pattern-Key: broker.fetchMarkets.params

### Resolution
- **Resolved**: 2026-04-15
- **Notes**: Fixed by passing `{ ...params, type }` in `CcxtBroker.init()`.

---

## [LRN-20260415-003] AI Tool Output Serialization (DataCloneError)

**Logged**: 2026-04-15T21:45:00Z
**Priority**: critical
**Status**: resolved
**Area**: backend | ai

### Summary
`Decimal` objects (from `decimal.js`) contain methods and fail `structuredClone`; all tool outputs must serialize `Decimal` to `string`.

### Details
- The Vercel AI SDK and Telegram connectors use `structuredClone` (or similar deep serialization) which fails when encountering objects with functions (like `Decimal` instances). This triggers a `DataCloneError`.
- **UNSET_DECIMAL handle**: Must check for the internal `UNSET_DECIMAL` sentinel value to avoid returning the extremely long magic number string to the AI.

### Suggested Action
Use a utility like `summarizeOperation` to wrap all trading tool results and convert `Decimal` fields to strings or numbers before returning to the AI engine.

### Metadata
- Source: error | user_feedback
- Related Files: src/tool/trading.ts
- Tags: serialization, DataCloneError, decimal.js, vercel-ai-sdk
- Pattern-Key: tool.serialization.decimal

### Resolution
- **Resolved**: 2026-04-15
- **Notes**: Implemented `summarizeOperation` and `decimalMaxString` helpers in `src/tool/trading.ts` and updated all trading tools. Added unit tests in `trading.spec.ts`.

---

## [LRN-20260415-004] OperationGuard side effects and double-click race conditions

**Logged**: 2026-04-15T21:45:00Z
**Priority**: high
**Status**: resolved
**Area**: backend | trading

### Summary
Stateful guards like `CooldownGuard` must not mutate state in the `check()` phase, as rapid duplicate requests (e.g., from Telegram double clicks) cause false rejections.

### Details
- In Telegram, pressing the "Approve" button multiple times quickly can dispatch overlapping `push()` operations because Telegram lacks native UI element disablement.
- If a guard (like `CooldownGuard`) mutates state (like `lastTradeTime`) inside its `check()` function, the first push will set the state, causing the second push to fail validation. Worse, the second (failed) operation will clear the staging area and return `rejected` to the UI, obscuring the success of the first operation.

### Suggested Action
State updates for guards must happen only after successful execution using an `onSuccess` hook, ensuring failed or cancelled attempts don't affect subsequent validations. Additionally, critical actions like `push` should employ an explicit atomic lock (`isPushing`). Finally, connectors like Telegram should provide immediate visual feedback (e.g., editing the message to "Processing...") to prevent further clicks.

### Metadata
- Source: bug | user_feedback
- Related Files: src/domain/trading/guards/cooldown.ts, src/domain/trading/git/TradingGit.ts, src/connectors/telegram/telegram-plugin.ts
- Tags: guard, race-condition, double-click, cooldown, telegram
- Pattern-Key: guard.side_effect.check

### Resolution
- **Resolved**: 2026-04-15
- **Notes**: Added `onSuccess` hook to `OperationGuard` and refactored `CooldownGuard`. Added `isPushing` flag to `TradingGit`. Implemented visual feedback for Telegram plugin.

---

## [LRN-20260419-001] Broker Contract Resolution from aliceId

**Logged**: 2026-04-19T10:20:00Z
**Priority**: high
**Status**: resolved
**Area**: backend | trading

### Summary
When an AI tool passes a `Contract` object containing only an `aliceId` (e.g., `ccxt-okx-test|ETH/USDT`), it must be explicitly resolved into broker-native fields (like `localSymbol` or `symbol`) before being sent to the broker adapter (like `CcxtBroker`), otherwise the broker cannot identify the market and fails.

### Details
- The AI uses `aliceId` to uniquely identify an asset across different accounts (format: `{utaId}|{nativeKey}`).
- Broker adapters (like `CcxtBroker` and `AlpacaBroker`) rely on `localSymbol`, `symbol`, or `conId` to perform API calls (e.g., fetching quotes or contract details).
- If `getQuote` or `getContractDetails` simply passes the `Contract` object down to the broker without parsing the `aliceId`, the broker's internal mapping logic (like `contractToCcxt`) will return `null` or throw an error.

### Suggested Action
Always use a central helper method (e.g., `resolveContract` in `UnifiedTradingAccount`) to parse the `aliceId` and populate the `Contract` object via the broker's `resolveNativeKey()` method before dispatching calls like `getQuote` or `getContractDetails`.

### Metadata
- Source: error
- Related Files: src/domain/trading/UnifiedTradingAccount.ts, src/domain/trading/brokers/ccxt/CcxtBroker.ts
- Tags: aliceId, resolution, ccxt, getQuote, getContractDetails
- Pattern-Key: broker.contract.resolution

### Resolution
- **Resolved**: 2026-04-19
- **Notes**: Added `resolveContract` helper to `UnifiedTradingAccount` and updated `getQuote` and `getContractDetails` to use it. Corrected out-of-date CCXT documentation regarding the `aliceId` format.

---
## [LRN-20260419-001] ccxt-spot-balances

**Logged**: 2026-04-19T11:25:00Z
**Priority**: high
**Status**: resolved
**Area**: backend

### Summary
CcxtBroker ignored Spot balances in portfolio view and equity calculation.

### Details
- The original CcxtBroker implementation only fetched futures/margin positions via `fetchPositions()`.
- Spot holdings (e.g. BTC, ETH in Spot wallet) were invisible to the user and their market value was not included in `netLiquidation`.
- This led to misleading account equity and "missing" assets after spot trades.

### Suggested Action
Merge Spot balances from `fetchBalance()` into the results of `getPositions()` and `getAccount()`. Use `fetchTickers()` to batch-fetch current prices for non-stablecoin assets to calculate their USD market value. Filter out "dust" balances (< $1 USD) to keep the view clean.

### Metadata
- Source: user_feedback
- Related Files: src/domain/trading/brokers/ccxt/CcxtBroker.ts, src/domain/trading/brokers/ccxt/CcxtBroker.spec.ts
- Tags: ccxt, spot, balance, equity, okx, bybit
- Pattern-Key: broker.ccxt.spot-visibility

### Resolution
- **Resolved**: 2026-04-19
- **Notes**: Implemented `fetchSpotBalancesAsPositions` helper in CcxtBroker. Updated `getAccount` and `getPositions` to merge spot assets and include them in equity calculations. Added unit tests to verify.

---
