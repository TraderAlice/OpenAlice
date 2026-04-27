# Trading Core Golden Fixtures Report

## Metadata

- Issue: `OPE-11`
- Module: `trading_core`
- Fixture capture date: `2026-01-02T03:04:05.678Z` fixed fixture clock
- Execution date: `2026-04-28` JST
- Scope: legacy TypeScript fixture capture only
- Production source edits: none
- Existing test edits: none

## Artifacts

- `docs/autonomous-refactor/fixtures/trading-core/capture-trading-core-fixtures.ts`
- `docs/autonomous-refactor/fixtures/trading-core/stage-commit-push.fixture.json`
- `docs/autonomous-refactor/fixtures/trading-core/guard-outcomes.fixture.json`
- `docs/autonomous-refactor/fixtures/trading-core/snapshot-accounting-precision.fixture.json`

## Exact Commands Run

| Command | Exit | Result | Evidence |
| --- | ---: | --- | --- |
| `pwd` | 0 | PASS | `/Users/opcw05/newtest/001/OpenAlice` |
| `git rev-parse --show-toplevel` | 0 | PASS | `/Users/opcw05/newtest/001/OpenAlice` |
| `git status --short` | 0 | PASS | clean before artifact generation |
| `node -v` | 0 | PASS | `v25.9.0` |
| `pnpm -v` | 0 | PASS | `9.15.4` |
| `pnpm test -- src/domain/trading/git/TradingGit.spec.ts src/domain/trading/guards/guards.spec.ts src/domain/trading/snapshot/snapshot.spec.ts src/domain/trading/account-manager.spec.ts src/domain/trading/UnifiedTradingAccount.spec.ts` | 0 | PASS | 5 files passed, 179 tests passed |
| `pnpm vitest run --config vitest.e2e.config.ts src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts` | 0 | PASS | 1 file passed, 15 tests passed; Vitest printed the existing `test.poolOptions` deprecation warning |
| `pnpm exec tsx docs/autonomous-refactor/fixtures/trading-core/capture-trading-core-fixtures.ts` | 0 | PASS | generated all three fixture JSON files |
| `jq empty docs/autonomous-refactor/fixtures/trading-core/*.json` | 0 | PASS | all fixture files parse as JSON |
| `pnpm exec tsx docs/autonomous-refactor/fixtures/trading-core/capture-trading-core-fixtures.ts && jq empty docs/autonomous-refactor/fixtures/trading-core/*.json` | 0 | PASS | final regenerate plus JSON validation after report creation |
| `shasum docs/autonomous-refactor/fixtures/trading-core/*.json > /tmp/trading-core-fixtures.before; pnpm exec tsx docs/autonomous-refactor/fixtures/trading-core/capture-trading-core-fixtures.ts >/tmp/trading-core-fixture-regenerate.log; shasum docs/autonomous-refactor/fixtures/trading-core/*.json > /tmp/trading-core-fixtures.after; diff -u /tmp/trading-core-fixtures.before /tmp/trading-core-fixtures.after` | 0 | PASS | fixture regeneration is byte-stable |

## Fixture Coverage

### Stage, Commit, Push

`stage-commit-push.fixture.json` captures deterministic public behavior through `UnifiedTradingAccount`, `TradingGit`, and `MockBroker`.

- Market buy stage records a staged operation and leaves `broker.placeOrder` at `0` calls.
- Commit prepares pending hash/message without broker side effects.
- Push calls the broker once, clears staging, records the commit, and stores account/position values as strings.
- Limit order push records a submitted order, `sync()` returns no update before fill, then records a filled sync commit after `MockBroker.fillPendingOrder()`.
- Manual reject records a `[rejected]` commit and skips broker execution.
- Precondition errors are captured for empty commit and push-before-commit.

### Guard Behavior

`guard-outcomes.fixture.json` captures representative direct guard and pipeline outcomes.

- `max-position-size` allow and reject cases, including existing position plus new order value.
- `symbol-whitelist` allow and reject cases.
- `cooldown` first-trade allow and repeated-trade reject with a fixed clock.
- UTA guard pipeline allow path calls broker execution.
- UTA guard pipeline reject path returns `[guard:symbol-whitelist] ...`, records a rejected operation, and keeps `broker.placeOrder` at `0`.
- Registry behavior records built-in guard resolution and unknown guard skip warning.

### Snapshot, Accounting, Precision

`snapshot-accounting-precision.fixture.json` captures string-valued monetary boundaries and deterministic snapshot DTOs.

- Snapshot with one AAPL position and one pending limit order.
- Account fields such as `netLiquidation`, `totalCashValue`, `unrealizedPnL`, and `realizedPnL` remain strings.
- Position fields such as `quantity`, `avgCost`, `marketPrice`, `marketValue`, and PnL values remain strings at the snapshot/public JSON boundary.
- Lifecycle monetary expectations are captured as strings:
  - market buy cash: `"98500"`
  - limit fill average cost: `"144"`
  - full close cash: `"100000"`
- JSON serialization of staged price/quantity emits strings, including crypto-scale values like `"0.12345678"` and `"0.00001234"`.
- `AccountManager.getAggregatedEquity()` totals remain string-valued.

## OPE-6 and OPE-10 Evidence

The OPE-6 report classified the original lifecycle failures as stale numeric expectations against an intentional Decimal/string boundary. The current e2e suite now expects string monetary values and passes under the targeted e2e command. These fixtures preserve that current public boundary for future Rust parity work.

## Gaps and Limits

- Broker adapters are intentionally not captured; fixtures use `MockBroker` only.
- Commit hashes are deterministic here because the capture script fixes `Date`; production hashes still vary with real timestamps.
- This captures representative guard outcomes, not an exhaustive property matrix for every guard input combination.
- Snapshot store chunking is not included because this issue targets trading snapshot/accounting DTO behavior, not storage-core persistence.

## Recommended Next Issue

Create a trading-core parity replay harness once the Rust crate or Node binding exists. The harness should load these JSON fixtures, run the legacy TypeScript path and Rust path under `OPENALICE_RUST_TRADING_CORE=0|1`, and diff stage/commit/push, guard, snapshot, and monetary string outputs before any Rust trading implementation is considered complete.

## Rollback Note

If a future Rust path cannot reproduce these fixtures without changing public DTO shape or trading semantics, keep `OPENALICE_RUST_TRADING_CORE=0`, preserve the failing fixture diff, and request trading safety plus architecture review before changing expectations.
