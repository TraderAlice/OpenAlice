/**
 * One-shot order entry — combines stage / commit / push into a single
 * call for surfaces that have already collected the user's full intent
 * (Web UI's manual order form, future Telegram /place command, CLI).
 *
 * The three phases of the trading-as-git pipeline stay separate
 * underneath; this is a domain-level convenience that bundles them.
 *
 * Why it lives in domain/, not in a route handler:
 * - Multiple surfaces want this. Web UI exposes it via /api/trading/...
 *   today; a future Telegram `/place` command, MCP tool, or CLI would
 *   need the same pipeline. Extracting it means one source of truth
 *   for the end-to-end "manual intent → executed order" path.
 * - Phase-aware error reporting is part of the contract — callers want
 *   to label which step failed. Encoded as a discriminated union here
 *   instead of HTTP status codes; the route layer maps the union to
 *   appropriate transport-level signals.
 *
 * One-shot still converges on `UnifiedTradingAccount.push()`. Manual form
 * submission supplies the user's intent, while domain-level push gates still
 * enforce account approval policy before broker dispatch.
 */

import type { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import { isApprovalGateError } from './approval-gate/errors.js'
import type { PushResult } from './git/types.js'

export type OrderEntryPhase = 'stage' | 'commit' | 'push'

export type OrderEntryResult =
  | { ok: true; result: PushResult }
  | { ok: false; phase: OrderEntryPhase; error: string; gate?: 'approvalGate'; code?: string }

/**
 * Run stage → commit → push on the given UTA. The `stage` callback is
 * the caller's chance to invoke whichever staging method matches the
 * intent (`stagePlaceOrder` / `stageClosePosition` / `stageCancelOrder`
 * / `stageModifyOrder`).
 *
 * On commit failure, the staging area is rolled back so a retry starts
 * clean — UTA's reject() best-effort, not part of the returned error.
 */
export async function executeOneShotOrder(
  uta: UnifiedTradingAccount,
  message: string,
  stage: () => void,
): Promise<OrderEntryResult> {
  // Phase 1: stage
  try {
    stage()
  } catch (err) {
    return { ok: false, phase: 'stage', error: errorMessage(err) }
  }

  // Phase 2: commit
  try {
    uta.commit(message)
  } catch (err) {
    // Roll back so the next attempt starts from an empty staging area.
    try { await uta.reject('auto-rollback after commit error') } catch { /* best effort */ }
    return { ok: false, phase: 'commit', error: errorMessage(err) }
  }

  // Phase 3: push
  try {
    const result = await uta.push()
    return { ok: true, result }
  } catch (err) {
    if (isApprovalGateError(err)) {
      return { ok: false, phase: 'push', error: err.message, gate: 'approvalGate', code: err.code }
    }
    return { ok: false, phase: 'push', error: errorMessage(err) }
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
