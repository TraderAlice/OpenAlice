/**
 * Contract discipline — strict SecType taxonomy + per-secType validation.
 *
 * The `@traderalice/ibkr` Contract class is intentionally permissive (mirrors
 * the IBKR ibapi shape; every field has a default). That permissiveness
 * meant secType drifted to freeform `string` and downstream consumers had
 * no way to know which fields were required for a given instrument.
 *
 * This module promotes IBKR's contract taxonomy to canonical:
 *   - `SecType` is a strict union — adding a new type touches one place.
 *   - `validateContract(c)` enforces per-secType structural requirements
 *     (OPT/FOP need expiry+strike+right+multiplier; FUT needs expiry+
 *     multiplier; STK/CRYPTO/etc. need symbol+exchange+currency).
 *
 * Brokers funnel their Contract construction through `buildContract` (added
 * in Phase 2 of the IBKR-as-truth refactor) which calls `validateContract`
 * at output and throws in dev. Phase 1 (this commit) just makes the
 * machinery available; later phases enforce it.
 */

import { Contract, UNSET_DOUBLE, type SecType } from '@traderalice/ibkr'

// Re-export so callers under `domain/trading/*` can keep importing SecType
// from this module — the canonical definition lives in @traderalice/ibkr
// alongside the Contract class. See the policy doc on `SecType` there:
// no new secTypes without explicit sign-off; CRYPTO/CRYPTO_PERP are the
// only intentional deviations from IBKR's documented taxonomy.
export type { SecType }

export const SEC_TYPES: readonly SecType[] = [
  // IBKR canonical
  'STK', 'OPT', 'FUT', 'FOP', 'IND', 'CASH', 'BOND', 'CMDTY',
  'WAR', 'IOPT', 'FUND', 'BAG', 'NEWS', 'CFD', 'CRYPTO',
  // OpenAlice-only extension
  'CRYPTO_PERP',
] as const

const SEC_TYPE_SET = new Set<string>(SEC_TYPES)

export function isSecType(v: unknown): v is SecType {
  return typeof v === 'string' && SEC_TYPE_SET.has(v)
}

// ==================== Per-secType requirements ====================

export interface ContractRequirements {
  /** Universal: every contract regardless of secType. */
  universal: ['symbol', 'secType', 'exchange', 'currency']
  /** Required only when secType matches (in addition to universal). */
  bySecType: Partial<Record<SecType, Array<keyof Contract>>>
}

export const SECTYPE_REQUIREMENTS: ContractRequirements = {
  universal: ['symbol', 'secType', 'exchange', 'currency'],
  bySecType: {
    OPT: ['lastTradeDateOrContractMonth', 'strike', 'right', 'multiplier'],
    FOP: ['lastTradeDateOrContractMonth', 'strike', 'right', 'multiplier'],
    FUT: ['lastTradeDateOrContractMonth', 'multiplier'],
    // STK / CASH / BOND / WAR / CRYPTO / CRYPTO_PERP need only the universal
    // fields. Multiplier defaults to '1' downstream when absent.
  },
}

// ==================== Validator ====================

export type ValidationResult = { ok: true } | { ok: false; errors: string[] }

/**
 * Validate a Contract against the canonical taxonomy. Returns a list of
 * issues so callers can decide whether to throw or warn.
 */
export function validateContract(c: Contract): ValidationResult {
  const errors: string[] = []

  // Universal: non-empty
  if (!c.symbol) errors.push('symbol is required')
  if (!c.secType) errors.push('secType is required')
  else if (!isSecType(c.secType)) errors.push(`secType "${c.secType}" is not a known SecType (allowed: ${SEC_TYPES.join(', ')})`)
  if (!c.exchange) errors.push('exchange is required')
  if (!c.currency) errors.push('currency is required')

  // Per-secType (only if secType is itself valid)
  if (isSecType(c.secType)) {
    const required = SECTYPE_REQUIREMENTS.bySecType[c.secType] ?? []
    for (const field of required) {
      if (!hasContractField(c, field)) {
        errors.push(`${c.secType} requires ${field}`)
      }
    }
    // Right must be C/P/CALL/PUT for OPT/FOP
    if ((c.secType === 'OPT' || c.secType === 'FOP') && c.right) {
      const r = c.right.toUpperCase()
      if (r !== 'C' && r !== 'P' && r !== 'CALL' && r !== 'PUT') {
        errors.push(`${c.secType} right must be C/P/CALL/PUT (got "${c.right}")`)
      }
    }
  }

  return errors.length === 0 ? { ok: true } : { ok: false, errors }
}

/**
 * Throwing variant for places that want hard enforcement (broker output
 * boundary). Phase 2 wires this into `buildContract`; Phase 1 leaves it
 * available without enforcing.
 */
export function assertContract(c: Contract): void {
  const r = validateContract(c)
  if (!r.ok) {
    throw new Error(`Invalid contract: ${r.errors.join('; ')}`)
  }
}

/**
 * Check whether a Contract field has a non-default value. The IBKR class
 * uses sentinels (UNSET_DOUBLE for strike, '' for strings) — so "missing"
 * means "still at sentinel".
 */
function hasContractField(c: Contract, field: keyof Contract): boolean {
  const v = c[field]
  if (typeof v === 'string') return v !== ''
  if (typeof v === 'number') return v !== UNSET_DOUBLE
  return v != null
}
