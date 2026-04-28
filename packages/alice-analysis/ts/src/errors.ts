// Error class that wraps the napi `CODE|message` envelope produced by the Rust
// `AnalysisError → napi::Error` mapping. Existing TS callers throw plain
// `Error` whose `.message` matches the survey-flagged texts (e.g. "Division by
// zero", "out of bounds", "requires at least N data points"); we preserve that
// behaviour by setting `.message` to the un-prefixed payload, while exposing
// `.code` for new callers that want to branch on machine codes.
//
// Per design Q2 (codes-only parity, recommended in §3.5), this is the contract.

export type AnalysisErrorCode =
  | 'PARSE_ERROR'
  | 'EVAL_ERROR'
  | 'INSUFFICIENT_DATA'
  | 'DIV_BY_ZERO'
  | 'INDEX_OUT_OF_BOUNDS'
  | 'UNKNOWN_FUNCTION'
  | 'TYPE_MISMATCH'
  | 'DATA_FETCH_ERROR'
  | 'STRING_RESULT'
  | 'DECIMAL_ERROR'
  | 'INTERNAL_ERROR'

export class AnalysisError extends Error {
  readonly code: AnalysisErrorCode | 'UNKNOWN'

  constructor(message: string, code: AnalysisErrorCode | 'UNKNOWN') {
    super(message)
    this.name = 'AnalysisError'
    this.code = code
  }
}

const KNOWN_CODES = new Set<string>([
  'PARSE_ERROR',
  'EVAL_ERROR',
  'INSUFFICIENT_DATA',
  'DIV_BY_ZERO',
  'INDEX_OUT_OF_BOUNDS',
  'UNKNOWN_FUNCTION',
  'TYPE_MISMATCH',
  'DATA_FETCH_ERROR',
  'STRING_RESULT',
  'DECIMAL_ERROR',
  'INTERNAL_ERROR',
])

/** Peel `CODE|message` envelopes thrown by the Rust napi layer. */
export function rehydrateRustError(err: unknown): never {
  if (err instanceof Error) {
    const parts = err.message.split('|')
    if (parts.length >= 2 && KNOWN_CODES.has(parts[0])) {
      const code = parts[0] as AnalysisErrorCode
      const message = parts.slice(1).join('|')
      throw new AnalysisError(message, code)
    }
  }
  throw err
}
