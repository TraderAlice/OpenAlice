# JMB Goldmine Learning Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first safe learning foundation for JMB Goldmine Demo/Paper Autopilot V1: account-scoped MT5 trade-history ingestion, origin labelling, per-broker/symbol learning states, and Research Desk visibility for HFM and IC Markets demo Gold/EURUSD.

**Architecture:** This plan does not enable order execution. It adds a typed TypeScript domain layer that reads an append-only MT5 trade ledger exported under MetaTrader Common Files, summarizes learning state per configured broker/symbol, and exposes the status through the existing Research Desk API/UI. MQL5 export support is specified as a separate read-only exporter file that writes CSV rows; the app parser is testable without a terminal.

**Tech Stack:** TypeScript, Vitest, Hono routes, React Research Dashboard, MQL5 CSV exporter, local files under MetaTrader Common Files and `~/.openalice/data/research`.

## Global Constraints

- V1 is demo/paper only.
- No live account trading.
- No LLM or workspace agent may submit an order, click buy/sell, change live settings, or sit in the tick-by-tick execution path.
- The MT5 EA is the only component allowed to place demo orders, and order execution is outside this plan.
- AI agents may research, score, review, journal, recommend, or veto.
- Risk rules are fixed configuration, not self-modified by AI.
- A persistent kill switch must block new entries in execution plans.
- If broker/account mode cannot be proven to be demo, the system must refuse progression toward demo automation.
- Gold/XAUUSD and EURUSD are included for HFM demo and IC Markets demo.
- EURUSD learns immediately but cannot become demo-trade eligible until its own candidate gate passes.
- Do not change unrelated dirty working-tree files.

---

## Scope split

The approved design spans several independent subsystems: trade-history import, broker cost modelling, daily learning jobs, Research Desk status, shadow signals, demo EA risk gates, and demo execution. This plan implements the first independently testable slice only:

1. Read and validate MT5 trade-history CSV exports.
2. Summarize learning state for HFM/IC Gold and EURUSD.
3. Add Research Desk API/UI evidence that the system is learning or blocked.
4. Add a read-only MQL5 trade-history exporter source file for the user to compile/attach.

Broker-cost modelling, scheduler automation, EA risk shell, and demo order execution must be covered by follow-up plans after this foundation is passing.

## File structure

- Create `src/domain/mt5/trade-ledger.ts`
  - Parses and summarizes MT5 order/deal CSV files.
  - Has no UI, no Hono dependency, and no order execution behavior.
- Create `src/domain/mt5/trade-ledger.spec.ts`
  - Covers parser, origin labelling, account-mode blocking, symbol filtering, and learning-state summaries.
- Modify `src/webui/routes/research.ts`
  - Adds trade ledger root config, ledger summary read, and per-instrument learning state in the JSON response.
- Modify `ui/src/api/research.ts`
  - Adds typed fields returned by the research route.
- Modify `ui/src/pages/ResearchDashboardPage.tsx`
  - Displays learning state and trade-history summary without showing it as trading approval.
- Create `tools/mt5/ExportMt5TradeLedger.mq5`
  - Read-only MQL5 script/EA source that exports MT5 history to CSV in account-scoped folders.
- Modify `tools/mt5/README.md`
  - Documents how to compile and run the exporter, and repeats the demo-only/no-execution boundary.

---

### Task 1: Add MT5 trade-ledger parser and learning summary

**Files:**
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\trade-ledger.ts`
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\trade-ledger.spec.ts`

**Interfaces:**
- Consumes: CSV files under a root shaped like `<root>/<broker>/<symbol>/deals.csv`.
- Produces:
  - `parseMt5TradeLedgerCsv(text: string): Mt5TradeLedgerRow[]`
  - `deriveMt5TradeOrigin(row: Pick<Mt5TradeLedgerRow, 'magic' | 'reason' | 'comment'>): Mt5TradeOrigin`
  - `summarizeMt5TradeLedger(root: string, broker: string, symbol: string, now?: Date): Promise<Mt5TradeLedgerSummary>`

- [ ] **Step 1: Write the failing parser and summary tests**

Create `src/domain/mt5/trade-ledger.spec.ts` with:

```ts
import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deriveMt5TradeOrigin, parseMt5TradeLedgerCsv, summarizeMt5TradeLedger } from './trade-ledger.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('parseMt5TradeLedgerCsv', () => {
  it('parses deal rows and keeps tickets as strings', () => {
    const rows = parseMt5TradeLedgerCsv([
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,987654321012345,123456789012345,555,2026-07-13T01:02:03.000Z,out,buy,client,0.01,2410.25,-0.07,0,-0.01,4.25,0,manual close',
    ].join('\n'))

    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      accountMode: 'demo',
      broker: 'hfmarkets',
      symbol: 'XAUUSD',
      dealTicket: '987654321012345',
      orderTicket: '123456789012345',
      positionId: '555',
      volume: 0.01,
      profit: 4.25,
    })
  })

  it('rejects malformed rows with a clear error', () => {
    expect(() => parseMt5TradeLedgerCsv('account_mode,server\nonly-one-column')).toThrow('Malformed MT5 trade ledger row 2')
  })
})

describe('deriveMt5TradeOrigin', () => {
  it('labels client zero-magic trades as manual', () => {
    expect(deriveMt5TradeOrigin({ magic: 0, reason: 'client', comment: 'closed from terminal' })).toBe('manual')
  })

  it('labels non-zero magic trades as ea', () => {
    expect(deriveMt5TradeOrigin({ magic: 880001, reason: 'expert', comment: 'JMB Goldmine' })).toBe('ea')
  })

  it('labels balance operations and unknown reasons separately', () => {
    expect(deriveMt5TradeOrigin({ magic: 0, reason: 'balance', comment: 'deposit' })).toBe('other')
    expect(deriveMt5TradeOrigin({ magic: 0, reason: '', comment: '' })).toBe('unknown')
  })
})

describe('summarizeMt5TradeLedger', () => {
  it('summarizes fresh demo trade history for a broker symbol', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,1,11,101,2026-07-13T01:00:00.000Z,out,buy,client,0.01,2410.25,-0.07,0,-0.01,4.25,0,manual close',
      'demo,HFM-Demo,123456,hfmarkets,XAUUSD,2,12,102,2026-07-13T02:00:00.000Z,out,sell,expert,0.01,2408.25,-0.07,0,-0.01,-1.25,880001,JMB Goldmine demo',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'hfmarkets', 'XAUUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('learning')
    expect(summary.totalDeals).toBe(2)
    expect(summary.manualDeals).toBe(1)
    expect(summary.eaDeals).toBe(1)
    expect(summary.netProfit).toBeCloseTo(2.84)
    expect(summary.accountMode).toBe('demo')
  })

  it('blocks non-demo trade history from progression', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-ledger-'))
    directories.push(root)
    const directory = join(root, 'icmarkets', 'EURUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'deals.csv'), [
      'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
      'real,IC-Live,123456,icmarkets,EURUSD,1,11,101,2026-07-13T01:00:00.000Z,out,buy,client,0.01,1.17000,-0.07,0,0,1.25,0,manual close',
    ].join('\n'))

    const summary = await summarizeMt5TradeLedger(root, 'icmarkets', 'EURUSD', new Date('2026-07-13T02:01:00.000Z'))

    expect(summary.state).toBe('blocked')
    expect(summary.detail).toContain('non-demo')
  })
})
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run:

```powershell
pnpm vitest run src/domain/mt5/trade-ledger.spec.ts
```

Expected: FAIL because `src/domain/mt5/trade-ledger.ts` does not exist.

- [ ] **Step 3: Add the minimal parser and summary implementation**

Create `src/domain/mt5/trade-ledger.ts` with:

```ts
import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type Mt5TradeOrigin = 'manual' | 'ea' | 'other' | 'unknown'
export type Mt5TradeLedgerState = 'no_data' | 'learning' | 'blocked' | 'stale'

export interface Mt5TradeLedgerRow {
  accountMode: string
  server: string
  login: string
  broker: string
  symbol: string
  dealTicket: string
  orderTicket: string
  positionId: string
  time: string
  entry: string
  type: string
  reason: string
  volume: number
  price: number
  commission: number
  fee: number
  swap: number
  profit: number
  magic: number
  comment: string
  origin: Mt5TradeOrigin
}

export interface Mt5TradeLedgerSummary {
  state: Mt5TradeLedgerState
  label: string
  detail: string
  broker: string
  symbol: string
  accountMode: string | null
  server: string | null
  lastDealTime: string | null
  lastUpdated: string | null
  totalDeals: number
  manualDeals: number
  eaDeals: number
  otherDeals: number
  unknownDeals: number
  netProfit: number
}

const STALE_AFTER_MS = 24 * 60 * 60_000

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

function numberField(row: Record<string, string>, key: string, lineNumber: number): number {
  const value = row[key] ?? ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric MT5 trade ledger field "${key}" on row ${lineNumber}`)
  return parsed
}

export function deriveMt5TradeOrigin(row: Pick<Mt5TradeLedgerRow, 'magic' | 'reason' | 'comment'>): Mt5TradeOrigin {
  const reason = row.reason.toLowerCase()
  const comment = row.comment.toLowerCase()
  if (row.magic !== 0 || reason === 'expert' || comment.includes('jmb goldmine')) return 'ea'
  if (reason === 'client' || reason === 'mobile' || reason === 'web') return 'manual'
  if (reason === 'balance' || reason === 'correction' || reason === 'charge') return 'other'
  return 'unknown'
}

export function parseMt5TradeLedgerCsv(text: string): Mt5TradeLedgerRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return []
  const headers = parseCsvLine(lines[0]!).map((header) => header.trim())
  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2
    const values = parseCsvLine(line)
    if (values.length !== headers.length) throw new Error(`Malformed MT5 trade ledger row ${lineNumber}`)
    const raw = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex]!.trim()]))
    const base = {
      accountMode: raw['account_mode'] ?? '',
      server: raw['server'] ?? '',
      login: raw['login'] ?? '',
      broker: raw['broker'] ?? '',
      symbol: raw['symbol'] ?? '',
      dealTicket: raw['deal_ticket'] ?? '',
      orderTicket: raw['order_ticket'] ?? '',
      positionId: raw['position_id'] ?? '',
      time: raw['time'] ?? '',
      entry: raw['entry'] ?? '',
      type: raw['type'] ?? '',
      reason: raw['reason'] ?? '',
      volume: numberField(raw, 'volume', lineNumber),
      price: numberField(raw, 'price', lineNumber),
      commission: numberField(raw, 'commission', lineNumber),
      fee: numberField(raw, 'fee', lineNumber),
      swap: numberField(raw, 'swap', lineNumber),
      profit: numberField(raw, 'profit', lineNumber),
      magic: numberField(raw, 'magic', lineNumber),
      comment: raw['comment'] ?? '',
    }
    return { ...base, origin: deriveMt5TradeOrigin(base) }
  })
}

export async function summarizeMt5TradeLedger(
  root: string,
  broker: string,
  symbol: string,
  now = new Date(),
): Promise<Mt5TradeLedgerSummary> {
  const path = join(root, broker, symbol, 'deals.csv')
  let text: string
  let modified: Date
  try {
    const result = await Promise.all([readFile(path, 'utf8'), stat(path).then((entry) => entry.mtime)])
    text = result[0]
    modified = result[1]
  } catch {
    return {
      state: 'no_data',
      label: 'Awaiting trade history',
      detail: 'Run the read-only MT5 trade ledger exporter for this demo account and symbol.',
      broker,
      symbol,
      accountMode: null,
      server: null,
      lastDealTime: null,
      lastUpdated: null,
      totalDeals: 0,
      manualDeals: 0,
      eaDeals: 0,
      otherDeals: 0,
      unknownDeals: 0,
      netProfit: 0,
    }
  }

  const rows = parseMt5TradeLedgerCsv(text).filter((row) => row.broker === broker && row.symbol === symbol)
  const first = rows[0]
  const lastDealTime = rows.map((row) => row.time).sort().at(-1) ?? null
  const totalMoney = rows.reduce((total, row) => total + row.profit + row.commission + row.fee + row.swap, 0)
  const base = {
    broker,
    symbol,
    accountMode: first?.accountMode ?? null,
    server: first?.server ?? null,
    lastDealTime,
    lastUpdated: modified.toISOString(),
    totalDeals: rows.length,
    manualDeals: rows.filter((row) => row.origin === 'manual').length,
    eaDeals: rows.filter((row) => row.origin === 'ea').length,
    otherDeals: rows.filter((row) => row.origin === 'other').length,
    unknownDeals: rows.filter((row) => row.origin === 'unknown').length,
    netProfit: Number(totalMoney.toFixed(2)),
  }
  if (first && first.accountMode !== 'demo') {
    return { ...base, state: 'blocked', label: 'Trade history blocked', detail: 'The ledger contains non-demo account history, so it cannot unlock demo automation.' }
  }
  if (now.getTime() - modified.getTime() > STALE_AFTER_MS) {
    return { ...base, state: 'stale', label: 'Trade history stale', detail: 'The trade ledger has not been refreshed in the last 24 hours.' }
  }
  return { ...base, state: 'learning', label: 'Learning from demo history', detail: 'Manual and EA demo trades are available for review and journaling.' }
}
```

- [ ] **Step 4: Run the focused test and verify it passes**

Run:

```powershell
pnpm vitest run src/domain/mt5/trade-ledger.spec.ts
```

Expected: PASS for all tests in `trade-ledger.spec.ts`.

- [ ] **Step 5: Commit Task 1**

Run:

```powershell
git add src/domain/mt5/trade-ledger.ts src/domain/mt5/trade-ledger.spec.ts
git commit -m "feat: add mt5 trade ledger summary"
```

Expected: one commit containing only the parser and tests.

---

### Task 2: Add trade-ledger learning state to the Research API

**Files:**
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\webui\routes\research.ts`
- Test: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\src\domain\mt5\trade-ledger.spec.ts`

**Interfaces:**
- Consumes: `summarizeMt5TradeLedger(root, broker, symbol, now?)`.
- Produces: Each research instrument JSON object includes `learning`.

- [ ] **Step 1: Add the import and trade ledger root constant**

Modify the imports in `src/webui/routes/research.ts`:

```ts
import { readMt5ReadOnlyBridge } from '../../domain/mt5/read-only-bridge.js'
import { summarizeMt5TradeLedger } from '../../domain/mt5/trade-ledger.js'
```

Add this constant after `MT5_BRIDGE_ROOT`:

```ts
const MT5_TRADE_LEDGER_ROOT = process.env['OPENALICE_MT5_TRADE_LEDGER_ROOT'] ?? join(
  process.env['APPDATA'] ?? join(homedir(), 'AppData', 'Roaming'),
  'MetaQuotes', 'Terminal', 'Common', 'Files', 'OpenAliceMt5TradeLedgerV1',
)
```

- [ ] **Step 2: Add ledger summary to each instrument**

Replace the per-instrument Promise block:

```ts
const [exportData, report, walkForward, bridge] = await Promise.all([
  inspectExport(instrument.broker, instrument.symbol),
  readReport<TrendReport>(instrument.artifact),
  readReport<WalkForwardReport>(instrument.walkForwardArtifact),
  readMt5ReadOnlyBridge(MT5_BRIDGE_ROOT, instrument.broker, instrument.bridgeSymbol ?? instrument.symbol),
])
```

with:

```ts
const bridgeSymbol = instrument.bridgeSymbol ?? instrument.symbol
const [exportData, report, walkForward, bridge, learning] = await Promise.all([
  inspectExport(instrument.broker, instrument.symbol),
  readReport<TrendReport>(instrument.artifact),
  readReport<WalkForwardReport>(instrument.walkForwardArtifact),
  readMt5ReadOnlyBridge(MT5_BRIDGE_ROOT, instrument.broker, bridgeSymbol),
  summarizeMt5TradeLedger(MT5_TRADE_LEDGER_ROOT, instrument.broker, bridgeSymbol),
])
```

Then add `learning` to the returned instrument object:

```ts
return {
  ...instrument,
  export: exportData,
  report,
  walkForward,
  bridge,
  learning,
  quality: qualityFor(validationReport, instrument.broker, instrument.symbol, exportData.available),
  evidence: evidenceFor(report),
}
```

- [ ] **Step 3: Add summary counts**

Add this line next to `readyDemoBridges`:

```ts
const learningInstruments = instruments.filter((instrument) => instrument.learning.state === 'learning').length
```

Add `tradeLedgerRoot` and `learningInstruments` to `summary`:

```ts
summary: {
  exportRoot: MT5_EXPORT_ROOT,
  tradeLedgerRoot: MT5_TRADE_LEDGER_ROOT,
  instrumentsWithData: instruments.filter((instrument) => instrument.export.available).length,
  completedBaselines,
  completedWalkForwards,
  readyDemoBridges,
  learningInstruments,
  validatedInstruments,
  hfmReady,
  experimentRuns: experimentLedger?.runs.length ?? 0,
},
```

- [ ] **Step 4: Add learning stage**

Add this stage between `bridge` and `demo`:

```ts
{ key: 'learning', label: 'Trade-history learning', state: learningInstruments === INSTRUMENTS.length ? 'complete' : learningInstruments > 0 ? 'next' : 'waiting', detail: learningInstruments > 0 ? `${learningInstruments}/${INSTRUMENTS.length} broker-symbol ledgers are fresh and demo-only.` : 'Run the MT5 trade ledger exporter so manual and demo trades can be reviewed.' },
```

- [ ] **Step 5: Run route-adjacent tests**

Run:

```powershell
pnpm vitest run src/domain/mt5/read-only-bridge.spec.ts src/domain/mt5/trade-ledger.spec.ts
```

Expected: PASS.

- [ ] **Step 6: Commit Task 2**

Run:

```powershell
git add src/webui/routes/research.ts
git commit -m "feat: expose mt5 learning state in research api"
```

Expected: one commit modifying the research route only.

---

### Task 3: Display learning status in the Research Dashboard UI

**Files:**
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\ui\src\api\research.ts`
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\ui\src\pages\ResearchDashboardPage.tsx`

**Interfaces:**
- Consumes: `learning` object returned per instrument by `/api/research`.
- Produces: UI copy that says learning history is evidence, not trading approval.

- [ ] **Step 1: Extend the Research API types**

In `ui/src/api/research.ts`, add:

```ts
export type Mt5LearningState = 'no_data' | 'learning' | 'blocked' | 'stale'

export interface Mt5TradeLedgerSummary {
  state: Mt5LearningState
  label: string
  detail: string
  broker: string
  symbol: string
  accountMode: string | null
  server: string | null
  lastDealTime: string | null
  lastUpdated: string | null
  totalDeals: number
  manualDeals: number
  eaDeals: number
  otherDeals: number
  unknownDeals: number
  netProfit: number
}
```

Find the instrument response interface and add:

```ts
learning: Mt5TradeLedgerSummary
```

Find the summary interface and add:

```ts
tradeLedgerRoot: string
learningInstruments: number
```

- [ ] **Step 2: Add UI tone helper**

In `ui/src/pages/ResearchDashboardPage.tsx`, add this helper near the existing tone helpers:

```ts
function learningTone(state: string) {
  if (state === 'learning') return 'green'
  if (state === 'blocked') return 'red'
  if (state === 'stale') return 'amber'
  return 'muted'
}
```

- [ ] **Step 3: Render learning state per instrument**

In each instrument card, add a learning block near bridge status:

```tsx
<div className={`metric ${learningTone(instrument.learning.state)}`}>
  <span>Trade-history learning</span>
  <strong>{instrument.learning.label}</strong>
  <small>{instrument.learning.detail}</small>
  <small>
    Deals: {instrument.learning.totalDeals} · Manual: {instrument.learning.manualDeals} · EA: {instrument.learning.eaDeals} · Net: {instrument.learning.netProfit.toFixed(2)}
  </small>
</div>
```

If the page uses a different metric class pattern, keep the same markup content and use the existing card/metric wrapper.

- [ ] **Step 4: Add the safety copy**

Add this copy near the Research Dashboard disclaimer:

```tsx
<p className="research-disclaimer">
  Trade-history learning imports manual and demo outcomes for review. It is not approval for live trading and it cannot submit orders.
</p>
```

- [ ] **Step 5: Run TypeScript/UI checks**

Run:

```powershell
pnpm vitest run ui/src
```

Expected: PASS, or if the repo has no UI-specific tests, Vitest should report no matching test files without TypeScript compile errors. If the command fails because the project does not define UI tests, run:

```powershell
pnpm test -- --runInBand
```

Expected: existing unrelated failures are documented; new TypeScript errors from this task are fixed before commit.

- [ ] **Step 6: Commit Task 3**

Run:

```powershell
git add ui/src/api/research.ts ui/src/pages/ResearchDashboardPage.tsx
git commit -m "feat: show mt5 learning status in research dashboard"
```

Expected: one commit containing only UI/API type changes.

---

### Task 4: Add read-only MQL5 trade ledger exporter source

**Files:**
- Create: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\tools\mt5\ExportMt5TradeLedger.mq5`
- Modify: `C:\Users\mwbri\Documents\Open Alice Trading bot\OpenAlice\tools\mt5\README.md`

**Interfaces:**
- Consumes: MT5 account history through `HistorySelect`, `HistoryDealsTotal`, and `HistoryDealGet*`.
- Produces: `Common Files/OpenAliceMt5TradeLedgerV1/<broker>/<symbol>/deals.csv`.

- [ ] **Step 1: Create the exporter source**

Create `tools/mt5/ExportMt5TradeLedger.mq5` with:

```mql5
#property strict
#property script_show_inputs

input string InpBrokerId = "hfmarkets";
input string InpSymbol = "XAUUSD";
input int InpHistoryDays = 30;

string AccountModeLabel()
{
   long mode = AccountInfoInteger(ACCOUNT_TRADE_MODE);
   if(mode == ACCOUNT_TRADE_MODE_DEMO) return "demo";
   if(mode == ACCOUNT_TRADE_MODE_REAL) return "real";
   return "contest";
}

string DealEntryLabel(long value)
{
   if(value == DEAL_ENTRY_IN) return "in";
   if(value == DEAL_ENTRY_OUT) return "out";
   if(value == DEAL_ENTRY_INOUT) return "inout";
   if(value == DEAL_ENTRY_OUT_BY) return "out_by";
   return IntegerToString((int)value);
}

string DealTypeLabel(long value)
{
   if(value == DEAL_TYPE_BUY) return "buy";
   if(value == DEAL_TYPE_SELL) return "sell";
   if(value == DEAL_TYPE_BALANCE) return "balance";
   if(value == DEAL_TYPE_CREDIT) return "credit";
   if(value == DEAL_TYPE_CHARGE) return "charge";
   if(value == DEAL_TYPE_CORRECTION) return "correction";
   return IntegerToString((int)value);
}

string DealReasonLabel(long value)
{
   if(value == DEAL_REASON_CLIENT) return "client";
   if(value == DEAL_REASON_MOBILE) return "mobile";
   if(value == DEAL_REASON_WEB) return "web";
   if(value == DEAL_REASON_EXPERT) return "expert";
   return IntegerToString((int)value);
}

string CsvEscape(string value)
{
   StringReplace(value, "\"", "\"\"");
   if(StringFind(value, ",") >= 0 || StringFind(value, "\"") >= 0)
      return "\"" + value + "\"";
   return value;
}

void OnStart()
{
   string symbol = InpSymbol == "" ? _Symbol : InpSymbol;
   datetime toTime = TimeCurrent();
   datetime fromTime = toTime - (InpHistoryDays * 86400);
   if(!HistorySelect(fromTime, toTime))
   {
      Print("HistorySelect failed: ", GetLastError());
      return;
   }

   string directory = "OpenAliceMt5TradeLedgerV1\\" + InpBrokerId + "\\" + symbol;
   FolderCreate("OpenAliceMt5TradeLedgerV1", FILE_COMMON);
   FolderCreate("OpenAliceMt5TradeLedgerV1\\" + InpBrokerId, FILE_COMMON);
   FolderCreate(directory, FILE_COMMON);

   string path = directory + "\\deals.csv";
   int handle = FileOpen(path, FILE_WRITE | FILE_CSV | FILE_COMMON | FILE_ANSI, ',');
   if(handle == INVALID_HANDLE)
   {
      Print("FileOpen failed for ", path, ": ", GetLastError());
      return;
   }

   FileWrite(handle, "account_mode", "server", "login", "broker", "symbol", "deal_ticket", "order_ticket", "position_id", "time", "entry", "type", "reason", "volume", "price", "commission", "fee", "swap", "profit", "magic", "comment");

   int total = HistoryDealsTotal();
   for(int index = 0; index < total; index++)
   {
      ulong ticket = HistoryDealGetTicket(index);
      string dealSymbol = HistoryDealGetString(ticket, DEAL_SYMBOL);
      if(dealSymbol != symbol) continue;

      datetime dealTime = (datetime)HistoryDealGetInteger(ticket, DEAL_TIME);
      string isoTime = TimeToString(dealTime, TIME_DATE | TIME_SECONDS);
      StringReplace(isoTime, ".", "-");
      StringReplace(isoTime, " ", "T");
      isoTime = isoTime + ".000Z";

      FileWrite(
         handle,
         AccountModeLabel(),
         AccountInfoString(ACCOUNT_SERVER),
         IntegerToString((int)AccountInfoInteger(ACCOUNT_LOGIN)),
         InpBrokerId,
         symbol,
         IntegerToString((long)ticket),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_ORDER)),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_POSITION_ID)),
         isoTime,
         DealEntryLabel(HistoryDealGetInteger(ticket, DEAL_ENTRY)),
         DealTypeLabel(HistoryDealGetInteger(ticket, DEAL_TYPE)),
         DealReasonLabel(HistoryDealGetInteger(ticket, DEAL_REASON)),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_VOLUME), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_PRICE), _Digits),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_COMMISSION), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_FEE), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_SWAP), 2),
         DoubleToString(HistoryDealGetDouble(ticket, DEAL_PROFIT), 2),
         IntegerToString((long)HistoryDealGetInteger(ticket, DEAL_MAGIC)),
         CsvEscape(HistoryDealGetString(ticket, DEAL_COMMENT))
      );
   }

   FileClose(handle);
   Print("JMB Goldmine trade ledger exported: ", path);
}
```

- [ ] **Step 2: Document compile and run instructions**

Append this section to `tools/mt5/README.md`:

```md
## Read-only trade ledger exporter

`ExportMt5TradeLedger.mq5` exports MT5 deal history for one broker/symbol into MetaTrader Common Files:

`OpenAliceMt5TradeLedgerV1/<broker>/<symbol>/deals.csv`

Use it on demo accounts first:

1. Open MetaEditor from the target MT5 terminal.
2. Copy or open `tools/mt5/ExportMt5TradeLedger.mq5`.
3. Compile it.
4. Run it once per broker/symbol with:
   - HFM demo Gold: `InpBrokerId=hfmarkets`, `InpSymbol=XAUUSD`
   - HFM demo EURUSD: `InpBrokerId=hfmarkets`, `InpSymbol=EURUSD`
   - IC Markets demo Gold: `InpBrokerId=icmarkets`, `InpSymbol=XAUUSD`
   - IC Markets demo EURUSD: `InpBrokerId=icmarkets`, `InpSymbol=EURUSD`

The exporter is read-only. It does not submit, modify, or close orders. If the exported account mode is not `demo`, JMB Goldmine must show the ledger as blocked for demo-autopilot progression.
```

- [ ] **Step 3: Run text-level verification**

Run:

```powershell
Select-String -Path tools/mt5/ExportMt5TradeLedger.mq5 -Pattern 'OrderSend|PositionClose|trade.Buy|trade.Sell'
```

Expected: no matches.

- [ ] **Step 4: Commit Task 4**

Run:

```powershell
git add tools/mt5/ExportMt5TradeLedger.mq5 tools/mt5/README.md
git commit -m "feat: add mt5 trade ledger exporter"
```

Expected: one commit containing the read-only exporter and documentation.

---

### Task 5: Add learning-foundation verification run

**Files:**
- Modify only files from Tasks 1-4 if verification reveals a direct defect.

**Interfaces:**
- Consumes: all previous task outputs.
- Produces: verified learning foundation with no execution authority.

- [ ] **Step 1: Run all MT5 domain tests**

Run:

```powershell
pnpm vitest run src/domain/mt5
```

Expected: PASS.

- [ ] **Step 2: Verify no order API was introduced in app/domain files**

Run:

```powershell
rg "OrderSend|trade\\.Buy|trade\\.Sell|PositionClose|CTrade" src tools/mt5
```

Expected: either no matches, or matches only in files that are explicitly documented execution-capable from prior work. `tools/mt5/ExportMt5TradeLedger.mq5` must not appear in the results.

- [ ] **Step 3: Verify git only includes intended learning-foundation files**

Run:

```powershell
git status --short
```

Expected: existing unrelated dirty files may remain, but newly staged/committed changes from this plan should be limited to:

```text
src/domain/mt5/trade-ledger.ts
src/domain/mt5/trade-ledger.spec.ts
src/webui/routes/research.ts
ui/src/api/research.ts
ui/src/pages/ResearchDashboardPage.tsx
tools/mt5/ExportMt5TradeLedger.mq5
tools/mt5/README.md
```

- [ ] **Step 4: Record completion note**

Append this line to the final handoff message, not to a source file:

```text
Learning foundation is complete: Gold and EURUSD on HFM demo and IC Markets demo can be imported, labelled, summarized, and displayed. Demo order execution remains locked for the next plan.
```

