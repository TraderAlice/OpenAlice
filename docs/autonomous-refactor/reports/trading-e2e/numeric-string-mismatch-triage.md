# Trading E2E Numeric/String Mismatch Triage

## Metadata

- Issue: `OPE-6`
- Scope: triage only
- Target suite: `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts`
- Baseline artifact: `docs/autonomous-refactor/reports/baseline/phase-1-baseline-report.md`
- Result: stale e2e expectations; monetary public fields are strings

## Commands Run

```bash
pwd
git rev-parse --show-toplevel
git status --short
pnpm vitest run --config vitest.e2e.config.ts src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts
rg "98500|100000|144" src/domain/trading
rg "toString|Decimal|decimal|cash|equity|balance|snapshot|portfolio" src/domain/trading
rg "uta-lifecycle" src/domain/trading
```

The originally suggested command:

```bash
pnpm test:e2e -- src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts
```

was not the targeted command used by the project. The run used the existing
Vitest e2e config directly:

```bash
pnpm vitest run --config vitest.e2e.config.ts src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts
```

## Failing Assertions

The Phase 1 baseline recorded four failures in
`src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts`:

- `account.totalCashValue`: expected `98500`, received `"98500"`
- `state.totalCashValue`: expected `98500`, received `"98500"`
- `positions[0].avgCost`: expected `144`, received `"144"`
- `account.totalCashValue`: expected `100000`, received `"100000"`

The affected test assertions are the cash and average-cost checks in the UTA
lifecycle e2e suite.

## Evidence

`src/domain/trading/brokers/types.ts` documents the public trading DTO contract:

- `Position.avgCost` is a `string`
- `AccountInfo.totalCashValue` is a `string`
- monetary fields are strings to avoid IEEE 754 floating-point artifacts

`src/domain/trading/brokers/mock/MockBroker.ts` follows that contract:

- `getAccount()` returns `totalCashValue: this._cash.toString()`
- `getPositions()` returns `avgCost: pos.avgCost.toString()`
- position restore converts persisted string values back into `Decimal`

Adjacent tests already treat the same boundary as string-valued:

- `src/domain/trading/brokers/mock/MockBroker.spec.ts`
- `src/domain/trading/snapshot/snapshot.spec.ts`
- `src/domain/trading/brokers/ccxt/CcxtBroker.spec.ts`
- `src/domain/trading/brokers/alpaca/AlpacaBroker.spec.ts`
- live broker e2e tests convert with `Number(...)` when numeric comparison is
  intended

## Diagnosis

The mismatch is best classified as:

1. obsolete test expectation
2. intentional Decimal/string boundary

It does not look like an unintended serialization regression or a deeper
trading DTO/accounting issue. The runtime values match the documented contract:
monetary public fields remain strings, while arithmetic uses `Decimal`.

## Public Boundary Decision

The public trading boundary should remain string-valued for money fields.

Rationale:

- the contract explicitly says monetary fields are strings
- `MockBroker`, snapshot tests, broker tests, and live e2e tests already align
  with string monetary values
- string DTO values preserve decimal precision across JSON and TypeScript/Rust
  boundaries
- callers that need arithmetic should convert to `Decimal` or explicitly use
  `Number(...)` in tests where approximate numeric comparison is intentional

## ADR Need

No ADR is needed if the follow-up only updates stale e2e expectations to match
the current string monetary contract.

An ADR would be needed only if the project intentionally changes public monetary
fields from strings back to numbers, because that would alter the precision and
DTO boundary captured in the trading-core contract.

## Recommended Next Issue

Recommended follow-up:

`Fix trading lifecycle e2e monetary string expectations`

Allowed file should be limited to:

- `src/domain/trading/__test__/e2e/uta-lifecycle.e2e.spec.ts`

Preferred fix:

- compare string monetary values directly for contract checks
- use `Number(...)` only if an assertion is intentionally checking arithmetic
  rather than DTO shape

## Operator Note

This triage report records the intended OPE-6 artifact. A later automated
follow-up created and partially executed `OPE-10` before human review, changing
the e2e test file locally. That source change is not part of this triage report
and should not be treated as canonical until explicitly reviewed and approved.
