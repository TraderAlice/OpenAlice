import { describe, it, expect, vi } from 'vitest'
import { executeOneShotOrder } from './order-entry.js'
import { ApprovalGateError } from './approval-gate/errors.js'
import type { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
import type { PushResult } from './git/types.js'

/**
 * Build a minimal UTA double covering only the methods the one-shot
 * pipeline touches: commit, push, reject. Returned alongside spies
 * the test can assert on.
 */
function makeFakeUta(overrides: {
  commit?: () => void
  push?: () => Promise<PushResult>
  reject?: () => Promise<void>
} = {}) {
  const reject = overrides.reject ?? vi.fn(async () => {})
  const commit = overrides.commit ?? vi.fn(() => {})
  const push = overrides.push ?? vi.fn(async () => ({
    hash: 'abc', message: 'ok', operationCount: 0, submitted: [], rejected: [],
  } as unknown as PushResult))
  const uta = { commit, push, reject } as unknown as UnifiedTradingAccount
  return { uta, commit, push, reject }
}

describe('executeOneShotOrder', () => {
  it('runs all three phases on the happy path', async () => {
    const stage = vi.fn()
    const { uta, commit, push, reject } = makeFakeUta()

    const r = await executeOneShotOrder(uta, 'place AAPL 100 MKT', stage)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result.hash).toBe('abc')
    expect(stage).toHaveBeenCalledTimes(1)
    expect(commit).toHaveBeenCalledWith('place AAPL 100 MKT')
    expect(push).toHaveBeenCalledTimes(1)
    expect(reject).not.toHaveBeenCalled()
  })

  it('preserves approvalGate audit on successful push result', async () => {
    const approvalGate = {
      ticketId: 'ticket-1',
      runId: 'run-1',
      pendingHash: 'abc123',
      operationCount: 1,
      actions: ['BUY'],
      symbols: ['AAPL'],
      exitPlanMode: 'ticket-exit-plan' as const,
      entries: [{ symbol: 'AAPL', action: 'BUY', notionalUsd: '300' }],
    }
    const stage = vi.fn()
    const { uta } = makeFakeUta({
      push: vi.fn(async () => ({
        hash: 'abc123',
        message: 'ticket-1 run-1 buy AAPL',
        operationCount: 1,
        submitted: [],
        rejected: [],
        approvalGate,
      })),
    })

    const r = await executeOneShotOrder(uta, 'ticket-1 run-1 buy AAPL', stage)

    expect(r.ok).toBe(true)
    if (r.ok) expect(r.result.approvalGate).toEqual(approvalGate)
  })

  it('returns stage error and skips commit + push', async () => {
    const stage = vi.fn(() => { throw new Error('guard tripped') })
    const { uta, commit, push } = makeFakeUta()

    const r = await executeOneShotOrder(uta, 'msg', stage)

    expect(r).toEqual({ ok: false, phase: 'stage', error: 'guard tripped' })
    expect(commit).not.toHaveBeenCalled()
    expect(push).not.toHaveBeenCalled()
  })

  it('returns commit error AND triggers a rollback reject', async () => {
    const stage = vi.fn()
    const reject = vi.fn(async () => {})
    const { uta, push } = makeFakeUta({
      commit: vi.fn(() => { throw new Error('nothing staged') }),
      reject,
    })

    const r = await executeOneShotOrder(uta, 'msg', stage)

    expect(r).toEqual({ ok: false, phase: 'commit', error: 'nothing staged' })
    expect(reject).toHaveBeenCalledTimes(1)
    expect(push).not.toHaveBeenCalled()
  })

  it('swallows reject errors during commit-failure rollback', async () => {
    const stage = vi.fn()
    const { uta } = makeFakeUta({
      commit: vi.fn(() => { throw new Error('commit broke') }),
      reject: vi.fn(async () => { throw new Error('reject also broke') }),
    })

    // Should still surface the original commit error, not the reject one.
    const r = await executeOneShotOrder(uta, 'msg', stage)
    expect(r).toEqual({ ok: false, phase: 'commit', error: 'commit broke' })
  })

  it('returns push error', async () => {
    const stage = vi.fn()
    const { uta } = makeFakeUta({
      push: vi.fn(async () => { throw new Error('broker rejected') }),
    })

    const r = await executeOneShotOrder(uta, 'msg', stage)
    expect(r).toEqual({ ok: false, phase: 'push', error: 'broker rejected' })
  })

  it('preserves approval gate metadata on push failure', async () => {
    const stage = vi.fn()
    const { uta } = makeFakeUta({
      push: vi.fn(async () => {
        throw new ApprovalGateError('approval_gate_notional_exceeded', 'Approval gate rejected notional.')
      }),
    })

    const r = await executeOneShotOrder(uta, 'msg', stage)

    expect(r).toEqual({
      ok: false,
      phase: 'push',
      error: 'Approval gate rejected notional.',
      gate: 'approvalGate',
      code: 'approval_gate_notional_exceeded',
    })
  })

  it('coerces non-Error throwables to a string error message', async () => {
    const stage = vi.fn(() => { throw 'plain string thrown' })
    const { uta } = makeFakeUta()

    const r = await executeOneShotOrder(uta, 'msg', stage)
    expect(r).toEqual({ ok: false, phase: 'stage', error: 'plain string thrown' })
  })
})
