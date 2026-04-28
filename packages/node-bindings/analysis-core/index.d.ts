/**
 * OpenAlice analysis_core Node binding — Phase 2 napi-rs bridge.
 *
 * - OPE-17: parser slice (`parseFormulaSync`).
 * - OPE-18: arithmetic-only evaluator slice (`evaluateFormulaSync`).
 * - OPE-19: finite `number[]` reductions slice (`reduceNumbersSync`).
 *
 * The exposed AST shape matches the legacy TypeScript `ASTNode`
 * discriminated-union exactly so the TypeScript evaluator can consume
 * it without remapping. See `docs/autonomous-refactor/adr/ADR-003-binding-strategy.md`.
 */

export type AstNumberNode = {
  type: 'number'
  value: number
}

export type AstStringNode = {
  type: 'string'
  value: string
}

export type AstFunctionNode = {
  type: 'function'
  name: string
  args: AstNode[]
}

export type AstBinaryOpNode = {
  type: 'binaryOp'
  operator: '+' | '-' | '*' | '/'
  left: AstNode
  right: AstNode
}

export type AstArrayAccessNode = {
  type: 'arrayAccess'
  array: AstNode
  index: AstNode
}

export type AstNode =
  | AstNumberNode
  | AstStringNode
  | AstFunctionNode
  | AstBinaryOpNode
  | AstArrayAccessNode

/**
 * Thrown when the napi-rs `.node` artifact cannot be loaded (missing
 * file, ABI mismatch, missing exports). The legacy TypeScript parser
 * remains the supported fallback while this is unresolved (see
 * OPENALICE_RUST_ANALYSIS=0 in `calculator.ts`).
 */
export declare class BindingLoadError extends Error {
  readonly name: 'BindingLoadError'
  readonly code: 'ANALYSIS_CORE_BINDING_LOAD_FAILED'
  readonly cause?: unknown
}

/**
 * Thrown when the Rust parser rejects a formula. The `message` field
 * matches the legacy TypeScript parser exactly for parser-relevant
 * cases (`Expected ')' at position N`, `Expected ']' at position N`,
 * `Unterminated string at position N`, `Unexpected character 'X' at
 * position N` with and without the `Expected end of expression.`
 * suffix, and `Unknown identifier 'X' at position N`).
 */
export declare class BindingParseError extends Error {
  readonly name: 'BindingParseError'
  readonly code: 'ANALYSIS_CORE_PARSE_ERROR'
  readonly position: number
}

/**
 * Thrown when a Rust panic was caught at the napi-rs binding edge. A
 * panic in Rust never crashes the Node process; it always surfaces as
 * this typed error per ADR-003 §"Failure isolation".
 */
export declare class RustPanicError extends Error {
  readonly name: 'RustPanicError'
  readonly code: 'INTERNAL_RUST_PANIC'
  readonly cause?: unknown
}

/**
 * Thrown when the Rust arithmetic-only evaluator surfaces a runtime
 * error whose `.message` is parity-locked with the legacy TypeScript
 * evaluator (e.g. `"Division by zero"`). Only emitted by
 * `evaluateFormulaSync` when the AST is fully arithmetic-only; trees
 * with non-arithmetic nodes are returned as `{ kind: 'unsupported' }`
 * so the legacy TypeScript evaluator owns full evaluation semantics.
 */
export declare class BindingEvaluateError extends Error {
  readonly name: 'BindingEvaluateError'
  readonly code: 'ANALYSIS_CORE_EVALUATE_ERROR'
}

/**
 * Thrown when a Rust finite-`number[]` reduction surfaces a runtime
 * error whose `.message` is parity-locked with the legacy TypeScript
 * implementation (e.g. `"MIN requires at least 1 data point"`). Only
 * emitted by `reduceNumbersSync` for `MIN`/`MAX`/`AVERAGE` on an empty
 * slice (`SUM([])` returns `{ kind: 'value', value: 0 }`).
 */
export declare class BindingReduceError extends Error {
  readonly name: 'BindingReduceError'
  readonly code: 'ANALYSIS_CORE_REDUCE_ERROR'
}

/**
 * Thrown when a binding entry point receives an argument that does not
 * match its contract (e.g. `reduceNumbersSync` called with a `kind` that
 * is not one of `MIN`/`MAX`/`SUM`/`AVERAGE`, or with a non-array
 * `values` argument). Distinct from `BindingReduceError` so the JS
 * caller can route argument-shape failures separately from
 * legacy-format reduction errors.
 */
export declare class BindingArgumentError extends Error {
  readonly name: 'BindingArgumentError'
  readonly code: 'ANALYSIS_CORE_ARGUMENT_ERROR'
}

export declare function bootstrapHealthcheck(): 'analysis_core:bootstrap'

/**
 * Synchronously parse a formula via the Rust `analysis_core` parser.
 *
 * Default route is the in-process napi-rs binding. Setting
 * `OPENALICE_ANALYSIS_CORE_USE_CLI=1` switches to the OPE-16 CLI
 * fallback (`analysis-core-parse` binary) for debug/benchmark only;
 * production callers should never set it.
 *
 * Errors:
 *  - `BindingLoadError`     - native artifact missing or unloadable.
 *  - `BindingParseError`    - parser rejected the formula. `.message`
 *                             matches the legacy TypeScript parser.
 *  - `RustPanicError`       - Rust panic caught at the binding edge.
 */
export declare function parseFormulaSync(formula: string): AstNode

/**
 * Outcome of `evaluateFormulaSync`. Either the formula evaluated to a
 * number under the arithmetic-only Rust evaluator, or the AST contains
 * a non-arithmetic node and the caller must hand `ast` to the legacy
 * TypeScript evaluator.
 */
export type EvaluateOutcome =
  | { kind: 'value'; value: number }
  | { kind: 'unsupported'; ast: AstNode }

/**
 * Synchronously parse + arithmetic-only evaluate a formula via the Rust
 * `analysis_core` kernel.
 *
 * This is the OPE-18 entry point. Numeric literals and `+ - * /` between
 * numbers evaluate in Rust and return `{ kind: 'value', value }`. Trees
 * containing any non-arithmetic node return `{ kind: 'unsupported',
 * ast }` so the caller can fall back to the legacy TypeScript evaluator
 * without re-parsing the formula.
 *
 * Errors:
 *  - `BindingLoadError`     - native artifact missing or unloadable.
 *  - `BindingParseError`    - parser rejected the formula. `.message`
 *                             matches the legacy TypeScript parser.
 *  - `BindingEvaluateError` - arithmetic-only runtime error (e.g.
 *                             `Division by zero`); `.message` matches
 *                             the legacy TypeScript evaluator.
 *  - `RustPanicError`       - Rust panic caught at the binding edge.
 *
 * The CLI fallback (`OPENALICE_ANALYSIS_CORE_USE_CLI=1`) is intentionally
 * not honored here; the OPE-18 evaluator slice exists only on the
 * in-process napi-rs path.
 */
export declare function evaluateFormulaSync(formula: string): EvaluateOutcome

/**
 * Supported reduction kind identifier. Anything outside this union is
 * rejected by `reduceNumbersSync` with `BindingArgumentError` before any
 * data crosses the binding boundary.
 */
export type ReductionKind = 'MIN' | 'MAX' | 'SUM' | 'AVERAGE'

/**
 * Outcome of `reduceNumbersSync`. Either the kernel produced a finite
 * `f64` reduction value, or the slice contained at least one non-finite
 * element (`NaN` / `+/-Infinity`) and the caller must hand the
 * reduction back to the legacy TypeScript implementation.
 */
export type ReduceOutcome =
  | { kind: 'value'; value: number }
  | { kind: 'unsupported' }

/**
 * Synchronously apply the finite-`number[]` reduction identified by
 * `kind` (one of `MIN`/`MAX`/`SUM`/`AVERAGE`) to `values` via the Rust
 * `analysis_core` kernel. The TypeScript caller is expected to keep
 * `toValues(...)` and `TrackedValues` metadata authoritative on the JS
 * side; this entry point only consumes a plain finite `number[]`.
 *
 * Returns `{ kind: 'value', value }` for successful reductions, or
 * `{ kind: 'unsupported' }` for slices containing non-finite elements.
 *
 * Errors:
 *  - `BindingReduceError`     - `MIN`/`MAX`/`AVERAGE` on `[]`. The
 *                               message is parity-locked with the legacy
 *                               TypeScript reduction.
 *  - `BindingArgumentError`   - `kind` not one of the four supported
 *                               reductions, or `values` not an array /
 *                               `Float64Array`.
 *  - `BindingLoadError`       - native artifact missing or unloadable.
 *  - `RustPanicError`         - Rust panic caught at the binding edge.
 */
export declare function reduceNumbersSync(
  kind: ReductionKind,
  values: number[] | Float64Array,
): ReduceOutcome

/**
 * Test-only hook: triggers a Rust panic inside the binding to exercise
 * the panic boundary. Throws `RustPanicError`. Not part of the
 * production surface; only `parseFormulaSync` is.
 */
export declare function __triggerPanicForTest(message: string): never

/**
 * Test-only: reset the cached native-binding handle. Used by
 * binding-load-failure tests that simulate "native artifact never built".
 */
export declare function __resetForTest(): void
