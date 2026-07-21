# JMB Goldmine Shadow Risk Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shadow-decision and demo-risk-shell layer so JMB Goldmine starts learning from its own logged decisions before any demo order execution is enabled.

**Architecture:** The app creates append-only JMB decision records and a latest-decision CSV that an MT5 risk-shell EA can read. The MT5 risk shell validates demo account, symbol, lot, stop, spread, freshness, kill switch, and manual/foreign exposure, then writes gate status only. This plan deliberately does not submit demo orders; it prepares and verifies the deterministic safety shell for a later execution plan.

**Tech Stack:** TypeScript, Vitest, Hono Research API, React Research Dashboard, MQL5 read/gate/log EA, MetaTrader Common Files CSV/JSONL.

## Global Constraints

- Manual trades are supporting broker/cost evidence, not primary strategy labels.
- JMB-generated decisions are the primary learning dataset.
- Shadow mode exists before demo execution.
- Demo execution remains EA-only and deterministic.
- Gold and EURUSD are both included.
- EURUSD remains demo-blocked until its own candidate gate passes.
- Live trading remains out of scope.
- Every decision and skip is logged with reason and gate results.
- This plan must not introduce `OrderSend`, `CTrade`, `trade.Buy`, `trade.Sell`, order modification, or position close logic.
- The MT5 risk shell must log gate status only; actual demo order submission is a later plan.
- If any gate cannot be evaluated, it fails closed.
- Do not change unrelated dirty working-tree files.

---

## Scope split

This design has three layers:

1. **Plan 2, this plan:** shadow decisions, latest-decision export, risk-shell gate logging, and UI visibility.
2. **Plan 3, later:** demo order submission from the EA after the risk shell has been verified.
3. **Future live spec, later:** separate live pilot policy, account binding, approval ceremony, and loss cap.

This plan stops at layer 1. A successful result means the system can say, "JMB would trade / would skip / would be blocked, and here are the exact gates," but it still cannot place orders.

## File structure

- Create `src/domain/mt5/decision-record.ts`
  - Owns decision record types, CSV serialization for MT5, JSONL persistence, latest decision read/write, and summaries.
- Create `src/domain/mt5/decision-record.spec.ts`
  - Tests decision IDs, CSV escaping, append/read behavior, malformed fail-closed behavior, and latest decision summary.
- Create `src/domain/mt5/shadow-decision-engine.ts`
  - Pure strategy/risk pre-gate function that turns bridge/learning/trend inputs into `shadow`, `skipped`, or `demo_blocked` decision records.
- Create `src/domain/mt5/shadow-decision-engine.spec.ts`
  - Tests Gold shadow decisions, EURUSD demo-blocking, stale bridge skips, and stop-loss-required blocking.
- Create `tools/mt5/run_shadow_decisions.ts`
  - Local runner that reads Research artifacts plus bridge/ledger summaries and writes decision JSONL + latest-decision CSV for all four broker/symbol pairs.
- Create `tools/mt5/JmbGoldmineDemoRiskShell.mq5`
  - MQL5 EA that reads latest-decision CSV, evaluates gates, and writes `gate_status.csv`; no order submission.
- Modify `tools/mt5/README.md`
  - Documents shadow runner and risk shell setup.
- Modify `src/webui/routes/research.ts`
  - Adds latest JMB decision summaries per instrument.
- Modify `ui/src/api/research.ts`
  - Adds decision summary types.
- Modify `ui/src/pages/ResearchDashboardPage.tsx`
  - Displays JMB decision mode and risk-shell status as non-trading approval evidence.

---

### Task 1: Add decision record persistence

**Files:**
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\decision-record.ts`
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\decision-record.spec.ts`

**Interfaces:**
- Produces:
  - `type JmbDecisionMode = 'shadow' | 'demo_blocked' | 'demo_order_requested' | 'demo_filled' | 'demo_closed' | 'skipped'`
  - `type JmbDecisionDirection = 'buy' | 'sell' | 'flat'`
  - `interface JmbDecisionRecord`
  - `function createJmbDecisionId(input: Pick<JmbDecisionRecord, 'createdAt' | 'broker' | 'symbol' | 'strategyVersion' | 'mode' | 'direction'>): string`
  - `function serializeLatestDecisionCsv(record: JmbDecisionRecord): string`
  - `function parseLatestDecisionCsv(text: string): JmbDecisionRecord`
  - `async function appendJmbDecisionRecord(root: string, record: JmbDecisionRecord): Promise<void>`
  - `async function writeLatestJmbDecision(root: string, record: JmbDecisionRecord): Promise<void>`
  - `async function summarizeLatestJmbDecision(root: string, broker: string, symbol: string, now?: Date): Promise<JmbDecisionSummary>`

- [ ] **Step 1: Write failing tests**

Create `src/domain/mt5/decision-record.spec.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendJmbDecisionRecord,
  createJmbDecisionId,
  parseLatestDecisionCsv,
  serializeLatestDecisionCsv,
  summarizeLatestJmbDecision,
  writeLatestJmbDecision,
  type JmbDecisionRecord,
} from './decision-record.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function sampleDecision(overrides: Partial<JmbDecisionRecord> = {}): JmbDecisionRecord {
  const base: JmbDecisionRecord = {
    schemaVersion: 1,
    decisionId: 'decision-1',
    createdAt: '2026-07-13T09:00:00.000Z',
    broker: 'hfmarkets',
    server: 'HFMarketsGlobal-Demo4',
    accountMode: 'demo',
    symbol: 'XAUUSD',
    canonicalInstrument: 'Gold / USD',
    strategyVersion: 'daily-trend-v1',
    mode: 'shadow',
    direction: 'buy',
    reasonCode: 'daily_trend_shadow',
    reasonDetail: 'Completed daily trend filter is positive.',
    entryReferencePrice: 2410.25,
    stopLoss: 2402.25,
    takeProfit: null,
    volume: 0.01,
    spread: 0.36,
    riskAmount: 0.8,
    maxAllowedRisk: 1,
    gateResults: [
      { gate: 'account_demo', state: 'pass', detail: 'MT5 reports demo mode' },
      { gate: 'shadow_only', state: 'pass', detail: 'No order submission in Plan 2' },
    ],
    orderTicket: null,
    positionId: null,
    outcome: null,
  }
  return { ...base, ...overrides }
}

describe('JMB decision records', () => {
  it('creates stable ids from deterministic fields', () => {
    const id = createJmbDecisionId(sampleDecision())
    expect(id).toBe(createJmbDecisionId(sampleDecision()))
    expect(id).not.toBe(createJmbDecisionId(sampleDecision({ direction: 'sell' })))
  })

  it('round-trips latest-decision CSV without losing gate results', () => {
    const decision = sampleDecision({ reasonDetail: 'Spread, trend, and stop checked' })
    const parsed = parseLatestDecisionCsv(serializeLatestDecisionCsv(decision))
    expect(parsed).toMatchObject({
      broker: 'hfmarkets',
      symbol: 'XAUUSD',
      mode: 'shadow',
      direction: 'buy',
      volume: 0.01,
      stopLoss: 2402.25,
    })
    expect(parsed.gateResults).toHaveLength(2)
  })

  it('writes append-only JSONL and latest CSV under broker symbol folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jmb-decisions-'))
    directories.push(root)
    const decision = sampleDecision()

    await appendJmbDecisionRecord(root, decision)
    await writeLatestJmbDecision(root, decision)

    const jsonl = await readFile(join(root, 'hfmarkets', 'XAUUSD', 'decisions.jsonl'), 'utf8')
    const latest = await readFile(join(root, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'), 'utf8')
    expect(jsonl.trim().split('\n')).toHaveLength(1)
    expect(parseLatestDecisionCsv(latest).decisionId).toBe('decision-1')
  })

  it('summarizes unreadable latest CSV as blocked instead of throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jmb-decisions-'))
    directories.push(root)
    await writeLatestJmbDecision(root, sampleDecision())
    await import('node:fs/promises').then(({ writeFile }) => writeFile(join(root, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'), 'broken,csv\n1'))

    const summary = await summarizeLatestJmbDecision(root, 'hfmarkets', 'XAUUSD')

    expect(summary.state).toBe('error')
    expect(summary.label).toBe('Decision unreadable')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm vitest run src/domain/mt5/decision-record.spec.ts
```

Expected: FAIL with module not found for `./decision-record.js`.

- [ ] **Step 3: Implement decision record persistence**

Create `src/domain/mt5/decision-record.ts` with:

```ts
import { createHash } from 'node:crypto'
import { mkdir, readFile, stat, writeFile, appendFile } from 'node:fs/promises'
import { join } from 'node:path'

export type JmbDecisionMode = 'shadow' | 'demo_blocked' | 'demo_order_requested' | 'demo_filled' | 'demo_closed' | 'skipped'
export type JmbDecisionDirection = 'buy' | 'sell' | 'flat'
export type JmbGateState = 'pass' | 'fail' | 'warn'

export interface JmbGateResult {
  gate: string
  state: JmbGateState
  detail: string
}

export interface JmbDecisionRecord {
  schemaVersion: 1
  decisionId: string
  createdAt: string
  broker: string
  server: string | null
  accountMode: string | null
  symbol: string
  canonicalInstrument: string
  strategyVersion: string
  mode: JmbDecisionMode
  direction: JmbDecisionDirection
  reasonCode: string
  reasonDetail: string
  entryReferencePrice: number | null
  stopLoss: number | null
  takeProfit: number | null
  volume: number
  spread: number | null
  riskAmount: number | null
  maxAllowedRisk: number
  gateResults: JmbGateResult[]
  orderTicket: string | null
  positionId: string | null
  outcome: string | null
}

export interface JmbDecisionSummary {
  state: 'no_decision' | 'shadow' | 'demo_blocked' | 'error'
  label: string
  detail: string
  broker: string
  symbol: string
  lastUpdated: string | null
  decision: JmbDecisionRecord | null
}

const HEADER = [
  'schema_version', 'decision_id', 'created_at', 'broker', 'server', 'account_mode', 'symbol',
  'canonical_instrument', 'strategy_version', 'mode', 'direction', 'reason_code', 'reason_detail',
  'entry_reference_price', 'stop_loss', 'take_profit', 'volume', 'spread', 'risk_amount',
  'max_allowed_risk', 'gate_results_json', 'order_ticket', 'position_id', 'outcome',
]

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += character
    }
  }
  cells.push(current)
  return cells
}

function numberOrNull(value: string): number | null {
  if (value === '') return null
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric decision field: ${value}`)
  return parsed
}

export function createJmbDecisionId(input: Pick<JmbDecisionRecord, 'createdAt' | 'broker' | 'symbol' | 'strategyVersion' | 'mode' | 'direction'>): string {
  return createHash('sha256')
    .update([input.createdAt, input.broker, input.symbol, input.strategyVersion, input.mode, input.direction].join('|'))
    .digest('hex')
    .slice(0, 24)
}

export function serializeLatestDecisionCsv(record: JmbDecisionRecord): string {
  const values = [
    String(record.schemaVersion),
    record.decisionId,
    record.createdAt,
    record.broker,
    record.server ?? '',
    record.accountMode ?? '',
    record.symbol,
    record.canonicalInstrument,
    record.strategyVersion,
    record.mode,
    record.direction,
    record.reasonCode,
    record.reasonDetail,
    record.entryReferencePrice == null ? '' : String(record.entryReferencePrice),
    record.stopLoss == null ? '' : String(record.stopLoss),
    record.takeProfit == null ? '' : String(record.takeProfit),
    String(record.volume),
    record.spread == null ? '' : String(record.spread),
    record.riskAmount == null ? '' : String(record.riskAmount),
    String(record.maxAllowedRisk),
    JSON.stringify(record.gateResults),
    record.orderTicket ?? '',
    record.positionId ?? '',
    record.outcome ?? '',
  ]
  return `${HEADER.join(',')}\n${values.map(csvEscape).join(',')}\n`
}

export function parseLatestDecisionCsv(text: string): JmbDecisionRecord {
  const [headerLine, valueLine] = text.trim().split(/\r?\n/, 2)
  if (!headerLine || !valueLine) throw new Error('Decision CSV is missing header or value row')
  const headers = parseCsvLine(headerLine)
  const values = parseCsvLine(valueLine)
  if (headers.join(',') !== HEADER.join(',') || values.length !== HEADER.length) throw new Error('Decision CSV schema mismatch')
  const row = Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']))
  return {
    schemaVersion: 1,
    decisionId: row['decision_id']!,
    createdAt: row['created_at']!,
    broker: row['broker']!,
    server: row['server'] || null,
    accountMode: row['account_mode'] || null,
    symbol: row['symbol']!,
    canonicalInstrument: row['canonical_instrument']!,
    strategyVersion: row['strategy_version']!,
    mode: row['mode'] as JmbDecisionMode,
    direction: row['direction'] as JmbDecisionDirection,
    reasonCode: row['reason_code']!,
    reasonDetail: row['reason_detail']!,
    entryReferencePrice: numberOrNull(row['entry_reference_price']!),
    stopLoss: numberOrNull(row['stop_loss']!),
    takeProfit: numberOrNull(row['take_profit']!),
    volume: Number(row['volume']),
    spread: numberOrNull(row['spread']!),
    riskAmount: numberOrNull(row['risk_amount']!),
    maxAllowedRisk: Number(row['max_allowed_risk']),
    gateResults: JSON.parse(row['gate_results_json']!) as JmbGateResult[],
    orderTicket: row['order_ticket'] || null,
    positionId: row['position_id'] || null,
    outcome: row['outcome'] || null,
  }
}

function decisionDirectory(root: string, broker: string, symbol: string): string {
  return join(root, broker, symbol)
}

export async function appendJmbDecisionRecord(root: string, record: JmbDecisionRecord): Promise<void> {
  const directory = decisionDirectory(root, record.broker, record.symbol)
  await mkdir(directory, { recursive: true })
  await appendFile(join(directory, 'decisions.jsonl'), `${JSON.stringify(record)}\n`, 'utf8')
}

export async function writeLatestJmbDecision(root: string, record: JmbDecisionRecord): Promise<void> {
  const directory = decisionDirectory(root, record.broker, record.symbol)
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'latest_decision.csv'), serializeLatestDecisionCsv(record), 'utf8')
}

export async function summarizeLatestJmbDecision(root: string, broker: string, symbol: string, now = new Date()): Promise<JmbDecisionSummary> {
  const path = join(root, broker, symbol, 'latest_decision.csv')
  let text: string
  let modified: Date
  try {
    const result = await Promise.all([readFile(path, 'utf8'), stat(path).then((entry) => entry.mtime)])
    text = result[0]
    modified = result[1]
  } catch {
    return { state: 'no_decision', label: 'No JMB decision yet', detail: 'Run the shadow decision runner before enabling any demo risk shell.', broker, symbol, lastUpdated: null, decision: null }
  }
  try {
    const decision = parseLatestDecisionCsv(text)
    const ageMinutes = Math.round((now.getTime() - modified.getTime()) / 60_000)
    const state = decision.mode === 'demo_blocked' ? 'demo_blocked' : decision.mode === 'shadow' || decision.mode === 'skipped' ? 'shadow' : 'error'
    return { state, label: decision.mode === 'demo_blocked' ? 'Demo blocked by gates' : 'Shadow decision logged', detail: `Latest ${decision.mode} decision is ${ageMinutes} minutes old.`, broker, symbol, lastUpdated: modified.toISOString(), decision }
  } catch {
    return { state: 'error', label: 'Decision unreadable', detail: 'The latest decision CSV is malformed. The risk shell must fail closed.', broker, symbol, lastUpdated: modified.toISOString(), decision: null }
  }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm vitest run src/domain/mt5/decision-record.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/domain/mt5/decision-record.ts src/domain/mt5/decision-record.spec.ts
git commit -m "feat: add jmb mt5 decision records"
```

Expected: one commit containing only Task 1 files.

---

### Task 2: Add pure shadow decision engine

**Files:**
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\shadow-decision-engine.ts`
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\shadow-decision-engine.spec.ts`

**Interfaces:**
- Consumes: `JmbDecisionRecord`, `createJmbDecisionId` from `decision-record.ts`.
- Produces:
  - `interface BuildShadowDecisionInput`
  - `function buildShadowDecision(input: BuildShadowDecisionInput): JmbDecisionRecord`

- [ ] **Step 1: Write failing tests**

Create `src/domain/mt5/shadow-decision-engine.spec.ts` with:

```ts
import { describe, expect, it } from 'vitest'
import { buildShadowDecision } from './shadow-decision-engine.js'

const baseInput = {
  createdAt: '2026-07-13T10:00:00.000Z',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  accountMode: 'demo',
  symbol: 'XAUUSD',
  canonicalInstrument: 'Gold / USD',
  strategyVersion: 'daily-trend-v1',
  bridgeState: 'ready',
  learningState: 'learning',
  latestDirection: 'uptrend',
  bid: 2410,
  ask: 2410.36,
  spread: 0.36,
  maxSpread: 0.75,
  volume: 0.01,
  maxVolume: 0.01,
  stopLoss: 2402,
  riskAmount: 0.8,
  maxAllowedRisk: 1,
  demoCandidateApproved: true,
} as const

describe('buildShadowDecision', () => {
  it('logs a Gold buy shadow decision when gates pass', () => {
    const decision = buildShadowDecision(baseInput)

    expect(decision.mode).toBe('shadow')
    expect(decision.direction).toBe('buy')
    expect(decision.reasonCode).toBe('daily_trend_shadow')
    expect(decision.gateResults.every((gate) => gate.state === 'pass')).toBe(true)
  })

  it('keeps EURUSD demo-blocked when its candidate gate is not approved', () => {
    const decision = buildShadowDecision({
      ...baseInput,
      symbol: 'EURUSD',
      canonicalInstrument: 'Euro / USD',
      demoCandidateApproved: false,
    })

    expect(decision.mode).toBe('demo_blocked')
    expect(decision.direction).toBe('buy')
    expect(decision.gateResults.some((gate) => gate.gate === 'candidate_gate' && gate.state === 'fail')).toBe(true)
  })

  it('skips flat when bridge is stale', () => {
    const decision = buildShadowDecision({ ...baseInput, bridgeState: 'stale' })

    expect(decision.mode).toBe('skipped')
    expect(decision.direction).toBe('flat')
    expect(decision.reasonCode).toBe('gate_blocked')
  })

  it('blocks when stop loss is missing', () => {
    const decision = buildShadowDecision({ ...baseInput, stopLoss: null })

    expect(decision.mode).toBe('skipped')
    expect(decision.direction).toBe('flat')
    expect(decision.gateResults.some((gate) => gate.gate === 'stop_loss' && gate.state === 'fail')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```powershell
pnpm vitest run src/domain/mt5/shadow-decision-engine.spec.ts
```

Expected: FAIL with module not found for `./shadow-decision-engine.js`.

- [ ] **Step 3: Implement the pure decision engine**

Create `src/domain/mt5/shadow-decision-engine.ts` with:

```ts
import { createJmbDecisionId, type JmbDecisionDirection, type JmbDecisionRecord, type JmbGateResult } from './decision-record.js'

export interface BuildShadowDecisionInput {
  createdAt: string
  broker: string
  server: string | null
  accountMode: string | null
  symbol: string
  canonicalInstrument: string
  strategyVersion: string
  bridgeState: string
  learningState: string
  latestDirection: 'uptrend' | 'downtrend' | 'flat'
  bid: number | null
  ask: number | null
  spread: number | null
  maxSpread: number
  volume: number
  maxVolume: number
  stopLoss: number | null
  riskAmount: number | null
  maxAllowedRisk: number
  demoCandidateApproved: boolean
}

function gate(gateName: string, state: JmbGateResult['state'], detail: string): JmbGateResult {
  return { gate: gateName, state, detail }
}

function directionFor(latestDirection: BuildShadowDecisionInput['latestDirection']): JmbDecisionDirection {
  if (latestDirection === 'uptrend') return 'buy'
  if (latestDirection === 'downtrend') return 'sell'
  return 'flat'
}

export function buildShadowDecision(input: BuildShadowDecisionInput): JmbDecisionRecord {
  const direction = directionFor(input.latestDirection)
  const gateResults: JmbGateResult[] = [
    gate('account_demo', input.accountMode === 'demo' ? 'pass' : 'fail', input.accountMode === 'demo' ? 'MT5 reports demo mode' : 'Account mode is not confirmed demo'),
    gate('bridge_ready', input.bridgeState === 'ready' ? 'pass' : 'fail', `Bridge state is ${input.bridgeState}`),
    gate('learning_ready', input.learningState === 'learning' ? 'pass' : 'warn', `Learning state is ${input.learningState}`),
    gate('spread', input.spread != null && input.spread <= input.maxSpread ? 'pass' : 'fail', input.spread == null ? 'Spread is unavailable' : `${input.spread} <= ${input.maxSpread}`),
    gate('volume', input.volume > 0 && input.volume <= input.maxVolume ? 'pass' : 'fail', `${input.volume} <= ${input.maxVolume}`),
    gate('stop_loss', input.stopLoss != null ? 'pass' : 'fail', input.stopLoss == null ? 'Stop loss is required' : `Stop loss ${input.stopLoss}`),
    gate('risk_amount', input.riskAmount != null && input.riskAmount <= input.maxAllowedRisk ? 'pass' : 'fail', input.riskAmount == null ? 'Risk amount unavailable' : `${input.riskAmount} <= ${input.maxAllowedRisk}`),
    gate('candidate_gate', input.demoCandidateApproved ? 'pass' : 'fail', input.demoCandidateApproved ? 'Candidate gate approved for shadow review' : 'Broker/symbol is not approved for demo execution'),
    gate('shadow_only', 'pass', 'Plan 2 logs decisions only and submits no orders'),
  ]
  const hardFailure = gateResults.some((item) => item.state === 'fail' && item.gate !== 'candidate_gate')
  const mode = hardFailure ? 'skipped' : input.demoCandidateApproved ? 'shadow' : 'demo_blocked'
  const finalDirection = hardFailure ? 'flat' : direction
  const record: JmbDecisionRecord = {
    schemaVersion: 1,
    decisionId: 'pending',
    createdAt: input.createdAt,
    broker: input.broker,
    server: input.server,
    accountMode: input.accountMode,
    symbol: input.symbol,
    canonicalInstrument: input.canonicalInstrument,
    strategyVersion: input.strategyVersion,
    mode,
    direction: finalDirection,
    reasonCode: hardFailure ? 'gate_blocked' : 'daily_trend_shadow',
    reasonDetail: hardFailure ? 'One or more hard gates failed; no order can be requested.' : `Completed trend state is ${input.latestDirection}; decision logged for learning only.`,
    entryReferencePrice: finalDirection === 'buy' ? input.ask : finalDirection === 'sell' ? input.bid : null,
    stopLoss: input.stopLoss,
    takeProfit: null,
    volume: input.volume,
    spread: input.spread,
    riskAmount: input.riskAmount,
    maxAllowedRisk: input.maxAllowedRisk,
    gateResults,
    orderTicket: null,
    positionId: null,
    outcome: null,
  }
  return { ...record, decisionId: createJmbDecisionId(record) }
}
```

- [ ] **Step 4: Run focused tests**

Run:

```powershell
pnpm vitest run src/domain/mt5/shadow-decision-engine.spec.ts
```

Expected: PASS.

- [ ] **Step 5: Commit Task 2**

Run:

```powershell
git add src/domain/mt5/shadow-decision-engine.ts src/domain/mt5/shadow-decision-engine.spec.ts
git commit -m "feat: add mt5 shadow decision engine"
```

Expected: one commit containing only Task 2 files.

---

### Task 3: Add local shadow decision runner

**Files:**
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\tools\mt5\run_shadow_decisions.ts`
- Test: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\decision-record.spec.ts`
- Test: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\shadow-decision-engine.spec.ts`

**Interfaces:**
- Consumes:
  - `buildShadowDecision(input)`
  - `appendJmbDecisionRecord(root, record)`
  - `writeLatestJmbDecision(root, record)`
  - `readMt5ReadOnlyBridge(root, broker, symbol)`
  - `summarizeMt5TradeLedger(root, broker, symbol)`
- Produces: `OpenAliceMt5DecisionLogV1/<broker>/<symbol>/decisions.jsonl` and `latest_decision.csv`.

- [ ] **Step 1: Create the runner**

Create `tools/mt5/run_shadow_decisions.ts` with:

```ts
import { homedir } from 'node:os'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { buildShadowDecision } from '../../src/domain/mt5/shadow-decision-engine.js'
import { appendJmbDecisionRecord, writeLatestJmbDecision } from '../../src/domain/mt5/decision-record.js'
import { readMt5ReadOnlyBridge } from '../../src/domain/mt5/read-only-bridge.js'
import { summarizeMt5TradeLedger } from '../../src/domain/mt5/trade-ledger.js'

type TrendReport = {
  latest_observation?: { direction: 'uptrend' | 'downtrend' | 'flat' }
}

const appData = process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming')
const commonFiles = join(appData, 'MetaQuotes', 'Terminal', 'Common', 'Files')
const bridgeRoot = process.env['OPENALICE_MT5_BRIDGE_ROOT'] ?? join(commonFiles, 'OpenAliceMt5BridgeV1')
const tradeLedgerRoot = process.env['OPENALICE_MT5_TRADE_LEDGER_ROOT'] ?? join(commonFiles, 'OpenAliceMt5TradeLedgerV1')
const decisionRoot = process.env['OPENALICE_MT5_DECISION_ROOT'] ?? join(commonFiles, 'OpenAliceMt5DecisionLogV1')
const researchRoot = process.env['OPENALICE_RESEARCH_ARTIFACTS_DIR'] ?? join(homedir(), '.openalice', 'data', 'research')

const instruments = [
  { broker: 'hfmarkets', symbol: 'XAUUSD', report: 'xauusd-trend-baseline.json', canonical: 'Gold / USD', demoCandidateApproved: true, maxSpread: 0.75, stopDistance: 8, maxRisk: 1 },
  { broker: 'hfmarkets', symbol: 'EURUSD', report: 'eurusd-trend-baseline.json', canonical: 'Euro / USD', demoCandidateApproved: false, maxSpread: 0.00025, stopDistance: 0.0020, maxRisk: 1 },
  { broker: 'icmarkets', symbol: 'XAUUSD', report: 'icmarkets-xauusd-trend-baseline.json', canonical: 'Gold / USD', demoCandidateApproved: true, maxSpread: 0.30, stopDistance: 8, maxRisk: 1 },
  { broker: 'icmarkets', symbol: 'EURUSD', report: 'icmarkets-eurusd-trend-baseline.json', canonical: 'Euro / USD', demoCandidateApproved: false, maxSpread: 0.00015, stopDistance: 0.0020, maxRisk: 1 },
] as const

async function readTrendDirection(fileName: string): Promise<'uptrend' | 'downtrend' | 'flat'> {
  try {
    const report = JSON.parse(await readFile(join(researchRoot, fileName), 'utf8')) as TrendReport
    return report.latest_observation?.direction ?? 'flat'
  } catch {
    return 'flat'
  }
}

for (const instrument of instruments) {
  const [bridge, learning, latestDirection] = await Promise.all([
    readMt5ReadOnlyBridge(bridgeRoot, instrument.broker, instrument.symbol),
    summarizeMt5TradeLedger(tradeLedgerRoot, instrument.broker, instrument.symbol),
    readTrendDirection(instrument.report),
  ])
  const referencePrice = latestDirection === 'downtrend' ? bridge.bid : bridge.ask
  const stopLoss = referencePrice == null
    ? null
    : latestDirection === 'downtrend'
      ? Number((referencePrice + instrument.stopDistance).toFixed(instrument.symbol === 'XAUUSD' ? 2 : 5))
      : latestDirection === 'uptrend'
        ? Number((referencePrice - instrument.stopDistance).toFixed(instrument.symbol === 'XAUUSD' ? 2 : 5))
        : null
  const decision = buildShadowDecision({
    createdAt: new Date().toISOString(),
    broker: instrument.broker,
    server: bridge.server,
    accountMode: bridge.state === 'ready' ? 'demo' : null,
    symbol: instrument.symbol,
    canonicalInstrument: instrument.canonical,
    strategyVersion: 'daily-trend-v1',
    bridgeState: bridge.state,
    learningState: learning.state,
    latestDirection,
    bid: bridge.bid,
    ask: bridge.ask,
    spread: bridge.spread,
    maxSpread: instrument.maxSpread,
    volume: 0.01,
    maxVolume: 0.01,
    stopLoss,
    riskAmount: instrument.maxRisk,
    maxAllowedRisk: instrument.maxRisk,
    demoCandidateApproved: instrument.demoCandidateApproved,
  })
  await appendJmbDecisionRecord(decisionRoot, decision)
  await writeLatestJmbDecision(decisionRoot, decision)
  console.log(`${decision.broker} ${decision.symbol}: ${decision.mode} ${decision.direction} ${decision.reasonCode}`)
}
```

- [ ] **Step 2: Run domain tests before runner smoke**

Run:

```powershell
pnpm vitest run src/domain/mt5/decision-record.spec.ts src/domain/mt5/shadow-decision-engine.spec.ts
```

Expected: PASS.

- [ ] **Step 3: Run runner smoke**

Run:

```powershell
pnpm exec tsx tools/mt5/run_shadow_decisions.ts
```

Expected: four console lines, one for each broker/symbol. It may produce `skipped flat gate_blocked` if bridge/trend data is missing; that is acceptable because it is fail-closed.

- [ ] **Step 4: Verify files were produced**

Run:

```powershell
$root = Join-Path $env:APPDATA 'MetaQuotes\Terminal\Common\Files\OpenAliceMt5DecisionLogV1'
Get-ChildItem -Path $root -Recurse -Filter latest_decision.csv | Select-Object FullName,Length,LastWriteTime
```

Expected: four `latest_decision.csv` files under HFM/IC Gold/EURUSD folders.

- [ ] **Step 5: Commit Task 3**

Run:

```powershell
git add tools/mt5/run_shadow_decisions.ts
git commit -m "feat: add mt5 shadow decision runner"
```

Expected: one commit containing only Task 3 runner.

---

### Task 4: Add Research API and UI decision status

**Files:**
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\webui\routes\research.ts`
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\ui\src\api\research.ts`
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\ui\src\pages\ResearchDashboardPage.tsx`

**Interfaces:**
- Consumes: `summarizeLatestJmbDecision(root, broker, symbol)`.
- Produces: Research API includes `decision`; Research Dashboard displays latest JMB mode as evidence only.

- [ ] **Step 1: Add Research API decision root and summaries**

In `src/webui/routes/research.ts`, add:

```ts
import { summarizeLatestJmbDecision } from '../../domain/mt5/decision-record.js'
```

Add this constant near the bridge/trade-ledger roots:

```ts
const MT5_DECISION_ROOT = process.env['OPENALICE_MT5_DECISION_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5DecisionLogV1',
)
```

In the per-instrument `Promise.all`, add:

```ts
summarizeLatestJmbDecision(MT5_DECISION_ROOT, instrument.broker, bridgeSymbol),
```

Return it as:

```ts
decision,
```

Add summary count:

```ts
const shadowDecisions = instruments.filter((instrument) => instrument.decision.state === 'shadow' || instrument.decision.state === 'demo_blocked').length
```

Add to summary:

```ts
decisionRoot: MT5_DECISION_ROOT,
shadowDecisions,
```

Add a stage before demo:

```ts
{ key: 'shadow', label: 'JMB shadow decisions', state: shadowDecisions === INSTRUMENTS.length ? 'complete' : shadowDecisions > 0 ? 'next' : 'waiting', detail: shadowDecisions > 0 ? `${shadowDecisions}/${INSTRUMENTS.length} broker-symbol pairs have logged JMB decisions.` : 'Run the shadow decision runner before enabling the demo risk shell.' },
```

- [ ] **Step 2: Add UI API types**

In `ui/src/api/research.ts`, add:

```ts
export type JmbDecisionState = 'no_decision' | 'shadow' | 'demo_blocked' | 'error'

export interface JmbDecisionSummary {
  state: JmbDecisionState
  label: string
  detail: string
  broker: string
  symbol: string
  lastUpdated: string | null
  decision: null | {
    decisionId: string
    createdAt: string
    strategyVersion: string
    mode: string
    direction: string
    reasonCode: string
    reasonDetail: string
    spread: number | null
    volume: number
    stopLoss: number | null
    gateResults: Array<{ gate: string; state: string; detail: string }>
  }
}
```

Add `decision: JmbDecisionSummary` to the research instrument type and add `decisionRoot: string` plus `shadowDecisions: number` to the summary type.

- [ ] **Step 3: Display decision status in Research Dashboard**

In `ui/src/pages/ResearchDashboardPage.tsx`, add this helper:

```ts
function decisionTone(state: string) {
  if (state === 'shadow') return 'green'
  if (state === 'demo_blocked') return 'amber'
  if (state === 'error') return 'red'
  return 'muted'
}
```

In each instrument card near the learning block, render:

```tsx
<div className={`metric ${decisionTone(instrument.decision.state)}`}>
  <span>JMB decision learning</span>
  <strong>{instrument.decision.label}</strong>
  <small>{instrument.decision.detail}</small>
  {instrument.decision.decision ? (
    <small>
      {instrument.decision.decision.mode} • {instrument.decision.decision.direction} • {instrument.decision.decision.reasonCode}
    </small>
  ) : null}
</div>
```

Add safety copy near the dashboard disclaimer:

```tsx
<p className="research-disclaimer">
  Shadow decisions are JMB learning records only. They are not live-trading approval and they do not submit orders.
</p>
```

- [ ] **Step 4: Run UI/domain verification**

Run:

```powershell
pnpm vitest run src/domain/mt5 ui/src
pnpm -F open-alice-ui build
```

Expected: tests and UI build pass. Existing Vite chunk-size warnings are acceptable.

- [ ] **Step 5: Commit Task 4**

Run:

```powershell
git add src/webui/routes/research.ts ui/src/api/research.ts ui/src/pages/ResearchDashboardPage.tsx
git commit -m "feat: show jmb shadow decisions in research"
```

Expected: one commit containing only Task 4 files.

---

### Task 5: Add MT5 demo risk shell EA with no order submission

**Files:**
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\tools\mt5\JmbGoldmineDemoRiskShell.mq5`
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\tools\mt5\README.md`

**Interfaces:**
- Consumes: `Common Files/OpenAliceMt5DecisionLogV1/<broker>/<symbol>/latest_decision.csv`.
- Produces: `Common Files/OpenAliceMt5RiskShellV1/<broker>/<symbol>/gate_status.csv`.
- Must not contain order submission APIs.

- [ ] **Step 1: Create the risk shell EA**

Create `tools/mt5/JmbGoldmineDemoRiskShell.mq5` with:

```mql5
#property strict

input string InpBrokerId = "hfmarkets";
input string InpSymbol = "XAUUSD";
input double InpMaxLot = 0.01;
input double InpMaxSpread = 0.75;
input int InpDecisionMaxAgeSeconds = 300;
input bool InpKillSwitch = true;

string AccountModeLabel()
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
   return "contest";
}

string NowIso()
{
   string value = TimeToString(TimeCurrent(), TIME_DATE | TIME_SECONDS);
   StringReplace(value, ".", "-");
   StringReplace(value, " ", "T");
   return value + ".000Z";
}

void EnsureFolders(string root, string broker, string symbol)
{
   FolderCreate(root, FILE_COMMON);
   FolderCreate(root + "\\" + broker, FILE_COMMON);
   FolderCreate(root + "\\" + broker + "\\" + symbol, FILE_COMMON);
}

string ReadLatestDecision()
{
   string path = "OpenAliceMt5DecisionLogV1\\" + InpBrokerId + "\\" + InpSymbol + "\\latest_decision.csv";
   int handle = FileOpen(path, FILE_READ | FILE_TXT | FILE_COMMON | FILE_ANSI);
   if(handle == INVALID_HANDLE) return "";
   string text = "";
   while(!FileIsEnding(handle))
      text += FileReadString(handle) + "\n";
   FileClose(handle);
   return text;
}

void WriteGateStatus(string state, string detail)
{
   string root = "OpenAliceMt5RiskShellV1";
   EnsureFolders(root, InpBrokerId, InpSymbol);
   string path = root + "\\" + InpBrokerId + "\\" + InpSymbol + "\\gate_status.csv";
   int handle = FileOpen(path, FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("Unable to write risk shell status: ", GetLastError());
      return;
   }
   FileWrite(handle, "captured_at", "broker", "symbol", "account_mode", "state", "detail", "bid", "ask", "spread", "positions");
   double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
   double spread = ask - bid;
   FileWrite(handle, NowIso(), InpBrokerId, InpSymbol, AccountModeLabel(), state, detail, DoubleToString(bid, _Digits), DoubleToString(ask, _Digits), DoubleToString(spread, _Digits), IntegerToString(PositionsTotal()));
   FileClose(handle);
}

void Evaluate()
{
   if(InpKillSwitch)
   {
      WriteGateStatus("paused", "Kill switch is on; new entries blocked.");
      return;
   }
   if(AccountModeLabel() != "demo")
   {
      WriteGateStatus("blocked", "Account is not demo.");
      return;
   }
   if(_Symbol != InpSymbol)
   {
      WriteGateStatus("blocked", "EA chart symbol does not match configured symbol.");
      return;
   }
   string decision = ReadLatestDecision();
   if(decision == "")
   {
      WriteGateStatus("blocked", "No latest JMB decision file found.");
      return;
   }
   double bid = SymbolInfoDouble(InpSymbol, SYMBOL_BID);
   double ask = SymbolInfoDouble(InpSymbol, SYMBOL_ASK);
   double spread = ask - bid;
   if(spread > InpMaxSpread)
   {
      WriteGateStatus("blocked", "Spread exceeds configured maximum.");
      return;
   }
   WriteGateStatus("shadow_ready", "Decision file exists and local shell gates passed. No orders are submitted in this version.");
}

int OnInit()
{
   EventSetTimer(10);
   Evaluate();
   return INIT_SUCCEEDED;
}

void OnDeinit(const int reason)
{
   EventKillTimer();
}

void OnTimer()
{
   Evaluate();
}

void OnTick()
{
   Evaluate();
}
```

- [ ] **Step 2: Document shell setup**

Append to `tools/mt5/README.md`:

```md
## Demo risk shell, no order submission

`JmbGoldmineDemoRiskShell.mq5` is an EA that reads the latest JMB shadow decision and writes gate status to:

`OpenAliceMt5RiskShellV1/<broker>/<symbol>/gate_status.csv`

This shell does not submit, modify, or close orders. It is for validating demo account, symbol, spread, kill-switch, and decision-file readiness before any future demo execution plan.

Recommended first run:

- Keep `InpKillSwitch=true`.
- Attach to HFM demo `XAUUSD` and `EURUSD`.
- Attach to IC Markets demo `XAUUSD` and `EURUSD`.
- Use `InpBrokerId=hfmarkets` or `icmarkets`.
- Use the exact chart symbol in `InpSymbol`.

Only after the gate status is stable should a separate plan add demo order submission.
```

- [ ] **Step 3: Verify no order APIs exist**

Run:

```powershell
Select-String -Path tools/mt5/JmbGoldmineDemoRiskShell.mq5 -Pattern 'OrderSend|PositionClose|CTrade|trade.Buy|trade.Sell|OrderModify'
```

Expected: no matches.

- [ ] **Step 4: Commit Task 5**

Run:

```powershell
git add tools/mt5/JmbGoldmineDemoRiskShell.mq5 tools/mt5/README.md
git commit -m "feat: add mt5 demo risk shell"
```

Expected: one commit containing only Task 5 files.

---

### Task 6: Final verification

**Files:**
- Modify only files from Tasks 1-5 if verification reveals a direct defect.

**Interfaces:**
- Consumes all previous task outputs.
- Produces a verified shadow-risk shell with no order execution.

- [ ] **Step 1: Run MT5 domain tests**

Run:

```powershell
pnpm vitest run src/domain/mt5
```

Expected: PASS.

- [ ] **Step 2: Run UI tests and build**

Run:

```powershell
pnpm vitest run ui/src
pnpm -F open-alice-ui build
```

Expected: PASS. Existing Vite warnings about chunk size or missing local connector config are acceptable if exit code is `0`.

- [ ] **Step 3: Run shadow runner smoke**

Run:

```powershell
pnpm exec tsx tools/mt5/run_shadow_decisions.ts
```

Expected: four lines for HFM/IC Gold/EURUSD. `skipped` or `demo_blocked` is acceptable; thrown exceptions are not.

- [ ] **Step 4: Scan for order execution APIs in this plan's files**

Run:

```powershell
rg "OrderSend|PositionClose|CTrade|trade\\.Buy|trade\\.Sell|OrderModify" src/domain/mt5 tools/mt5/JmbGoldmineDemoRiskShell.mq5 tools/mt5/run_shadow_decisions.ts src/webui/routes/research.ts ui/src/api/research.ts ui/src/pages/ResearchDashboardPage.tsx
```

Expected: no matches.

- [ ] **Step 5: Record handoff**

Final handoff must say:

```text
Shadow risk shell is complete: JMB can log its own Gold/EURUSD shadow decisions for HFM and IC Markets, show them in Research, and let MT5 validate gates without submitting orders. Demo order execution remains locked for Plan 3.
```

