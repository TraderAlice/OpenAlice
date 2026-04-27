/**
 * OpenAlice analysis_core Node binding - Phase 2 first parity slice.
 *
 * The full napi-rs bridge described in
 * docs/autonomous-refactor/adr/ADR-003-binding-strategy.md is still
 * pending; this slice ships a CLI fallback shell. The exposed AST shape
 * matches the legacy TypeScript `ASTNode` discriminated-union exactly so
 * the TypeScript evaluator can consume it without remapping.
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

export declare function bootstrapHealthcheck(): 'analysis_core:bootstrap'

/**
 * Synchronously parse a formula via the Rust `analysis_core` parser.
 *
 * Errors throw a plain `Error` whose `message` matches the legacy
 * TypeScript parser for parser-relevant cases (`Expected ')' at
 * position N`, `Expected ']' at position N`, `Unterminated string at
 * position N`, `Unexpected character 'X' at position N` with and
 * without the `Expected end of expression.` suffix, and
 * `Unknown identifier 'X' at position N`).
 */
export declare function parseFormulaSync(formula: string): AstNode
