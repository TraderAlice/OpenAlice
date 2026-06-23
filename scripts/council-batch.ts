/**
 * council-batch — pump N realistic market scenarios through the live
 * Strategy Council and emit a markdown report so the operator can review
 * role-prompt quality at scale.
 *
 * Usage (backend must be running on port 3002):
 *
 *   pnpm tsx scripts/council-batch.ts                 # run all 20 scenarios
 *   pnpm tsx scripts/council-batch.ts --limit 5       # quick smoke test (5)
 *   pnpm tsx scripts/council-batch.ts --base-url http://localhost:3002
 *
 * Output:
 *   reports/council-batch.md — per-scenario breakdown with verdict, final
 *   action, elapsed time, and a trimmed reasoning excerpt for each role.
 *
 * Why this exists:
 *   Step 5 (wiring the council into live trading) depends on trusting the
 *   three role prompts. A single real-Claude deliberation is not enough to
 *   build that trust — we need a few dozen diverse inputs before we can see
 *   whether the roles genuinely disagree, whether they call tools, and
 *   whether coordinator fusion produces sensible final actions. This batch
 *   is that evidence.
 *
 * Cost warning:
 *   20 scenarios × 3 role sub-calls × ~10-30k tokens ≈ $5-15 in Claude
 *   Sonnet calls. Use --limit to keep it cheap during iteration.
 */

import { writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { parseArgs } from 'node:util'

// ==================== CLI parsing ====================

function parseCliArgs() {
  const { values } = parseArgs({
    options: {
      'base-url': { type: 'string', default: 'http://localhost:3002' },
      limit: { type: 'string' },
      out: { type: 'string', default: 'reports/council-batch.md' },
      help: { type: 'boolean', short: 'h' },
    },
  })
  if (values.help) {
    console.log(`Usage:
  pnpm tsx scripts/council-batch.ts [--base-url URL] [--limit N] [--out PATH]

Options:
  --base-url  Backend base URL (default http://localhost:3002)
  --limit     Only run the first N scenarios (for cheap smoke tests)
  --out       Report output path (default reports/council-batch.md)
`)
    process.exit(0)
  }
  return {
    baseUrl: values['base-url']!,
    limit: values.limit ? Number(values.limit) : undefined,
    out: values.out!,
  }
}

// ==================== Scenarios ====================

interface Scenario {
  id: string
  group: 'casual' | 'user' | 'setup' | 'stress'
  title: string
  input: string
}

/**
 * Scenarios are intentionally phrased without hard-coded prices — the three
 * role agents are supposed to fetch current quotes themselves via the
 * Fugle/Twstock MCP tools. Hard-coding a fake price ("台積電現在 1105")
 * triggers the Risk agent's sanity check when it notices the real price is
 * totally different, and every scenario gets blocked. Describe the *situation*
 * (e.g. "剛創波段新高" / "跌破前低") and let the agents look up the numbers.
 */
const SCENARIOS: Scenario[] = [
  // --- Group 1: 最懶的一般人輸入(3 條)---
  {
    id: 'C1',
    group: 'casual',
    title: '一行完事',
    input: '我在想要不要買台積電 2330。',
  },
  {
    id: 'C2',
    group: 'casual',
    title: '沒給價格的詢問',
    input: '聯發科 2454 最近怎麼樣?可以進場嗎?',
  },
  {
    id: 'C3',
    group: 'casual',
    title: '從眾心理',
    input: '聽說鴻海 2317 最近有題材,大家都說會漲,我該跟進嗎?',
  },

  // --- Group 2: 典型使用者情境(9 條)---
  {
    id: 'U1',
    group: 'user',
    title: '追高猶豫',
    input: '2330 台積電最近一直漲,今天又創波段新高。我沒持倉,想追但有點怕追高。',
  },
  {
    id: 'U2',
    group: 'user',
    title: '套牢求助',
    input: '我昨天買了聯發科 2454,今天跌了 2% 多,帳面虧錢。新聞說市場擔心美國關稅。我要砍掉還是放著等反彈?',
  },
  {
    id: 'U3',
    group: 'user',
    title: '盤前掃描',
    input: '早上還沒開盤,想看一下今天台積電 2330 可不可以進場。',
  },
  {
    id: 'U4',
    group: 'user',
    title: '跌破支撐怕套',
    input: '鴻海 2317 剛剛跌破前波低點,量也放大。我手上有 5 張已經套住,要停損嗎?',
  },
  {
    id: 'U5',
    group: 'user',
    title: 'ETF 加碼',
    input: '0050 已經持有一年多,帳面賺錢,現在想再加碼 10 萬,時機對嗎?',
  },
  {
    id: 'U6',
    group: 'user',
    title: '當沖獲利了結',
    input: '早上當沖進 2603 長榮,現在小賺 2%,該跑還是等突破今日高?',
  },
  {
    id: 'U7',
    group: 'user',
    title: '收盤前砍倉猶豫',
    input: '下午 1:20,2330 今天早上進場後小幅虧損,剩 10 分鐘要不要砍?',
  },
  {
    id: 'U8',
    group: 'user',
    title: '新聞利空抄底',
    input: '2308 台達電 早盤因為一篇研究報告下修獲利預測,跌了 4%,我想抄底,合理嗎?',
  },
  {
    id: 'U9',
    group: 'user',
    title: '空手等機會',
    input: '現在手上零持倉,看大盤震盪想找標的進場。你推薦今天觀察哪幾支?',
  },

  // --- Group 3: 具體 setup 情境(5 條,比較像交易員會問的)---
  {
    id: 'S1',
    group: 'setup',
    title: '突破量能確認',
    input: '2330 盤中剛剛突破今日高點,成交量放大。週線整理末端。我想進場 1 張,停損設在今日低點,目標看前波高,這樣的 RR 合理嗎?',
  },
  {
    id: 'S2',
    group: 'setup',
    title: '跨市場對照',
    input: 'BTC/USDT 跌破重要支撐,funding 翻負。連動台灣加密相關股票也跌。我手上有 2498 宏達電,要不要避險?',
  },
  {
    id: 'S3',
    group: 'setup',
    title: '月線關鍵測試',
    input: '台積電 2330 今天盤中跌到月線附近再彈上來。這是假跌破還是真支撐?下午應該加碼還是觀望?',
  },
  {
    id: 'S4',
    group: 'setup',
    title: '法說前夕',
    input: '聯電 2303 明天法說會,最近兩週橫盤。法說前要不要先佈局?風險怎麼看?',
  },
  {
    id: 'S5',
    group: 'setup',
    title: '外資連買觀察',
    input: '華碩 2357 外資連續買超 5 天,今天突破三個月高。要不要跟進?',
  },

  // --- Group 4: 壓力測試 / edge case(3 條)---
  {
    id: 'E1',
    group: 'stress',
    title: '資訊衝突',
    input: '2330 今天盤中既有突破又有回測，盤面訊號混亂。我該進場還是等明確方向?',
  },
  {
    id: 'E2',
    group: 'stress',
    title: '已超過當日風險額度',
    input: '2454 聯發科出現漂亮的突破 setup,但我今天已經虧超過我 -1.5% 當日上限,還能再做嗎?',
  },
  {
    id: 'E3',
    group: 'stress',
    title: '完全沒資訊的輸入',
    input: '幫我看看現在可以做什麼。',
  },
]

// ==================== Client ====================

interface RoleVerdict {
  role: 'trend' | 'signal' | 'risk'
  verdict: string
  confidence: number
  reasoning: string
  positionFactor?: number
  elapsedMs: number
  parseError?: string
}

interface StrategyDecision {
  id: string
  finalAction: 'long' | 'short' | 'hold' | 'blocked'
  rationale: string
  positionFactor: number
  elapsedMs: number
  verdicts: RoleVerdict[]
}

interface ScenarioResult {
  scenario: Scenario
  decision?: StrategyDecision
  error?: string
  wallClockMs: number
}

async function deliberate(baseUrl: string, input: string): Promise<StrategyDecision> {
  const res = await fetch(`${baseUrl}/api/strategy-council/deliberate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`)
  }
  const json = await res.json() as { decision: StrategyDecision }
  return json.decision
}

// ==================== Main loop ====================

async function main() {
  const args = parseCliArgs()
  const scenarios = args.limit ? SCENARIOS.slice(0, args.limit) : SCENARIOS

  console.log(`Council batch — ${scenarios.length} scenarios via ${args.baseUrl}`)
  console.log(`Each scenario runs 3 parallel role sub-calls, so expect ~1-3 min per scenario.`)
  console.log(`Estimated wall-clock: ${scenarios.length * 2} minutes (rough).`)
  console.log('')

  const results: ScenarioResult[] = []
  const batchStart = Date.now()

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    const pad = String(i + 1).padStart(2, ' ')
    process.stdout.write(`  [${pad}/${scenarios.length}] ${scenario.id} ${scenario.title.padEnd(20, ' ')}  `)

    const start = Date.now()
    try {
      const decision = await deliberate(args.baseUrl, scenario.input)
      const wall = Date.now() - start
      results.push({ scenario, decision, wallClockMs: wall })
      console.log(`${decision.finalAction.padEnd(7)}  ${(wall / 1000).toFixed(1)}s`)
    } catch (err) {
      const wall = Date.now() - start
      const message = err instanceof Error ? err.message : String(err)
      results.push({ scenario, error: message, wallClockMs: wall })
      console.log(`ERROR   ${(wall / 1000).toFixed(1)}s  ${message.slice(0, 60)}`)
    }
  }

  const batchElapsed = Date.now() - batchStart
  const successes = results.filter((r) => r.decision).length
  const failures = results.length - successes

  console.log('')
  console.log(`Batch done: ${successes}/${results.length} succeeded, ${failures} failed, ${(batchElapsed / 1000 / 60).toFixed(1)} min wall-clock`)

  // ---------- Write report ----------
  await writeReport(results, args.out, batchElapsed)
  console.log(`Report: ${resolve(args.out)}`)
}

// ==================== Report writer ====================

function trim(s: string, max: number): string {
  const clean = s.replace(/\s+/g, ' ').trim()
  return clean.length > max ? clean.slice(0, max) + '…' : clean
}

async function writeReport(results: ScenarioResult[], outPath: string, batchElapsed: number) {
  const lines: string[] = []
  lines.push('# Council Batch Validation Report')
  lines.push('')
  lines.push(`Generated: ${new Date().toISOString()}`)
  lines.push('')

  // Summary
  const successes = results.filter((r) => r.decision)
  const byAction = new Map<string, number>()
  for (const r of successes) {
    byAction.set(r.decision!.finalAction, (byAction.get(r.decision!.finalAction) ?? 0) + 1)
  }
  const avgElapsedSec = successes.length > 0
    ? (successes.reduce((s, r) => s + r.wallClockMs, 0) / successes.length / 1000).toFixed(1)
    : '—'

  lines.push('## Summary')
  lines.push('')
  lines.push(`- Scenarios: **${results.length}**`)
  lines.push(`- Succeeded: **${successes.length}**`)
  lines.push(`- Failed: **${results.length - successes.length}**`)
  lines.push(`- Avg deliberation time: **${avgElapsedSec}s**`)
  lines.push(`- Batch wall-clock: **${(batchElapsed / 1000 / 60).toFixed(1)} min**`)
  lines.push('')
  if (byAction.size > 0) {
    lines.push('Final action distribution:')
    lines.push('')
    lines.push('| Action | Count |')
    lines.push('|---|---:|')
    for (const [action, count] of byAction.entries()) {
      lines.push(`| \`${action}\` | ${count} |`)
    }
    lines.push('')
  }

  // Per-group breakdown
  const groups: Record<string, ScenarioResult[]> = {}
  for (const r of results) {
    const g = r.scenario.group
    if (!groups[g]) groups[g] = []
    groups[g].push(r)
  }
  const groupLabels: Record<string, string> = {
    casual: '最懶輸入(Casual)',
    user: '典型使用者情境(User)',
    setup: '具體 Setup(Setup)',
    stress: '壓力測試(Stress)',
  }

  for (const [groupKey, groupResults] of Object.entries(groups)) {
    lines.push(`## ${groupLabels[groupKey] ?? groupKey}`)
    lines.push('')
    for (const r of groupResults) {
      const { scenario, decision, error, wallClockMs } = r
      lines.push(`### ${scenario.id} — ${scenario.title}`)
      lines.push('')
      lines.push(`**Input:** ${scenario.input}`)
      lines.push('')
      if (error) {
        lines.push(`**Error:** ${error}`)
        lines.push('')
      } else if (decision) {
        lines.push(`**Final:** \`${decision.finalAction}\` · posFactor \`${decision.positionFactor.toFixed(2)}\` · elapsed ${(wallClockMs / 1000).toFixed(1)}s`)
        lines.push('')
        lines.push(`**Rationale:** ${decision.rationale}`)
        lines.push('')
        lines.push('| Role | Verdict | Conf | ElapsedMs | Reasoning excerpt |')
        lines.push('|---|---|---:|---:|---|')
        for (const v of decision.verdicts) {
          const reasoning = trim(v.reasoning, 110).replace(/\|/g, '\\|')
          const conf = (v.confidence * 100).toFixed(0) + '%'
          const pe = v.parseError ? ` _(${v.parseError})_` : ''
          lines.push(`| ${v.role} | ${v.verdict}${pe} | ${conf} | ${v.elapsedMs} | ${reasoning} |`)
        }
        lines.push('')
      }
      lines.push('---')
      lines.push('')
    }
  }

  const finalPath = resolve(outPath)
  await mkdir(dirname(finalPath), { recursive: true })
  await writeFile(finalPath, lines.join('\n'))
}

main().catch((err) => {
  console.error('council-batch failed:', err instanceof Error ? err.message : err)
  process.exit(1)
})
