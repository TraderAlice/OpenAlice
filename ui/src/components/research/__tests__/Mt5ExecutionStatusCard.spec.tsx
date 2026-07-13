import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { JmbExecutionStatusSummary } from '../../../api/research'
import { Mt5ExecutionStatusCard } from '../Mt5ExecutionStatusCard'

function execution(overrides: Partial<JmbExecutionStatusSummary> = {}): JmbExecutionStatusSummary {
  return {
    state: 'filled_protected',
    label: 'untrusted upstream label',
    detail: 'Broker confirms protected demo exposure.',
    capturedAt: '2026-07-13T09:10:00.000Z',
    broker: 'hfmarkets',
    server: 'HFMarketsGlobal-Demo4',
    accountMode: 'demo',
    symbol: 'XAUUSD',
    rolloutStage: 'hfm_canary',
    executionEnabled: true,
    killSwitch: false,
    decisionId: 'decision-1',
    observationId: 'observation-1',
    latestEvent: {
      id: 'event-1',
      type: 'fill_confirmed',
      at: '2026-07-13T09:09:58.000Z',
      resultCode: '10009',
      detail: 'Request completed',
    },
    stopProtectionConfirmed: true,
    position: { direction: 'buy', volume: 0.01, openPrice: 3334.25, stopLoss: 3324.25, id: 'position-1' },
    reconciliationState: 'reconciled',
    dailyLossCount: 1,
    dailyRealizedLoss: -8.75,
    blockingGate: null,
    nextSafeAction: 'Monitor broker-side protection.',
    ...overrides,
  }
}

afterEach(cleanup)

describe('Mt5ExecutionStatusCard', () => {
  it.each([
    ['filled_protected', 'DEMO ENABLED'],
    ['paused', 'PAUSED'],
    ['reconciliation_required', 'RECONCILIATION REQUIRED'],
    ['demo_blocked', 'DEMO BLOCKED'],
    ['missing', 'STATUS MISSING'],
    ['malformed', 'STATUS MALFORMED'],
    ['stale', 'STATUS STALE'],
  ] as const)('maps %s to the approved operational label', (state, label) => {
    render(<Mt5ExecutionStatusCard execution={execution({ state, label })} />)

    expect(screen.getByRole('region', { name: 'MT5 demo execution status' }).textContent).toContain(label)
    expect(screen.queryByText('untrusted upstream label')).toBeNull()
  })

  it('shows the operational demo evidence compactly', () => {
    render(<Mt5ExecutionStatusCard execution={execution({ blockingGate: 'daily_loss_limit' })} />)

    const card = screen.getByRole('region', { name: 'MT5 demo execution status' })
    expect(card.textContent).toContain('DEMO ONLY')
    expect(card.textContent).toContain('HFM CANARY')
    expect(card.textContent).toContain('EXECUTION ON')
    expect(card.textContent).toContain('KILL OFF')
    expect(card.textContent).toContain('HFMarketsGlobal-Demo4')
    expect(card.textContent).toContain('fill confirmed')
    expect(card.textContent).toContain('10009')
    expect(card.textContent).toContain('STOP CONFIRMED')
    expect(card.textContent).toContain('BUY 0.01')
    expect(card.textContent).toContain('1 losing / -8.75')
    expect(card.textContent).toContain('Blocked by: daily loss limit')
    expect(card.textContent).toContain('Next: Monitor broker-side protection.')
  })

  it('contains no account identity or interactive execution control', () => {
    const { container } = render(<Mt5ExecutionStatusCard execution={execution()} />)

    expect(container.textContent).not.toMatch(/account.?login/i)
    expect(container.querySelector('button, input, select, textarea, [role="switch"]')).toBeNull()
    expect(container.textContent).not.toMatch(/place order|buy now|sell now|enable trading/i)
  })
})
