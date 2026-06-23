/**
 * Strategy Council demo harness — continuous Q&A test.
 *
 * Runs a sequence of distinct market-context scenarios through the
 * StrategyCouncil coordinator with a scripted FakeAgentCenter. Each
 * scenario is defined with:
 *   - a market-context prompt (what the council is asked)
 *   - canned role replies (so we can drive the council through
 *     precisely the coordinator paths we want to exercise)
 *
 * Output goes to stdout and to reports/council-demo.md so a reviewer
 * can read the exact verdicts + rationales without re-running the
 * script.
 *
 * Run with: tsx scripts/council-demo.ts
 *
 * This uses a FakeAgentCenter on purpose — the point is to prove the
 * coordinator + parser + event emission all behave correctly across
 * diverse inputs, without consuming an LLM quota.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { ToolCenter } from '../src/core/tool-center.js'
import { StrategyCouncil } from '../src/core/strategy-council/index.js'
import type { StrategyDecision } from '../src/core/strategy-council/index.js'
import type { Tool } from 'ai'

// ==================== Shared fakes ====================

function fakeTool(description: string): Tool {
  return { description } as unknown as Tool
}

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
      trading_close_position: fakeTool('close'),
    },
    'trading',
  )
  tc.register({ browser_navigate: fakeTool('browser') }, 'browser')
  tc.register({ brain_commit: fakeTool('brain') }, 'brain')
  return tc
}

// ==================== FakeAgentCenter ====================

interface CannedReplies {
  trend?: string
  signal?: string
  risk?: string
}

class FakeAgentCenter {
  constructor(private reply: CannedReplies) {}

  async askWithSession(
    _prompt: string,
    _session: unknown,
    opts?: { systemPrompt?: string },
  ): Promise<{ text: string; media: [] }> {
    const sp = opts?.systemPrompt ?? ''
    let text = '(no reply configured)'
    if (sp.includes('TREND agent')) text = this.reply.trend ?? text
    else if (sp.includes('SIGNAL agent')) text = this.reply.signal ?? text
    else if (sp.includes('RISK agent')) text = this.reply.risk ?? text

    // Simulate a small amount of work so elapsedMs is non-zero.
    await new Promise((r) => setTimeout(r, 10))
    return { text, media: [] }
  }
}

// ==================== Scenarios ====================

interface Scenario {
  id: string
  title: string
  prompt: string
  replies: CannedReplies
  expectedAction?: 'long' | 'short' | 'hold' | 'blocked'
}

// Helper to build a canned role reply with the strict JSON contract.
function jsonReply(
  verdict: string,
  confidence: number,
  reasoning: string,
  extras: Record<string, unknown> = {},
): string {
  const body = { verdict, confidence, reasoning, ...extras }
  return `Analysis notes...\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\``
}

const SCENARIOS: Scenario[] = [
  {
    id: 'S1',
    title: 'Bull regime + clean breakout + low portfolio stress',
    prompt:
      'TWSE 2330 (TSMC): 1m candles showed a clean breakout above 1105 with 2x average volume. Weekly trend is up. Portfolio has zero positions and no recent losses. What should the council do?',
    replies: {
      trend: jsonReply('bullish', 0.82, 'Weekly trend up, 20/50 EMA stacked bullishly, no recent distribution.'),
      signal: jsonReply('long', 0.78, '1m breakout above 1105 confirmed with above-average volume; structure intact.', {
        symbols: ['2330'],
      }),
      risk: jsonReply('allow', 0.9, 'Zero current exposure, no drawdown today, volatility within band.'),
    },
    expectedAction: 'long',
  },
  {
    id: 'S2',
    title: 'Bullish setup overridden by risk block (max drawdown today)',
    prompt:
      'Same TSMC breakout as S1 but we have already hit -1.8% drawdown today on two failed longs. Should we chase?',
    replies: {
      trend: jsonReply('bullish', 0.8, 'HTF structure unchanged since morning — still a bull regime.'),
      signal: jsonReply('long', 0.75, 'Fresh 1m breakout, similar setup to the two that failed earlier.'),
      risk: jsonReply('block', 0.95, 'Daily drawdown -1.8% exceeds the -1.5% soft cap and two consecutive losses triggered a cooldown.'),
    },
    expectedAction: 'blocked',
  },
  {
    id: 'S3',
    title: 'Bear regime + clean breakdown + normal risk',
    prompt:
      'BTC/USDT: 5m chart just broke below the 42,000 pivot with high volume. Daily chart rolled over two days ago. Portfolio is flat.',
    replies: {
      trend: jsonReply('bearish', 0.78, 'Daily MA slope turned negative 48h ago, lower highs intact.'),
      signal: jsonReply('short', 0.72, '5m close below 42,000 with follow-through and momentum flip.', {
        symbols: ['BTC/USDT'],
      }),
      risk: jsonReply('allow', 0.8, 'No current exposure, funding neutral, vol within 30d band.'),
    },
    expectedAction: 'short',
  },
  {
    id: 'S4',
    title: 'Neutral regime + signal-led long (coordinator fallback)',
    prompt:
      '2603 long: weekly chart is flat, but 15m just printed a textbook higher-low + volume pocket. Council?',
    replies: {
      trend: jsonReply('neutral', 0.55, 'Weekly range-bound, no directional bias; awaiting resolution.'),
      signal: jsonReply('long', 0.7, '15m higher-low + reclaim of value area gives a tactical long.', {
        symbols: ['2603'],
      }),
      risk: jsonReply('allow', 0.85, 'Small position ok in range environment.'),
    },
    expectedAction: 'long',
  },
  {
    id: 'S5',
    title: 'Bull regime but signal wants to rest (hold)',
    prompt:
      'TSMC is still in a bull regime but the 5m is mid-range and volume has dried up the past 30 minutes. Should we force a trade?',
    replies: {
      trend: jsonReply('bullish', 0.7, 'Weekly bull trend intact.'),
      signal: jsonReply('hold', 0.8, 'Mid-range chop with declining volume — no edge here.'),
      risk: jsonReply('allow', 0.9, 'No particular concern.'),
    },
    expectedAction: 'hold',
  },
  {
    id: 'S6',
    title: 'Trend/signal conflict → hold',
    prompt:
      '2454 (Mediatek): HTF is clearly bearish but 1m is ripping with news-driven spike. Do we fade or chase?',
    replies: {
      trend: jsonReply('bearish', 0.8, 'Daily and 4h both in downtrend, below key moving averages.'),
      signal: jsonReply('long', 0.6, 'News-driven 1m spike with heavy buy volume.'),
      risk: jsonReply('allow', 0.5, 'No position, but this is a counter-trend chase.'),
    },
    expectedAction: 'hold',
  },
  {
    id: 'S7',
    title: 'Risk reduce: take the trade but scale position to 0.3',
    prompt:
      'ETH/USDT pullback long setup. Trend and signal both agree, but realised volatility is 80th percentile and we already hold BTC longs.',
    replies: {
      trend: jsonReply('bullish', 0.7, '4h uptrend intact, higher lows visible.'),
      signal: jsonReply('long', 0.68, 'Clean 15m pullback to 20 EMA, bounce off value area low.'),
      risk: jsonReply('reduce', 0.75, 'Vol 80th percentile + correlated BTC longs → scale down to 0.3.', {
        positionFactor: 0.3,
      }),
    },
    expectedAction: 'long',
  },
  {
    id: 'S8',
    title: 'Signal agent returns broken JSON (parse-error fallback)',
    prompt:
      'Stress-test the parser: how does the council handle a signal agent that forgets the JSON fence?',
    replies: {
      trend: jsonReply('bullish', 0.6, 'Nothing unusual about the trend.'),
      signal: 'I think we should go long around 1105 with stop at 1100, target 1110. Confidence around 0.7.',
      risk: jsonReply('allow', 0.7, 'Normal day.'),
    },
    expectedAction: 'hold', // signal defaults to 'hold' on parse failure
  },
  {
    id: 'S9',
    title: 'Risk agent malformed → fail-safe block',
    prompt:
      'Stress-test: risk agent returns non-JSON prose. What is the fail-safe behavior?',
    replies: {
      trend: jsonReply('bullish', 0.8, 'Strong trend.'),
      signal: jsonReply('long', 0.75, 'Clean breakout.'),
      risk: 'I cannot tell, the portfolio data looks stale to me.',
    },
    expectedAction: 'blocked', // risk defaults to 'block' on parse failure — fail-safe
  },
  {
    id: 'S10',
    title: 'High-volatility crypto + conservative sizing',
    prompt:
      'SOL/USDT is +6% on the day with 1h consolidation. Trend up, signal breakout, but intraday ATR is elevated.',
    replies: {
      trend: jsonReply('bullish', 0.65, 'Daily trend up, but extended from 20 EMA.'),
      signal: jsonReply('long', 0.6, '1h range break with OI expansion.', { symbols: ['SOL/USDT'] }),
      risk: jsonReply('reduce', 0.7, 'ATR 2x 30d average — halve size to manage tail risk.', {
        positionFactor: 0.5,
      }),
    },
    expectedAction: 'long',
  },
]

// ==================== Runner ====================

interface ReportEntry {
  scenario: Scenario
  decision: StrategyDecision
  passed: boolean
}

async function runOne(scenario: Scenario): Promise<ReportEntry> {
  const fake = new FakeAgentCenter(scenario.replies)
  const toolCenter = seedToolCenter()
  const council = new StrategyCouncil({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    agentCenter: fake as any,
    toolCenter,
  })

  const decision = await council.deliberate(scenario.prompt)
  const passed = !scenario.expectedAction || decision.finalAction === scenario.expectedAction
  return { scenario, decision, passed }
}

function formatDecision(entry: ReportEntry): string {
  const { scenario, decision, passed } = entry
  const lines: string[] = []
  lines.push(`### ${scenario.id} — ${scenario.title}`)
  lines.push('')
  lines.push(`**Prompt:** ${scenario.prompt}`)
  lines.push('')
  lines.push('| Role | Verdict | Conf | Reasoning |')
  lines.push('|------|---------|------|-----------|')
  for (const v of decision.verdicts) {
    const reasoning = v.reasoning.replace(/\|/g, '\\|').slice(0, 140)
    const conf = (v.confidence * 100).toFixed(0) + '%'
    const pe = v.parseError ? ` _(parseError: ${v.parseError})_` : ''
    lines.push(`| ${v.role} | ${v.verdict}${pe} | ${conf} | ${reasoning} |`)
  }
  lines.push('')
  lines.push(`**Final action:** \`${decision.finalAction}\` · position factor \`${decision.positionFactor.toFixed(2)}\` · elapsed ${decision.elapsedMs}ms`)
  lines.push('')
  lines.push(`**Rationale:** ${decision.rationale}`)
  lines.push('')
  if (scenario.expectedAction) {
    const status = passed ? '✓ PASS' : '✗ FAIL'
    lines.push(`**Expected:** \`${scenario.expectedAction}\` → ${status}`)
    lines.push('')
  }
  lines.push('---')
  lines.push('')
  return lines.join('\n')
}

async function main() {
  const start = Date.now()
  const results: ReportEntry[] = []

  console.log('StrategyCouncil continuous Q&A demo')
  console.log('===================================')
  console.log(`Running ${SCENARIOS.length} scenarios…`)
  console.log('')

  for (const scenario of SCENARIOS) {
    process.stdout.write(`  ${scenario.id}  ${scenario.title.padEnd(60, ' ')}  `)
    const entry = await runOne(scenario)
    results.push(entry)
    const tag = entry.passed ? 'OK' : 'FAIL'
    console.log(`${entry.decision.finalAction.padEnd(7)}  [${tag}]`)
  }

  const elapsed = Date.now() - start
  const passCount = results.filter((r) => r.passed).length

  console.log('')
  console.log(`Done. ${passCount}/${results.length} passed in ${elapsed}ms.`)

  // ---------- Write markdown report ----------
  const report: string[] = []
  report.push('# Strategy Council — Continuous Q&A Test Report')
  report.push('')
  report.push(`Generated by \`scripts/council-demo.ts\` on ${new Date().toISOString()}`)
  report.push('')
  report.push('## Summary')
  report.push('')
  report.push(`- Scenarios: **${results.length}**`)
  report.push(`- Passed: **${passCount}**`)
  report.push(`- Failed: **${results.length - passCount}**`)
  report.push(`- Wall-clock duration: **${elapsed}ms**`)
  report.push('')
  report.push('Each scenario drives the `StrategyCouncil.deliberate()` pipeline end-to-end:')
  report.push('role-level tool whitelist → stateless sub-agent call (throwaway MemorySessionStore)')
  report.push('→ JSON verdict extraction → coordinator fusion → event emission.')
  report.push('')
  report.push('The sub-agent calls are backed by a scripted `FakeAgentCenter` so every')
  report.push('coordinator path can be exercised deterministically without consuming LLM')
  report.push('quota. This is intentional — the goal of this harness is to prove the')
  report.push('**coordinator + parser + event flow** behave correctly across diverse')
  report.push('inputs. Real-LLM evaluation is a separate concern (it needs a funded API')
  report.push('key, rate limit handling, and a reproducibility strategy).')
  report.push('')
  report.push('## Scenarios')
  report.push('')
  for (const entry of results) {
    report.push(formatDecision(entry))
  }

  const reportPath = resolve('reports/council-demo.md')
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, report.join('\n'))
  console.log(`Report written to ${reportPath}`)

  if (passCount !== results.length) {
    process.exitCode = 1
  }
}

main().catch((err) => {
  console.error('demo failed:', err)
  process.exit(1)
})
