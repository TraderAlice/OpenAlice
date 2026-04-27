# analysis_core — Entry-Point Freeze and Legacy Parity Harness

- Issue: [OPE-14](/OPE/issues/OPE-14)
- Module contract: [analysis-core.md](../../module-contracts/analysis-core.md)
- Fixture file: [legacy-calculation-fixtures.json](../../fixtures/analysis-core/legacy-calculation-fixtures.json)
- Phase 2 kickoff: [phase-2-planning-kickoff.md](../phase-2-planning/phase-2-planning-kickoff.md)
- Type: qa-prep (no source/Rust changes)
- Feature flag: `OPENALICE_RUST_ANALYSIS=0` pinned by the harness

## Working directory

- `pwd`: `/Users/opcw05/newtest/001/OpenAlice`
- `git rev-parse --show-toplevel`: `/Users/opcw05/newtest/001/OpenAlice`
- Branch at start: `master`
- Latest commit at start: `bfd414d docs: add Phase 2 ADR scaffolding and planning kickoff`
- `git status --short` at start: clean

## Commands run

```text
pwd
git rev-parse --show-toplevel
git status --short
git log --oneline -10
test -f docs/autonomous-refactor/reports/phase-2-planning/phase-2-planning-kickoff.md
test -f docs/autonomous-refactor/module-contracts/analysis-core.md
test -f docs/autonomous-refactor/fixtures/analysis-core/legacy-calculation-fixtures.json
pnpm test -- src/domain/analysis src/domain/thinking
pnpm test
npx tsc --noEmit
```

The `rg` enumeration command from the issue body was satisfied by direct file
reads (`Read`/`Grep`); the entry-point inventory below is the resolved output.

## Public calculation entry points (observed)

The four entry points named in `analysis-core.md` and `legacy-calculation-fixtures.json`
all exist and are importable today. None were changed by this issue.

| Entry point | Path | Surface |
| --- | --- | --- |
| `IndicatorCalculator.calculate(formula, precision?)` | `src/domain/analysis/indicator/calculator.ts` | Async; returns `{ value, dataRange }`. Default precision = 4. Throws on invalid expression / arity / type errors. |
| `createAnalysisTools(equity, crypto, currency, commodity).calculateIndicator` | `src/tool/analysis.ts` | Vercel `tool` registration. `inputSchema` = `{ asset, formula, precision? }` via Zod; `execute` filters null OHLC and sorts ascending before delegating to `IndicatorCalculator`. |
| `calculate(expression)` | `src/domain/thinking/tools/calculate.tool.ts` | Sync; returns `number`. Allows only `[\d+\-*/().\s]+`. Rounds to 4 decimal places. Wraps every error as `Calculation error: …`. |
| `createThinkingTools().calculate` | `src/tool/thinking.ts` | Vercel `tool` registration. `inputSchema` = `{ expression }` via Zod; `execute` delegates directly to `calculate`. |

Supporting modules (read-only for this issue):

- `src/domain/analysis/indicator/types.ts` — `OhlcvData`, `DataSourceMeta`, `TrackedValues`, `IndicatorContext`, AST node types.
- `src/domain/analysis/indicator/functions/data-access.ts` — `OPEN/HIGH/LOW/CLOSE/VOLUME` (VOLUME normalizes `null` → `0`).
- `src/domain/analysis/indicator/functions/statistics.ts` — `SMA, EMA, STDEV, MAX, MIN, SUM, AVERAGE`.
- `src/domain/analysis/indicator/functions/technical.ts` — `RSI, BBANDS, MACD, ATR`.
- `src/domain/analysis/index.ts` — re-exports `IndicatorCalculator` plus `IndicatorContext`/`OhlcvData` types.
- `src/domain/thinking/index.ts` — re-exports `calculate`.

No additional public calculation entry points were discovered under
`src/domain/analysis/`, `src/domain/thinking/`, `src/tool/analysis.ts`, or
`src/tool/thinking.ts`.

## Fixture coverage matrix

The fixture file declares cases against four logical surfaces. The harness now
drives every declared case through the legacy path with `OPENALICE_RUST_ANALYSIS=0`.

| Surface | Fixture key | Cases | Driven by |
| --- | --- | --- | --- |
| `IndicatorCalculator.calculate` | `indicatorCalculatorCases` | 21 (16 ok + 5 error) | `src/domain/analysis/__test__/legacy-parity.spec.ts` |
| `createAnalysisTools().calculateIndicator.execute` | `analysisToolShimCases` | 4 (4 ok + 0 error) | `src/domain/analysis/__test__/legacy-parity.spec.ts` |
| `calculate(expression)` | `thinkingCalculateCases` | 8 (5 ok + 3 error) | `src/domain/thinking/__test__/legacy-parity.spec.ts` |
| `createThinkingTools().calculate.execute` | `thinkingToolShimCases` | 2 (1 ok + 1 error) | `src/domain/thinking/__test__/legacy-parity.spec.ts` |

Per-feature coverage of `IndicatorCalculator.calculate`:

| Feature | Covered fixture id(s) |
| --- | --- |
| Arithmetic precedence | `indicator-arithmetic-precedence`, `indicator-parentheses` |
| Default + custom precision | `indicator-default-precision`, `indicator-custom-precision` |
| Series via `CLOSE`, negative-index access | `indicator-close-series`, `indicator-latest-close-negative-index` |
| `VOLUME` null → 0 normalization | `indicator-null-volume-normalized-to-zero` |
| Statistics — `SMA`, `EMA`, `STDEV`, `MAX/MIN` | `indicator-sma`, `indicator-ema`, `indicator-stdev`, `indicator-max-minus-min` |
| Technical — `RSI`, `BBANDS`, `MACD`, `ATR` | `indicator-rsi`, `indicator-bbands`, `indicator-macd`, `indicator-atr` |
| Composite expression | `indicator-complex-price-deviation-percent` |
| Empty series | `indicator-empty-series` |
| Validation errors | `indicator-string-result-error`, `indicator-unknown-function-error`, `indicator-division-by-zero-error`, `indicator-insufficient-sma-error`, `indicator-binary-tracked-values-error`, `indicator-array-out-of-bounds-error`, `indicator-missing-closing-paren-error` |

Per-feature coverage of `createAnalysisTools().calculateIndicator.execute`:

| Asset class | Covered fixture id |
| --- | --- |
| equity | `analysis-tool-equity-latest-close` |
| crypto | `analysis-tool-crypto-null-volume-normalized-to-zero` |
| currency | `analysis-tool-currency-sma-sorted-filtered-bars` |
| commodity | `analysis-tool-commodity-latest-close` |

The shim cases also exercise the normalization the tool wrapper is responsible
for (filtering bars whose OHLC contains `null`, ascending-by-date sort,
`DataSourceMeta` derived from the surviving bars).

Per-feature coverage of `calculate(expression)`:

| Behaviour | Covered fixture id |
| --- | --- |
| Arithmetic precedence + parentheses | `thinking-arithmetic-precedence`, `thinking-parentheses` |
| Default 4-decimal rounding | `thinking-default-rounding` |
| Floating-point normalization | `thinking-floating-point-normalization` |
| Negative result | `thinking-negative-result` |
| Identifier rejection | `thinking-invalid-identifier-error` |
| Function/injection rejection | `thinking-injection-error` |
| Non-finite result rejection | `thinking-non-finite-error` |

Per-feature coverage of `createThinkingTools().calculate.execute`:

| Behaviour | Covered fixture id |
| --- | --- |
| Valid expression delegation | `thinking-tool-valid-expression` |
| Tool-surface error wrapping | `thinking-tool-invalid-expression-error` |

## Fixture coverage gaps

The matrix exhausts every case declared in the fixture file. The following
deliberate non-coverage items are noted so the next planning slice does not
treat them as silent gaps:

- **Identifier-only expression**: `IndicatorCalculator.parse` throws
  `Unknown identifier 'X' at position …` for bare identifiers without a call,
  but no fixture pins the exact message. Behaviour is exercised indirectly
  via `indicator-unknown-function-error`. Consider adding a dedicated case if
  the Rust parser ever needs explicit cross-validation.
- **`OPEN`-driven series fixture**: The unit spec covers `OPEN` for the
  linear-50 dataset; the fixture does not pin a corresponding case. Not a
  blocker — the calculator path is shared with `CLOSE/HIGH/LOW`.
- **Series-on-non-default precision**: precision applied to `number[]` /
  `Record<string, number>` outputs is covered by the existing unit spec but
  not by a pinned fixture case. The Rust parity slice can rely on the unit
  spec until/unless a fixture is required.
- **OPENALICE_RUST_ANALYSIS=1 negative test**: out of scope for Phase 1 —
  the Rust path does not exist yet. The harness only locks `=0` for now;
  the next implementation issue must add a `=1` parity counterpart.

None of the gaps above block the first analysis_core Rust parser slice.

## Harness wiring

Both new test files live under the allowed `__test__` folders and are picked
up by the existing `vitest.config.ts` `node` project (`include:
['src/**/*.spec.*', …]`). They:

- pin `process.env.OPENALICE_RUST_ANALYSIS = '0'` in `beforeAll`, restore in
  `afterAll`, and re-assert the value inside each test so a future Rust
  routing change cannot silently bypass the harness;
- iterate over the JSON fixture file (loaded via `fs.readFileSync` +
  `import.meta.url`-resolved repo root) so adding a fixture case
  automatically adds a parity test;
- for `analysisToolShimCases`, build minimal `EquityClientLike` /
  `CryptoClientLike` / `CurrencyClientLike` / `CommodityClientLike` proxies
  whose only implemented method is the one the tool actually calls
  (`getHistorical` for equity/crypto/currency, `getSpotPrices` for
  commodity). Other interface methods throw, so a routing regression in
  `src/tool/analysis.ts` would surface immediately.

Files added (test-only, inside the issue's allowed paths):

- `src/domain/analysis/__test__/legacy-fixture-loader.ts`
- `src/domain/analysis/__test__/legacy-parity.spec.ts`
- `src/domain/thinking/__test__/legacy-parity.spec.ts`
- `docs/autonomous-refactor/reports/analysis-core/entrypoint-parity-harness.md` (this report)

No production source, package, lockfile, dependency, or CI files were
modified. No Rust crates, node-bindings, or Cargo files were created.

## Test results

### Scoped run (analysis_core surface)

```text
$ pnpm test -- src/domain/analysis src/domain/thinking
> open-alice@0.9.0-beta.13 test /Users/opcw05/newtest/001/OpenAlice
> vitest run "src/domain/analysis" "src/domain/thinking"

 RUN  v4.1.5 /Users/opcw05/newtest/001/OpenAlice

 Test Files  4 passed (4)
      Tests  104 passed (104)
   Duration  244ms
```

The four files are: the two existing unit specs (`calculator.spec.ts`,
`calculate.tool.spec.ts`) plus the two new parity specs.

### Full repository run

```text
$ pnpm test
> open-alice@0.9.0-beta.13 test /Users/opcw05/newtest/001/OpenAlice
> vitest run

 RUN  v4.1.5 /Users/opcw05/newtest/001/OpenAlice

 Test Files  58 passed (58)
      Tests  1137 passed (1137)
   Duration  5.67s
```

### Type-check

```text
$ npx tsc --noEmit
(no output — clean)
```

No failing tests were observed; nothing is documented as a blocker.

## Readiness assessment for the first analysis_core Rust parser slice

- Public entry points are frozen and exhaustively covered by fixture-driven
  parity assertions on the legacy path.
- The harness pins `OPENALICE_RUST_ANALYSIS=0` so the legacy code path
  remains the regression baseline regardless of any later routing in
  `src/tool/analysis.ts`.
- All existing tests (1137) still pass on `master` after adding the
  harness, including unrelated trading/store/UI suites.
- Strict type checking (`npx tsc --noEmit`) is clean.
- No production source edits were required to capture this baseline.

**Status: ready.** The next issue can be the analysis_core
**adapter / toolchain bootstrap** under `crates/analysis-core/` and
`packages/node-bindings/analysis-core/`, gated by Architecture +
Integration approvals per `analysis-core.md` §"Approval gates before code
edits". A fixture-gap follow-up is not required at this time — the listed
gaps are deliberate Phase-2 deferrals, not coverage misses.

## Rollback note

If a later parity expectation in this harness fails for the legacy path,
the immediate action is:

1. Re-run `pnpm test -- src/domain/analysis src/domain/thinking` and
   capture the failing fixture id and message.
2. Restore `process.env.OPENALICE_RUST_ANALYSIS=0` (the harness already
   sets it; if any caller has unset it, that is a regression).
3. If the failure is in the legacy code path itself, file a follow-up
   issue, do not touch `src/tool/analysis.ts` or `src/tool/thinking.ts`
   from this harness.
