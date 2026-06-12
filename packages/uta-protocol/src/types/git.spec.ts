import { describe, expect, it } from 'vitest'
import type { ApprovalGateAudit, PushResult } from './git.js'

describe('git protocol approval gate audit', () => {
  it('allows PushResult to carry optional approvalGate evidence', () => {
    const approvalGate = {
      ticketId: 'ticket-1',
      runId: 'run-1',
      pendingHash: 'abc123',
      operationCount: 1,
      actions: ['BUY'],
      symbols: ['AAPL'],
      exitPlanMode: 'ticket-exit-plan',
      entries: [{ symbol: 'AAPL', action: 'BUY', notionalUsd: '300' }],
    } satisfies ApprovalGateAudit

    const result = {
      hash: 'abc123',
      message: 'ticket-1 run-1 buy AAPL',
      operationCount: 1,
      submitted: [],
      rejected: [],
      approvalGate,
    } satisfies PushResult

    expect(result.approvalGate).toEqual(approvalGate)
  })

  it('keeps approvalGate optional for non-gated push results', () => {
    const result = {
      hash: 'plain123',
      message: 'plain push',
      operationCount: 1,
      submitted: [],
      rejected: [],
    } satisfies PushResult

    expect('approvalGate' in result).toBe(false)
  })
})
