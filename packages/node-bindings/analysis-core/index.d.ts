/**
 * OpenAlice analysis_core Node binding — Phase 2 napi-rs bridge (OPE-17).
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
