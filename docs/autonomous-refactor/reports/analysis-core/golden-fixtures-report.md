# Analysis Core Golden Fixtures Report

## Summary

Captured the Phase 1 legacy TypeScript behavior baseline for `analysis_core` without editing production source or existing tests.

- Fixture bundle: `docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json`
- Contract read: `docs/autonomous-refactor/module-contracts/analysis-core.md`
- Source commit captured in fixture: `a427f9f242c0e00e5f5b660487ebd4594e4448f5`
- Fixture cases captured: 38 total
- Production source edits: none
- Existing test edits: none

## Entry Points Frozen

The fixture bundle records the current public calculation/tool surfaces for:

| Entry point | Path | Frozen surface |
| --- | --- | --- |
| `createAnalysisTools().calculateIndicator.execute` | `src/tool/analysis.ts` | Tool name, input fields, asset enum, precision bounds, output shape, provider filtering/sorting behavior |
| `IndicatorCalculator.calculate` | `src/domain/analysis/indicator/calculator.ts` | Formula parsing/evaluation, precision behavior, dataRange shape, success/error distinction |
| `createThinkingTools().calculate.execute` | `src/tool/thinking.ts` | Tool name, `expression` input, numeric output/error behavior |
| `calculate(expression)` | `src/domain/thinking/tools/calculate.tool.ts` | Safe arithmetic validation, finite-result rejection, 4-decimal rounding |

## Fixture Coverage

`legacy-calculation-fixtures.json` includes:

- 24 `IndicatorCalculator.calculate` cases
- 4 `calculateIndicator` tool-shim cases
- 8 direct thinking `calculate(expression)` cases
- 2 thinking tool-shim cases

Covered behavior:

- Arithmetic precedence and parentheses
- Default and explicit precision
- `CLOSE`, `VOLUME`, negative array indexing, and `dataRange`
- `SMA`, `EMA`, `STDEV`, `MAX`, `MIN`, `RSI`, `BBANDS`, `MACD`, and `ATR`
- Complex expression evaluation over function results
- Empty series output
- Short-series insufficient-data errors
- String-result, unknown-function, division-by-zero, binary-type, bounds, and syntax errors
- Tool-shim raw-provider sorting and filtering of null OHLC bars
- Tool-shim `asset` routing for equity, crypto, currency, and commodity
- Thinking calculator invalid identifier/injection rejection and non-finite result rejection

## Commands Run

| Command | Result | Notes |
| --- | --- | --- |
| `pwd` | PASS | `/Users/opcw05/newtest/001/OpenAlice` |
| `git rev-parse --show-toplevel` | PASS | `/Users/opcw05/newtest/001/OpenAlice` |
| `git status --short` | PASS | Final status shows only `?? docs/autonomous-refactor/fixtures/` and `?? docs/autonomous-refactor/reports/analysis-core/` |
| `node -v && pnpm -v` | PASS | Node `v25.9.0`, pnpm `9.15.4` |
| `pnpm exec tsx <<'TS' ...` | PASS | Generated the legacy fixture outputs from current TypeScript entry points |
| `node -e "JSON.parse(...)"` | PASS | Parsed fixture and counted `24 4 8 2` case groups |
| `pnpm exec tsx <<'TS' ...` | PASS | Re-ran all fixture cases against current TypeScript behavior: `fixture parity verified 38` |
| `pnpm test -- src/domain/analysis/indicator/calculator.spec.ts src/domain/thinking/tools/calculate.tool.spec.ts` | PASS | 2 files passed, 64 tests passed |
| `git diff --check` | PASS | No whitespace errors |

## Gaps

- No production source or test harness was added because the operator approval explicitly limited writes to docs fixture/report paths.
- No Rust implementation, binding layer, or feature flag work was started.
- No benchmark fixture was captured in this issue.
- Provider/network behavior is not frozen beyond deterministic fake-client tool-shim cases.
- Parser internals are frozen through public formula inputs and observable errors, not by serializing the private AST.
- Sparse OHLC values other than tool-shim null OHLC filtering and `VOLUME` null normalization are not covered.

## Next Recommended Issue

After human fixture review, open a scoped implementation-prep issue to add a parity harness that consumes `legacy-calculation-fixtures.json` and runs it against the legacy TypeScript path with `OPENALICE_RUST_ANALYSIS` unset/off.

Recommended scope:

- Allowed write paths should explicitly include the fixture file plus the smallest test path needed for a parity harness.
- The harness should compare success outputs exactly and error messages exactly unless Architecture approves normalization.
- QA should review the fixture gaps before any Rust parser or indicator-kernel implementation begins.
