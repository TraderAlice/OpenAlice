// Public surface for `@traderalice/alice-decimal`.
//
// Two layers:
//   1. `encodeDecimal` / `decodeDecimal` — pure JS, `decimal.js` <-> wire string.
//      No napi crossing; used wherever TS produces or consumes wire decimals.
//   2. `validateWireDecimal` / `addWireDecimals` — napi calls into the Rust
//      `rust_decimal` codec, used as a parity oracle and for arithmetic that
//      should match Rust bit-exactly.
//
// Format: `^-?\d+(\.\d+)?$` — no exponent, no whitespace, no thousands sep.
// NaN / Infinity not representable. Trailing zeros preserved on both sides.

import Decimal from 'decimal.js'

export { validateWireDecimal, addWireDecimals, version } from './native.js'

const WIRE_RE = /^-?\d+(\.\d+)?$/

/** Encode a `decimal.js` Decimal as the wire string. Throws on non-finite. */
export function encodeDecimal(d: Decimal): string {
  if (!d.isFinite()) {
    throw new Error('cannot encode non-finite Decimal')
  }
  // toFixed() never emits exponent form, matching `rust_decimal::to_string()`.
  return d.toFixed()
}

/** Decode a wire string into a `decimal.js` Decimal. Throws on malformed input. */
export function decodeDecimal(s: string): Decimal {
  if (!WIRE_RE.test(s)) {
    throw new Error(`invalid decimal wire format: ${JSON.stringify(s)}`)
  }
  return new Decimal(s)
}

// ---- Error class for the Rust napi `CODE|message` envelope ----

export type DecimalErrorCode = 'DECIMAL_FORMAT' | 'DECIMAL_OVERFLOW'

export class DecimalError extends Error {
  readonly code: DecimalErrorCode | 'UNKNOWN'

  constructor(message: string, code: DecimalErrorCode | 'UNKNOWN') {
    super(message)
    this.name = 'DecimalError'
    this.code = code
  }
}

const KNOWN_CODES = new Set<string>(['DECIMAL_FORMAT', 'DECIMAL_OVERFLOW'])

/** Peel `CODE|message` envelopes thrown by the Rust napi layer. */
export function rehydrateDecimalError(err: unknown): never {
  if (err instanceof Error) {
    const parts = err.message.split('|')
    if (parts.length >= 2 && KNOWN_CODES.has(parts[0])) {
      const code = parts[0] as DecimalErrorCode
      const message = parts.slice(1).join('|')
      throw new DecimalError(message, code)
    }
  }
  throw err
}
