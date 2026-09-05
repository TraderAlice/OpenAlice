/**
 * One-Cancels-All (OCA) and bracket-linkage vocabulary. `ocaType` selects the
 * semantics TWS applies:
 *
 *   1 CANCEL_WITH_BLOCK   cancel the remaining orders, block partial overfill
 *   2 REDUCE_WITH_BLOCK   reduce the remaining orders' size, block overfill
 *   3 REDUCE_NON_BLOCK    reduce the remaining orders' size, allow overfill
 *
 * TWS silently ignores a group whose type is 0, so a dropped or unset link has
 * to be refused loudly rather than placed as an unlinked order.
 */

import { BrokerError } from './brokers/types.js'

/** The ocaType values TWS accepts (0 = unset, and never a valid request). */
export const OCA_TYPES = [1, 2, 3] as const

export type OcaType = (typeof OCA_TYPES)[number]

/** Validate a caller-supplied ocaType at the staging boundary. */
export function assertOcaType(value: number): OcaType {
  if (value !== 1 && value !== 2 && value !== 3) {
    throw new Error(
      `ocaType must be 1 (CANCEL_WITH_BLOCK), 2 (REDUCE_WITH_BLOCK) or 3 (REDUCE_NON_BLOCK); got ${String(value)}. ` +
      'Omit it to use the broker default.',
    )
  }
  return value
}

/**
 * Parses a caller-supplied `parentId` at the staging boundary. Coercing a
 * malformed id to `0` would rest the order standalone while the caller believes
 * it is bracket-attached.
 */
export function parseOrderLinkId(value: string | number, op: string): number {
  // `parseInt` stops at the first non-digit, so '12abc' and '1.9' would pass
  // as ids the caller never meant.
  const parsed = typeof value === 'number' ? value : (/^-?\d+$/.test(value.trim()) ? Number(value.trim()) : NaN)
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${op}: parentId must be a numeric order id; got ${JSON.stringify(value)}.`)
  }
  return parsed
}

/** The subset of Order fields that express OCA / bracket linkage. */
export interface OcaLinkageFields {
  ocaGroup?: string
  ocaType?: number
  parentId?: number
}

/**
 * Refuses OCA/bracket linkage on a broker that cannot express it. Call it
 * before the write's try/catch so the error propagates instead of folding into
 * a `{ success: false }` result.
 */
export function refuseOcaLinkage(brokerLabel: string, order: OcaLinkageFields): void {
  const present: string[] = []
  if (order.ocaGroup) present.push('ocaGroup')
  if (order.ocaType) present.push('ocaType')
  if (order.parentId) present.push('parentId')
  if (present.length === 0) return
  throw new BrokerError(
    'CONFIG',
    `${brokerLabel} has no One-Cancels-All / bracket-linkage primitive, so ${present.join(', ')} cannot be honored. ` +
    'Refusing rather than silently placing an UNLINKED order. Use an IBKR account for OCA linkage, ' +
    'or manage the exit legs explicitly.',
  )
}

/**
 * Refuses an attempt to revise OCA / bracket linkage on a working order: IBKR
 * answers 10327, or accepts the re-place and silently drops the group. Call it
 * before the modify's try/catch so the error propagates.
 */
export function refuseOcaRevision(brokerLabel: string, changes: OcaLinkageFields): void {
  const present: string[] = []
  if (changes.ocaGroup) present.push('ocaGroup')
  if (changes.ocaType) present.push('ocaType')
  if (changes.parentId) present.push('parentId')
  if (present.length === 0) return
  throw new BrokerError(
    'CONFIG',
    `${brokerLabel} rejects OCA / bracket revision on a working order (error 10327, ` +
    `"OCA group type revision is not allowed"), so ${present.join(', ')} cannot be modified in place. ` +
    'Refusing rather than sending a re-place the venue would accept while silently DROPPING the link. ' +
    'Cancel this order and re-place it with ocaGroup set at placement time (place the new leg with the ' +
    'group first so protection stays continuous).',
  )
}
