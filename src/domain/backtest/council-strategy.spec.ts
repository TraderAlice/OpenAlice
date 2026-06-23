import { describe, it, expect, vi } from 'vitest'
import { createCouncilStrategy } from './council-strategy.js'
import type { StrategyCouncil, StrategyDecision, FinalAction } from '../../core/strategy-council/index.js'
import type { BarCursor, StrategyState } from './types.js'

// ==================== Fakes ====================

function makeDecision(finalAction: FinalAction, positionFactor = 1.0): StrategyDecision {
  return {
    id: 'test-decision',
    timestamp: new Date().toISOString(),
    input: 'test input',
    verdicts: [],
    finalAction,
    rationale: 'test',
    positionFactor,
    elapsedMs: 1,
  }
}

function fakeCouncil(decision: StrategyDecision): StrategyCouncil {
  return {
    deliberate: vi.fn().mockResolvedValue(decision),
  } as unknown as StrategyCouncil
}

function fakeCursor(): BarCursor {
  const bar = { ts: 0, open: 100, high: 101, low: 99, close: 100.5, volume: 1000 }
  return {
    index: 0,
    current: bar,
    lookback: () => bar,
    lastN: () => [bar],
  }
}

function makeState(overrides: Partial<StrategyState> = {}): StrategyState {
  return {
    cash: 10_000,
    position: null,
    equity: 10_000,
    barsSeen: 1,
    ...overrides,
  }
}

// ==================== Tests ====================

describe('createCouncilStrategy', () => {
  it('maps council long → enter long with default size * positionFactor', async () => {
    const council = fakeCouncil(makeDecision('long', 0.8))
    const strategy = createCouncilStrategy({ council, defaultSize: 10 })
    const action = await strategy(fakeCursor(), makeState())

    expect(action.type).toBe('enter')
    if (action.type === 'enter') {
      expect(action.side).toBe('long')
      expect(action.size).toBeCloseTo(8, 6) // 10 * 0.8
    }
  })

  it('maps council short → enter short', async () => {
    const council = fakeCouncil(makeDecision('short', 1.0))
    const strategy = createCouncilStrategy({ council, defaultSize: 5 })
    const action = await strategy(fakeCursor(), makeState())
    expect(action.type).toBe('enter')
    if (action.type === 'enter') expect(action.side).toBe('short')
  })

  it('maps council hold → hold', async () => {
    const council = fakeCouncil(makeDecision('hold'))
    const strategy = createCouncilStrategy({ council, defaultSize: 10 })
    const action = await strategy(fakeCursor(), makeState())
    expect(action.type).toBe('hold')
  })

  it('maps council blocked → hold (no entry, no exit)', async () => {
    const council = fakeCouncil(makeDecision('blocked'))
    const strategy = createCouncilStrategy({ council, defaultSize: 10 })
    const action = await strategy(fakeCursor(), makeState())
    expect(action.type).toBe('hold')
  })

  it('flips from long to short via exit first', async () => {
    const council = fakeCouncil(makeDecision('short', 1.0))
    const strategy = createCouncilStrategy({ council, defaultSize: 10 })
    const state = makeState({
      position: {
        side: 'long',
        size: 10,
        entryPrice: 100,
        entryTs: 0,
        entryBarIndex: 0,
      },
    })
    const action = await strategy(fakeCursor(), state)
    expect(action.type).toBe('exit')
  })

  it('skips deliberation when deliberateEvery > 1', async () => {
    const council = fakeCouncil(makeDecision('long'))
    const strategy = createCouncilStrategy({
      council,
      defaultSize: 10,
      deliberateEvery: 5,
    })

    // barsSeen=1 → 1 % 5 != 0 → hold (no council call)
    const a1 = await strategy(fakeCursor(), makeState({ barsSeen: 1 }))
    expect(a1.type).toBe('hold')
    expect(council.deliberate).not.toHaveBeenCalled()

    // barsSeen=5 → 5 % 5 == 0 → deliberate
    const a2 = await strategy(fakeCursor(), makeState({ barsSeen: 5 }))
    expect(a2.type).toBe('enter')
    expect(council.deliberate).toHaveBeenCalledTimes(1)
  })

  it('uses custom buildPrompt when provided', async () => {
    const council = fakeCouncil(makeDecision('hold'))
    const buildPrompt = vi.fn().mockReturnValue('custom prompt')
    const strategy = createCouncilStrategy({
      council,
      defaultSize: 10,
      buildPrompt,
    })
    await strategy(fakeCursor(), makeState())
    expect(buildPrompt).toHaveBeenCalled()
    expect(council.deliberate).toHaveBeenCalledWith('custom prompt')
  })
})
