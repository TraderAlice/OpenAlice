import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Tool } from 'ai'
import { StrategyCouncil, extractJsonBlock, parseRoleReply, combineVerdicts } from './council.js'
import type { RoleVerdict } from './types.js'
import { ToolCenter } from '../tool-center.js'
import { STRATEGY_DECISION_EVENT } from './types.js'

// ==================== Mock config.ts (ToolCenter reads tools.json) ====================

vi.mock('../config.js', () => ({
  readToolsConfig: vi.fn().mockResolvedValue({ disabled: [] }),
}))

// ==================== Test doubles ====================

/**
 * Minimal fake Tool — we only need ToolCenter.getInventory() to report
 * group metadata, so we don't care about execute/inputSchema etc.
 */
function fakeTool(description: string): Tool {
  return { description } as unknown as Tool
}

/**
 * Seed a ToolCenter with tools spread across several groups so we can
 * verify the role whitelist actually disables things.
 */
function seedToolCenter(): ToolCenter {
  const tc = new ToolCenter()
  tc.register({ fugle_get_stock_intraday_candles: fakeTool('fugle intraday') }, 'fugle')
  tc.register({ twstock_get_stock_kline_data: fakeTool('twstock kline') }, 'twstock')
  tc.register({ analysis_calculate_indicator: fakeTool('indicator') }, 'analysis')
  tc.register({ news_search: fakeTool('news') }, 'news')
  tc.register(
    {
      trading_place_order: fakeTool('place order'),
      trading_get_positions: fakeTool('positions'),
    },
    'trading',
  )
  tc.register({ browser_navigate: fakeTool('browser') }, 'browser')
  tc.register({ brain_commit: fakeTool('brain') }, 'brain')
  return tc
}

/**
 * Fake AgentCenter — exposes only the surface the council uses
 * (askWithSession) and returns canned role replies keyed by systemPrompt
 * substring.
 */
class FakeAgentCenter {
  public calls: Array<{
    prompt: string
    systemPrompt?: string
    disabledTools?: string[]
    profileSlug?: string
  }> = []

  constructor(
    private replies: {
      trend?: string
      signal?: string
      risk?: string
    } = {},
    private throwOn?: 'trend' | 'signal' | 'risk',
  ) {}

  askWithSession(
    prompt: string,
    _session: unknown,
    opts?: { systemPrompt?: string; disabledTools?: string[]; profileSlug?: string },
  ): Promise<{ text: string; media: [] }> {
    const sp = opts?.systemPrompt ?? ''
    this.calls.push({
      prompt,
      systemPrompt: sp,
      disabledTools: opts?.disabledTools,
      profileSlug: opts?.profileSlug,
    })

    let which: 'trend' | 'signal' | 'risk' | null = null
    if (sp.includes('TREND agent')) which = 'trend'
    else if (sp.includes('SIGNAL agent')) which = 'signal'
    else if (sp.includes('RISK agent')) which = 'risk'

    if (this.throwOn && this.throwOn === which) {
      return Promise.reject(new Error(`boom-${which}`))
    }

    const text = which && this.replies[which] !== undefined
      ? this.replies[which]!
      : '(no reply configured)'
    return Promise.resolve({ text, media: [] })
  }
}

// ==================== extractJsonBlock ====================

describe('extractJsonBlock', () => {
  it('extracts a ```json fenced block', () => {
    const text = 'Analysis: looks good.\n\n```json\n{"verdict":"long","confidence":0.8}\n```'
    expect(extractJsonBlock(text)).toEqual({ verdict: 'long', confidence: 0.8 })
  })

  it('extracts a plain ``` fenced block without language tag', () => {
    const text = 'foo\n```\n{"verdict":"hold"}\n```\n'
    expect(extractJsonBlock(text)).toEqual({ verdict: 'hold' })
  })

  it('picks the LAST fenced block when multiple exist', () => {
    const text =
      '```json\n{"verdict":"long"}\n```\nAnd updated view:\n```json\n{"verdict":"short"}\n```'
    expect(extractJsonBlock(text)).toEqual({ verdict: 'short' })
  })

  it('falls back to trailing {...} when no fence', () => {
    const text = 'Raw reply with JSON at end: {"verdict":"hold","confidence":0.3}'
    expect(extractJsonBlock(text)).toEqual({ verdict: 'hold', confidence: 0.3 })
  })

  it('returns null when no JSON found', () => {
    expect(extractJsonBlock('just plain text')).toBeNull()
  })

  it('returns null on malformed JSON in fence', () => {
    expect(extractJsonBlock('```json\n{not valid}\n```')).toBeNull()
  })
})

// ==================== parseRoleReply ====================

describe('parseRoleReply', () => {
  it('parses a valid trend verdict', () => {
    const text =
      'Multi-day uptrend with strong volume.\n\n```json\n{"verdict":"bullish","confidence":0.75,"reasoning":"HTF uptrend intact","symbols":["2330"]}\n```'
    const v = parseRoleReply('trend', text, 1234)
    expect(v.role).toBe('trend')
    expect(v.verdict).toBe('bullish')
    expect(v.confidence).toBe(0.75)
    expect(v.reasoning).toBe('HTF uptrend intact')
    expect(v.symbols).toEqual(['2330'])
    expect(v.elapsedMs).toBe(1234)
    expect(v.parseError).toBeUndefined()
  })

  it('clamps confidence to [0, 1]', () => {
    const text = '```json\n{"verdict":"long","confidence":1.7}\n```'
    expect(parseRoleReply('signal', text, 0).confidence).toBe(1)
    const text2 = '```json\n{"verdict":"long","confidence":-0.3}\n```'
    expect(parseRoleReply('signal', text2, 0).confidence).toBe(0)
  })

  it('accepts valid positionFactor for risk', () => {
    const text = '```json\n{"verdict":"reduce","confidence":0.6,"reasoning":"vol high","positionFactor":0.4}\n```'
    const v = parseRoleReply('risk', text, 0)
    expect(v.verdict).toBe('reduce')
    expect(v.positionFactor).toBe(0.4)
  })

  it('rejects an out-of-role verdict enum', () => {
    // trend agent may not return "long"
    const text = '```json\n{"verdict":"long","confidence":0.9}\n```'
    const v = parseRoleReply('trend', text, 0)
    expect(v.parseError).toContain('invalid-verdict')
    expect(v.verdict).toBe('neutral') // fallback default for trend
  })

  it('returns default-blocked with parseError when JSON missing', () => {
    const v = parseRoleReply('risk', 'no json here at all', 0)
    expect(v.verdict).toBe('block') // risk fallback is fail-safe
    expect(v.parseError).toBe('no-json-block')
  })

  it('returns default-hold for signal when JSON missing', () => {
    const v = parseRoleReply('signal', 'no json here', 0)
    expect(v.verdict).toBe('hold')
  })
})

// ==================== combineVerdicts ====================

describe('combineVerdicts', () => {
  function v(role: 'trend' | 'signal' | 'risk', verdict: string, extra: Partial<RoleVerdict> = {}): RoleVerdict {
    return {
      role,
      verdict: verdict as RoleVerdict['verdict'],
      confidence: 0.8,
      reasoning: '',
      rawText: '',
      elapsedMs: 0,
      ...extra,
    }
  }

  it('risk block overrides everything', () => {
    const result = combineVerdicts([
      v('trend', 'bullish'),
      v('signal', 'long'),
      v('risk', 'block', { reasoning: 'too volatile' }),
    ])
    expect(result.finalAction).toBe('blocked')
    expect(result.positionFactor).toBe(0)
    expect(result.rationale).toContain('risk agent blocked')
    expect(result.rationale).toContain('too volatile')
  })

  it('bullish trend + long signal + allow risk → long at full size', () => {
    const result = combineVerdicts([
      v('trend', 'bullish'),
      v('signal', 'long'),
      v('risk', 'allow'),
    ])
    expect(result.finalAction).toBe('long')
    expect(result.positionFactor).toBe(1.0)
  })

  it('bearish trend + short signal + allow risk → short at full size', () => {
    const result = combineVerdicts([
      v('trend', 'bearish'),
      v('signal', 'short'),
      v('risk', 'allow'),
    ])
    expect(result.finalAction).toBe('short')
    expect(result.positionFactor).toBe(1.0)
  })

  it('neutral trend + long signal → signal-led long', () => {
    const result = combineVerdicts([
      v('trend', 'neutral'),
      v('signal', 'long'),
      v('risk', 'allow'),
    ])
    expect(result.finalAction).toBe('long')
    expect(result.rationale).toContain('signal-led')
  })

  it('bearish trend + long signal → hold (conflict)', () => {
    const result = combineVerdicts([
      v('trend', 'bearish'),
      v('signal', 'long'),
      v('risk', 'allow'),
    ])
    expect(result.finalAction).toBe('hold')
    expect(result.positionFactor).toBe(0)
    expect(result.rationale).toContain('conflict')
  })

  it('signal hold → final hold regardless of trend', () => {
    const result = combineVerdicts([
      v('trend', 'bullish'),
      v('signal', 'hold'),
      v('risk', 'allow'),
    ])
    expect(result.finalAction).toBe('hold')
  })

  it('risk reduce uses its own positionFactor', () => {
    const result = combineVerdicts([
      v('trend', 'bullish'),
      v('signal', 'long'),
      v('risk', 'reduce', { positionFactor: 0.3 }),
    ])
    expect(result.finalAction).toBe('long')
    expect(result.positionFactor).toBe(0.3)
    expect(result.rationale).toContain('risk reduced size')
  })

  it('risk reduce defaults to 0.5 if no factor given', () => {
    const result = combineVerdicts([
      v('trend', 'bullish'),
      v('signal', 'long'),
      v('risk', 'reduce'),
    ])
    expect(result.positionFactor).toBe(0.5)
  })

  it('missing verdict → blocked fail-safe', () => {
    const result = combineVerdicts([v('trend', 'bullish'), v('signal', 'long')])
    expect(result.finalAction).toBe('blocked')
    expect(result.rationale).toContain('missing')
  })
})

// ==================== StrategyCouncil integration ====================

describe('StrategyCouncil.askAsRole', () => {
  beforeEach(() => vi.clearAllMocks())

  it('calls agentCenter with the role system prompt and a disabledTools list', async () => {
    const fakeAgent = new FakeAgentCenter({
      trend: '```json\n{"verdict":"bullish","confidence":0.7,"reasoning":"uptrend"}\n```',
    })
    const toolCenter = seedToolCenter()
    const council = new StrategyCouncil({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: fakeAgent as any,
      toolCenter,
    })

    const verdict = await council.askAsRole('trend', '2330 outlook')
    expect(verdict.verdict).toBe('bullish')
    expect(verdict.confidence).toBe(0.7)

    expect(fakeAgent.calls).toHaveLength(1)
    const call = fakeAgent.calls[0]
    expect(call.systemPrompt).toContain('TREND agent')
    // Trend allows fugle/twstock/analysis/news but NOT trading/browser/brain
    expect(call.disabledTools).toContain('trading_place_order')
    expect(call.disabledTools).toContain('browser_navigate')
    expect(call.disabledTools).toContain('brain_commit')
    expect(call.disabledTools).not.toContain('fugle_get_stock_intraday_candles')
    expect(call.disabledTools).not.toContain('twstock_get_stock_kline_data')
  })

  it('risk role sees trading reads but not trading writes', async () => {
    const fakeAgent = new FakeAgentCenter({
      risk: '```json\n{"verdict":"allow","confidence":0.6,"reasoning":"ok"}\n```',
    })
    const toolCenter = seedToolCenter()
    const council = new StrategyCouncil({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: fakeAgent as any,
      toolCenter,
    })
    await council.askAsRole('risk', 'current portfolio risk?')

    const call = fakeAgent.calls[0]
    // mutating trading tools explicitly blacklisted
    expect(call.disabledTools).toContain('trading_place_order')
    // read-only trading tool allowed
    expect(call.disabledTools).not.toContain('trading_get_positions')
  })

  it('uses per-role profile override when configured', async () => {
    const fakeAgent = new FakeAgentCenter({
      signal: '```json\n{"verdict":"long","confidence":0.5,"reasoning":"bar close breakout"}\n```',
    })
    const toolCenter = seedToolCenter()
    const council = new StrategyCouncil({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: fakeAgent as any,
      toolCenter,
      profileByRole: { signal: 'haiku-fast' },
    })
    await council.askAsRole('signal', 'BTCUSDT 5m setup')

    expect(fakeAgent.calls[0].profileSlug).toBe('haiku-fast')
  })

  it('surfaces parse errors without throwing', async () => {
    const fakeAgent = new FakeAgentCenter({
      trend: 'no structured output here',
    })
    const toolCenter = seedToolCenter()
    const council = new StrategyCouncil({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      agentCenter: fakeAgent as any,
      toolCenter,
    })

    const verdict = await council.askAsRole('trend', 'test')
    expect(verdict.parseError).toBe('no-json-block')
    expect(verdict.verdict).toBe('neutral')
  })
})

describe('StrategyCouncil.deliberate', () => {
  it('runs all three roles and emits a strategy.decision event', async () => {
    const fakeAgent = new FakeAgentCenter({
      trend: '```json\n{"verdict":"bullish","confidence":0.8,"reasoning":"uptrend"}\n```',
      signal: '```json\n{"verdict":"long","confidence":0.7,"reasoning":"breakout"}\n```',
      risk: '```json\n{"verdict":"allow","confidence":0.9,"reasoning":"low vol"}\n```',
    })
    const toolCenter = seedToolCenter()
    const appendSpy = vi.fn().mockResolvedValue({})
    const eventLog = {
      append: appendSpy,
    } as unknown as Parameters<typeof makeCouncil>[2]
    const council = makeCouncil(fakeAgent, toolCenter, eventLog)

    const decision = await council.deliberate('2330 intraday')

    expect(decision.finalAction).toBe('long')
    expect(decision.positionFactor).toBe(1.0)
    expect(decision.verdicts).toHaveLength(3)
    expect(decision.verdicts.map((v) => v.role).sort()).toEqual(['risk', 'signal', 'trend'])
    expect(appendSpy).toHaveBeenCalledWith(STRATEGY_DECISION_EVENT, expect.any(Object))
    expect(fakeAgent.calls).toHaveLength(3)
  })

  it('blocks when risk agent vetoes', async () => {
    const fakeAgent = new FakeAgentCenter({
      trend: '```json\n{"verdict":"bullish","confidence":0.9,"reasoning":"x"}\n```',
      signal: '```json\n{"verdict":"long","confidence":0.9,"reasoning":"y"}\n```',
      risk: '```json\n{"verdict":"block","confidence":0.9,"reasoning":"max drawdown today"}\n```',
    })
    const council = makeCouncil(fakeAgent, seedToolCenter())
    const decision = await council.deliberate('go long AAPL')
    expect(decision.finalAction).toBe('blocked')
    expect(decision.positionFactor).toBe(0)
    expect(decision.rationale).toContain('max drawdown')
  })

  it('propagates errors and writes a strategy.error event', async () => {
    const fakeAgent = new FakeAgentCenter(
      {
        trend: '```json\n{"verdict":"bullish","confidence":0.5,"reasoning":""}\n```',
        signal: '```json\n{"verdict":"long","confidence":0.5,"reasoning":""}\n```',
      },
      'risk',
    )
    const appendSpy = vi.fn().mockResolvedValue({})
    const eventLog = { append: appendSpy } as unknown as Parameters<typeof makeCouncil>[2]
    const council = makeCouncil(fakeAgent, seedToolCenter(), eventLog)

    await expect(council.deliberate('anything')).rejects.toThrow('boom-risk')
    expect(appendSpy).toHaveBeenCalledWith('strategy.error', expect.objectContaining({
      error: 'boom-risk',
    }))
  })
})

// ==================== Helpers ====================

function makeCouncil(
  fakeAgent: FakeAgentCenter,
  toolCenter: ToolCenter,
  eventLog?: unknown,
): StrategyCouncil {
  return new StrategyCouncil({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agentCenter: fakeAgent as any,
    toolCenter,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    eventLog: eventLog as any,
  })
}
