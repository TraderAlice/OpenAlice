/**
 * TEMPORARY canonical decimal-string formatter for Phase 0 fixtures.
 *
 * Replaces `Decimal.toString()` at every Phase 0 boundary that crosses
 * persistence, hashing, or fixture serialization. Phase 1c (v3 §5) ships
 * the production `src/domain/trading/canonical-decimal.ts`; the Phase 1c
 * implementer deletes this file and updates `parity/run-ts.ts` and the
 * generator scripts to import the production version. The two
 * implementations MUST produce byte-identical output for any input the
 * rules accept (enforced by the spec next to this file).
 *
 * Rules (verbatim from RUST_MIGRATION_PLAN.v3.md §6.1):
 *   - No exponent / scientific notation.
 *   - No leading '+'.
 *   - No trailing decimal point.
 *   - Canonical zero = "0" (not "0.0", not "-0").
 *   - Negative sign only on nonzero values.
 *   - Reject NaN / Infinity / -0 (throw).
 *   - Trailing zeros after decimal point stripped.
 *
 * Sentinel-bearing fields MUST NOT pass through this formatter; they go
 * to `{ kind: 'unset' }` instead. Calling this on `UNSET_DECIMAL`
 * (≈1.7e38) succeeds silently because it is a finite Decimal — callers
 * are responsible for the sentinel check upstream.
 */

import Decimal from 'decimal.js'

export function toCanonicalDecimalString(d: Decimal): string {
  if (d === null || d === undefined) {
    throw new Error('canonical decimal: null or undefined input')
  }
  if (!(d instanceof Decimal)) {
    throw new Error('canonical decimal: input is not a Decimal instance')
  }
  if (d.isNaN()) {
    throw new Error('canonical decimal: NaN')
  }
  if (!d.isFinite()) {
    throw new Error('canonical decimal: non-finite')
  }
  if (d.isZero()) {
    return '0'
  }

  const dp = d.decimalPlaces()
  let s = d.toFixed(dp)

  if (s.startsWith('+')) {
    s = s.slice(1)
  }

  if (s.includes('.')) {
    s = s.replace(/0+$/, '')
    if (s.endsWith('.')) {
      s = s.slice(0, -1)
    }
  }

  if (s === '-0' || s === '') {
    return '0'
  }

  return s
}
