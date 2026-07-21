# JMB Goldmine Demo Canary Execution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add deterministic, broker-local, Gold-only demo canary execution for HFM first and IC Markets second, with fresh completed-D1 observations, stable decision identity, fail-closed risk gates, reconciliation, read-only UI status, and no live execution path.

**Architecture:** The existing read-only MT5 bridge exports fresh completed D1 bars. A deterministic TypeScript service derives one stable execution-decision lease per completed observation and publishes it every five minutes through the internal `Pump`, without an LLM, shell, or order API. A new modular MT5 EA independently validates local policy and broker state, submits at most one protected demo order, reconciles authoritative MT5 state, and writes append-only execution evidence for the Research Desk.

**Tech Stack:** TypeScript 5.9, Node.js file APIs, Vitest 4, Hono, React 19, MQL5, MT5 Common Files CSV/JSONL.

## Operational Note — 2026-07-14

- HFM and IC Markets XAUUSD read-only bridges are publishing current Common Files status.
- HFM and IC Markets canary EAs compile cleanly and publish `OpenAliceMt5ExecutionV1/<broker>/XAUUSD/latest_status.csv`.
- The no-order harness passed, then its compiled `.ex5` copies were disabled in the operator MT5 folders so it does not run during forward monitoring.
- A false `reconciliation_required` state was traced to MQL5 `ZeroMemory` leaving latch string fields as `(null)`; `InitializeCanarySafetyLatch` now explicitly clears every latch field.
- Current broker-local state is safe-disabled: `state=disabled`, `execution_enabled=0`, `kill_switch=1`; enabling demo evaluation/trading still requires a separate approved demo canary ceremony.

## Global Constraints

- Source design: `docs/superpowers/specs/2026-07-13-jmb-goldmine-demo-canary-execution-design.md`.
- `PRD.txt` is absent; the project source of truth is `docs/PRD.md` per the approved design.
- Documentation conflict to resolve in Task 10: `docs/PRD.md` R6 describes a broker-local MT5 EA, while R7 says app-managed broker execution uses UTA approval. The approved Plan 3 design governs this separate demo-only EA; the PRD must explicitly distinguish it from app/AI-controlled UTA orders before Stage 1.
- Demo accounts only; the EA must have no live-mode input or live-account bypass.
- Execution instrument is exactly `XAUUSD`; EURUSD remains shadow-only.
- Strategy allowlist is exactly `daily-trend-v1`.
- Maximum volume is exactly `0.01` lot.
- HFM server is exactly `HFMarketsGlobal-Demo4`; IC Markets server is exactly `ICMarketsSC-Demo`.
- HFM magic number is `880101`; IC Markets magic number is `880201`.
- Expected demo account login is an operator-entered local EA input; it is never committed or returned by the Research API.
- Maximum per-trade demo risk is `10.00` account-currency units.
- Maximum daily realized demo loss is `40.00` account-currency units.
- Four losing EA-owned Gold trades pause new entries until the next broker day.
- HFM maximum spread/deviation is `0.75`/`0.50` price units; IC Markets is `0.30`/`0.30`.
- Entry session is Monday-Thursday `06:00-20:00 UTC` and Friday `06:00-16:00 UTC`.
- High-impact USD news blocks entry from 30 minutes before through 30 minutes after the event.
- Estimated post-order free margin must retain at least a ten-times margin buffer.
- Execution defaults are `InpDemoExecutionEnabled=false` and `InpKillSwitch=true`.
- No martingale, grid, recovery sizing, pyramiding, automatic lot growth, fixed take-profit, or AI-controlled risk change.
- AI journal/import code may summarize reconciled evidence but cannot write policy, strategy, EA-input, processed-ID, or broker-state roots.
- Research Desk remains read-only and must never expose account login or add an execution control endpoint.
- Do not launch MetaEditor through PowerShell; the operator compiles manually because Kaspersky previously blocked that automation path.
- Preserve unrelated dirty-worktree changes and commit only files listed by each task.

---

## File Structure

### TypeScript domain and service files

- Create `src/domain/mt5/completed-d1.ts`: strict completed-D1 CSV parser and trend observation derivation.
- Create `src/domain/mt5/completed-d1.spec.ts`: malformed, stale, unsafe, ordering, and lookback tests.
- Create `src/domain/mt5/demo-execution-policy.ts`: strict read-only policy parser and hard-ceiling validation.
- Create `src/domain/mt5/demo-execution-policy.spec.ts`: rollout, allowlist, and ceiling tests.
- Create `src/domain/mt5/broker-cost-model.ts`: deterministic observed cost-model builder/parser.
- Create `src/domain/mt5/broker-cost-model.spec.ts`: spread sample and ledger evidence tests.
- Create `src/domain/mt5/local-paths.ts`: one environment-aware resolver for every JMB MT5 Common Files root.
- Create `src/domain/mt5/local-paths.spec.ts`: explicit-root, default-root, and missing-home tests.
- Create `src/domain/mt5/execution-decision.ts`: isolated execution-decision schema, stable IDs, atomic latest lease, append-once journal.
- Create `src/domain/mt5/execution-decision.spec.ts`: schema, identity, atomicity, and regression tests.
- Create `src/domain/mt5/demo-decision-engine.ts`: pure fail-closed execution-decision builder.
- Create `src/domain/mt5/demo-decision-engine.spec.ts`: Gold eligibility and EURUSD block tests.
- Create `src/domain/mt5/demo-decision-service.ts`: one deterministic four-instrument decision cycle.
- Create `src/domain/mt5/demo-decision-service.spec.ts`: per-broker isolation, deduplication, and stale-observation tests.
- Create `src/task/mt5-decision-scheduler.ts`: private five-minute `Pump` lifecycle.
- Create `src/task/mt5-decision-scheduler.spec.ts`: immediate catch-up, serial cadence, backoff, and stop tests.
- Create `src/domain/mt5/execution-status.ts`: fail-closed EA latest-status read model.
- Create `src/domain/mt5/execution-status.spec.ts`: lifecycle and privacy tests.
- Create `src/domain/mt5/execution-outcomes.ts`: append-only execution-event parser and reconciled learning import.
- Create `src/domain/mt5/execution-outcomes.spec.ts`: duplicate, incomplete, closed, stopped, and privacy tests.
- Create `src/task/mt5-outcome-importer.ts`: deterministic broker-outcome import cycle with no policy write access.
- Create `src/task/mt5-outcome-importer.spec.ts`: restart idempotency and per-broker isolation tests.
- Modify `src/main.ts`: start and stop the internal MT5 decision scheduler.
- Modify `src/webui/routes/research.ts`: add read-only execution projection.
- Create `src/webui/routes/research.spec.ts`: route state and account-login non-disclosure tests.

### Operator and MT5 files

- Modify `tools/mt5/OpenAliceMt5ReadOnlyBridge.mq5`: atomically export last 300 completed D1 bars and append bounded spread samples.
- Create `tools/mt5/ConfigureJmbGoldmineDemoPolicy.mq5`: operator-only policy writer with status-only default.
- Create `tools/mt5/run_demo_canary_decisions.ts`: manual diagnostic wrapper around the deterministic service.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5`: thin EA lifecycle orchestration.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryTypes.mqh`: protocol types and lifecycle enums.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryCsv.mqh`: strict parsing, escaping, atomic status, and flushed JSONL.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryPolicy.mqh`: hard ceilings and identity/policy validation.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryGates.mqh`: pure gate evaluation.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryState.mqh`: processed observations, instance lock, and transition reducer.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryTradeGateway.mqh`: the only file allowed to contain `OrderCheck` or `OrderSend`.
- Create `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryReconcile.mqh`: authoritative order/position/deal and daily-loss reconciliation.
- Create `tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5`: no-order table-driven MQL harness.
- Create `tools/mt5/tests/README.md`: manual compile/run expectations.
- Modify `tools/mt5/README.md`: installation, policy, dry-run, rollout, rollback, and recovery.

### UI files

- Modify `ui/src/api/research.ts`: execution lifecycle contract.
- Create `ui/src/components/research/Mt5ExecutionStatusCard.tsx`: focused read-only status card.
- Create `ui/src/components/research/__tests__/Mt5ExecutionStatusCard.spec.tsx`: lifecycle rendering and privacy tests.
- Modify `ui/src/pages/ResearchDashboardPage.tsx`: integrate the status card without adding controls.
- Create `ui/src/demo/handlers/research.ts`: typed demo Research response.
- Modify `ui/src/demo/handlers/index.ts`: register Research handler before catch-all.

---

### Task 1: Export and parse fresh completed D1 broker bars

**Files:**
- Modify: `tools/mt5/OpenAliceMt5ReadOnlyBridge.mq5`
- Create: `src/domain/mt5/completed-d1.ts`
- Create: `src/domain/mt5/completed-d1.spec.ts`
- Test: `src/domain/mt5/completed-d1.spec.ts`

**Interfaces:**
- Produces: `readMt5CompletedD1(root, broker, symbol, options: { now?: Date; maxAgeHours: number }) => Promise<Mt5CompletedD1Summary>`.
- Produces: `deriveCompletedTrendObservation(parsed, lookbackDays) => CompletedTrendObservation`.
- MT5 file: `OpenAliceMt5BridgeV1/<broker>/<symbol>/completed_d1.csv`.
- Spread file: `OpenAliceMt5BridgeV1/<broker>/<symbol>/spread_samples_YYYYMMDD.csv`.

- [ ] **Step 1: Write failing parser and observation tests**

```ts
import { describe, expect, it } from 'vitest'
import { deriveCompletedTrendObservation, parseCompletedD1Csv } from './completed-d1.js'

function csv(closes: number[]): string {
  const rows = closes.map((close, index) =>
    `1,2026-07-13T09:00:00.000Z,hfmarkets,HFMarketsGlobal-Demo4,demo,XAUUSD,2026-05-${String(index + 1).padStart(2, '0')},${index + 1},${close},${close},${close},${close}`,
  )
  return ['schema_version,captured_at,broker,server,account_mode,symbol,bar_as_of,bar_open_epoch,open,high,low,close', ...rows].join('\n')
}

describe('completed D1 broker bars', () => {
  it('derives the signal from completed bars only', () => {
    const parsed = parseCompletedD1Csv(csv([100, 101, 103]))
    expect(deriveCompletedTrendObservation(parsed, 2)).toMatchObject({
      direction: 'uptrend',
      lookbackDays: 2,
      latestClose: 103,
      referenceClose: 100,
    })
  })

  it('rejects duplicate or descending bar epochs', () => {
    expect(() => parseCompletedD1Csv(csv([100, 101]).replace(',2,101,', ',1,101,'))).toThrow(/ascending/)
  })
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `pnpm vitest run src/domain/mt5/completed-d1.spec.ts`

Expected: FAIL because `completed-d1.ts` does not exist.

- [ ] **Step 3: Implement the strict TypeScript parser**

```ts
export type CompletedD1State = 'ready' | 'missing' | 'stale' | 'unsafe' | 'malformed'
export type TrendDirection = 'uptrend' | 'downtrend' | 'flat'

export interface CompletedD1Bar {
  asOf: string
  openEpoch: number
  open: number
  high: number
  low: number
  close: number
}

export interface ParsedCompletedD1 {
  capturedAt: string
  broker: string
  server: string
  accountMode: string
  symbol: string
  bars: CompletedD1Bar[]
}

export interface Mt5CompletedD1Summary {
  state: CompletedD1State
  detail: string
  ageHours: number | null
  parsed: ParsedCompletedD1 | null
}

export interface CompletedTrendObservation {
  asOf: string
  direction: TrendDirection
  lookbackReturn: number
  lookbackDays: number
  latestClose: number
  referenceClose: number
}

export function deriveCompletedTrendObservation(input: ParsedCompletedD1, lookbackDays: number): CompletedTrendObservation {
  if (!Number.isInteger(lookbackDays) || lookbackDays <= 0 || input.bars.length < lookbackDays + 1) {
    throw new Error('Completed D1 history is insufficient for the selected lookback')
  }
  const latest = input.bars.at(-1)!
  const reference = input.bars.at(-(lookbackDays + 1))!
  const lookbackReturn = latest.close / reference.close - 1
  return {
    asOf: latest.asOf,
    direction: lookbackReturn > 0 ? 'uptrend' : lookbackReturn < 0 ? 'downtrend' : 'flat',
    lookbackReturn,
    lookbackDays,
    latestClose: latest.close,
    referenceClose: reference.close,
  }
}
```

Implement `parseCompletedD1Csv` with the exact header from the test, numeric finite checks, identical metadata across rows, demo-only validation, unique `bar_as_of`, and strictly increasing `bar_open_epoch`. Implement `readMt5CompletedD1` using file modification time and a policy-supplied maximum observation age rather than wall-clock text from the broker server.

- [ ] **Step 4: Extend the read-only bridge exporter**

Add a status-only function that calls `CopyRates(InpSymbol, PERIOD_D1, 1, 300, rates)`. Shift `1` excludes the forming daily bar. Write a temporary Common Files CSV, flush and close it, then atomically replace the destination:

```cpp
bool ReplaceCommonFile(const string temp_path,const string final_path)
{
   return FileMove(temp_path,FILE_COMMON,final_path,FILE_COMMON|FILE_REWRITE);
}

bool WriteCompletedD1()
{
   MqlRates rates[];
   ArraySetAsSeries(rates,false);
   int copied=CopyRates(InpSymbol,PERIOD_D1,1,300,rates);
   if(copied<2) return false;
   string final_path=OUTPUT_ROOT+"\\"+InpBrokerId+"\\"+InpSymbol+"\\completed_d1.csv";
   string temp_path=final_path+".tmp";
   int handle=FileOpen(temp_path,FILE_WRITE|FILE_CSV|FILE_ANSI|FILE_COMMON,',');
   if(handle==INVALID_HANDLE) return false;
   FileWrite(handle,"schema_version","captured_at","broker","server","account_mode","symbol","bar_as_of","bar_open_epoch","open","high","low","close");
   for(int i=0;i<copied;i++)
      FileWrite(handle,1,IsoTime(TimeGMT()),InpBrokerId,AccountInfoString(ACCOUNT_SERVER),AccountModeLabel(),InpSymbol,
         TimeToString(rates[i].time,TIME_DATE),IntegerToString((long)rates[i].time),rates[i].open,rates[i].high,rates[i].low,rates[i].close);
   FileFlush(handle);
   FileClose(handle);
   return ReplaceCommonFile(temp_path,final_path);
}
```

Append one spread observation per heartbeat to a date-partitioned CSV and retain only current/previous-day files. Do not add any trading include or order API to the bridge.

The spread sample header is exactly:

```text
schema_version,captured_at,broker,server,account_mode,symbol,bid,ask,spread,point,digits,contract_size,volume_min,volume_step,stops_level,freeze_level
```

Each row uses the current broker quote and symbol properties from the same heartbeat. The cost-model fingerprint hashes `point`, `digits`, `contract_size`, `volume_min`, `volume_step`, `stops_level`, and `freeze_level` so a contract change blocks execution until evidence is rebuilt.

- [ ] **Step 5: Run focused tests and the no-order scan**

Run: `pnpm vitest run src/domain/mt5/completed-d1.spec.ts src/domain/mt5/read-only-bridge.spec.ts`

Expected: PASS.

Run: `rg -n "OrderSend|OrderCheck|CTrade|trade\.Buy|trade\.Sell|PositionClose" tools/mt5/OpenAliceMt5ReadOnlyBridge.mq5`

Expected: no matches.

- [ ] **Step 6: Commit Task 1**

```powershell
git add -- tools/mt5/OpenAliceMt5ReadOnlyBridge.mq5 src/domain/mt5/completed-d1.ts src/domain/mt5/completed-d1.spec.ts
git commit -m "feat: export fresh mt5 completed d1 bars"
```

---

### Task 2: Add immutable demo policy and observed broker cost model

**Files:**
- Create: `src/domain/mt5/demo-execution-policy.ts`
- Create: `src/domain/mt5/demo-execution-policy.spec.ts`
- Create: `src/domain/mt5/broker-cost-model.ts`
- Create: `src/domain/mt5/broker-cost-model.spec.ts`
- Create: `tools/mt5/ConfigureJmbGoldmineDemoPolicy.mq5`

**Interfaces:**
- Produces: `readDemoExecutionPolicy(root, broker, symbol) => Promise<DemoExecutionPolicySummary>`.
- Produces: `buildBrokerCostModel(input) => BrokerCostModel`.
- Produces: `writeBrokerCostModel(root, model) => Promise<void>` using unique-temp-file plus atomic rename.
- Policy file: `OpenAliceMt5DemoPolicyV1/<broker>/XAUUSD/policy.csv`.
- Cost file: `OpenAliceMt5CostModelV1/<broker>/XAUUSD/cost_model.csv`.

- [ ] **Step 1: Write failing hard-ceiling policy tests**

```ts
import { describe, expect, it } from 'vitest'
import { validateDemoExecutionPolicy } from './demo-execution-policy.js'

const policy = {
  schemaVersion: 1 as const,
  policyVersion: 'hfm-canary-v1',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  symbol: 'XAUUSD',
  strategyVersion: 'daily-trend-v1',
  rolloutStage: 'hfm_canary' as const,
  candidateApproved: true,
  completedObservationMaxAgeHours: 72,
  maxSpread: 0.75,
  maxDeviation: 0.5,
  maxRiskAmount: 10,
  maxDailyLoss: 40,
  maxDailyLosingTrades: 4,
  maxVolume: 0.01,
  magicNumber: 880101,
}

describe('demo execution policy', () => {
  it('accepts the exact HFM canary ceiling', () => expect(validateDemoExecutionPolicy(policy).state).toBe('ready'))
  it('blocks a policy that loosens max volume', () => expect(validateDemoExecutionPolicy({ ...policy, maxVolume: 0.02 }).state).toBe('blocked'))
  it('blocks EURUSD regardless of candidate flag', () => expect(validateDemoExecutionPolicy({ ...policy, symbol: 'EURUSD' }).state).toBe('blocked'))
})
```

- [ ] **Step 2: Run the policy test and verify RED**

Run: `pnpm vitest run src/domain/mt5/demo-execution-policy.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the exact policy contract**

```ts
export type DemoRolloutStage = 'status_only' | 'hfm_canary' | 'ic_canary' | 'both_demo'

export interface DemoExecutionPolicy {
  schemaVersion: 1
  policyVersion: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  rolloutStage: DemoRolloutStage
  candidateApproved: boolean
  completedObservationMaxAgeHours: number
  maxSpread: number
  maxDeviation: number
  maxRiskAmount: number
  maxDailyLoss: number
  maxDailyLosingTrades: number
  maxVolume: number
  magicNumber: 880101 | 880201
}

export interface DemoExecutionPolicySummary {
  state: 'ready' | 'blocked' | 'missing' | 'malformed'
  detail: string
  policy: DemoExecutionPolicy | null
}
```

`validateDemoExecutionPolicy` must compare every policy limit against immutable hard ceilings. A policy may tighten a limit but cannot loosen it. `status_only` is always non-executable. The TypeScript app receives no write function for the policy root.

The strict `policy.csv` header is exactly:

```text
schema_version,policy_version,broker,server,symbol,strategy_version,rollout_stage,candidate_approved,completed_observation_max_age_hours,max_spread,max_deviation,max_risk_amount,max_daily_loss,max_daily_losing_trades,max_volume,magic_number
```

- [ ] **Step 4: Write and implement broker-cost evidence tests**

Test that `buildBrokerCostModel` returns `canary_ready` only when all conditions hold: fresh bridge, at least 100 recent spread samples, parseable commission/swap fields from at least one closed demo Gold deal, matching contract fingerprint, and configured conservative deviation ceiling. Test missing evidence as `blocked`, not `warn`.

```ts
export interface BrokerCostModel {
  schemaVersion: 1
  version: string
  broker: 'hfmarkets' | 'icmarkets'
  server: string
  symbol: 'XAUUSD'
  state: 'canary_ready' | 'blocked'
  observedFrom: string
  observedTo: string
  expiresAt: string
  spreadSampleCount: number
  observedMaxSpread: number
  configuredMaxSpread: number
  configuredMaxDeviation: number
  commissionObserved: boolean
  swapObserved: boolean
  contractFingerprint: string
  evidence: string[]
}

export async function writeBrokerCostModel(root: string, model: BrokerCostModel): Promise<void> {
  const destination = join(root, model.broker, model.symbol, 'cost_model.csv')
  await mkdir(dirname(destination), { recursive: true })
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`
  await writeFile(temporary, serializeBrokerCostModelCsv(model), { encoding: 'utf8', flag: 'wx' })
  await renameReplacing(temporary, destination)
}
```

The strict `cost_model.csv` header is exactly:

```text
schema_version,version,broker,server,symbol,state,observed_from,observed_to,expires_at,spread_sample_count,observed_max_spread,configured_max_spread,configured_max_deviation,commission_observed,swap_observed,contract_fingerprint,evidence_json
```

Run: `pnpm vitest run src/domain/mt5/broker-cost-model.spec.ts`

Expected after implementation: PASS.

- [ ] **Step 5: Add the operator-only MQL policy script**

The script must refuse non-demo accounts, derive broker/server/magic from exact allowlists, support only `XAUUSD`, and default `InpRolloutStage="status_only"`. It writes the exact CSV schema atomically under `OpenAliceMt5DemoPolicyV1`. It must not contain `OrderSend`, `OrderCheck`, or position-close code.

- [ ] **Step 6: Run Task 2 verification**

Run: `pnpm vitest run src/domain/mt5/demo-execution-policy.spec.ts src/domain/mt5/broker-cost-model.spec.ts`

Expected: PASS.

Run: `rg -n "OrderSend|OrderCheck|PositionClose" tools/mt5/ConfigureJmbGoldmineDemoPolicy.mq5`

Expected: no matches.

- [ ] **Step 7: Commit Task 2**

```powershell
git add -- src/domain/mt5/demo-execution-policy.ts src/domain/mt5/demo-execution-policy.spec.ts src/domain/mt5/broker-cost-model.ts src/domain/mt5/broker-cost-model.spec.ts tools/mt5/ConfigureJmbGoldmineDemoPolicy.mq5
git commit -m "feat: add mt5 demo policy and cost gates"
```

---

### Task 3: Publish isolated, stable execution-decision leases

**Files:**
- Create: `src/domain/mt5/local-paths.ts`
- Create: `src/domain/mt5/local-paths.spec.ts`
- Create: `src/domain/mt5/execution-decision.ts`
- Create: `src/domain/mt5/execution-decision.spec.ts`
- Create: `src/domain/mt5/demo-decision-engine.ts`
- Create: `src/domain/mt5/demo-decision-engine.spec.ts`
- Create: `src/domain/mt5/demo-decision-service.ts`
- Create: `src/domain/mt5/demo-decision-service.spec.ts`
- Create: `tools/mt5/run_demo_canary_decisions.ts`

**Interfaces:**
- Produces: `createObservationId`, `createExecutionDecisionId`, `serializeExecutionDecisionCsv`, `parseExecutionDecisionCsv`.
- Produces: `buildDemoExecutionDecision(input) => JmbExecutionDecision`.
- Produces: `runDemoDecisionCycle(options) => Promise<DemoDecisionCycleResult[]>`.
- Produces: `resolveJmbMt5Roots(options?) => JmbMt5Roots`.
- Output root: `OpenAliceMt5ExecutionDecisionV1/<broker>/XAUUSD/`.

- [ ] **Step 1: Write failing stable-identity tests**

```ts
it('keeps ids stable when only the five-minute lease changes', () => {
  const first = sampleDecision({ leaseIssuedAt: '2026-07-13T09:00:00Z', leaseExpiresAt: '2026-07-13T09:10:00Z' })
  const second = sampleDecision({ leaseIssuedAt: '2026-07-13T09:05:00Z', leaseExpiresAt: '2026-07-13T09:15:00Z' })
  expect(createObservationId(first)).toBe(createObservationId(second))
  expect(createExecutionDecisionId(first)).toBe(createExecutionDecisionId(second))
})

it('changes identity for a newer completed D1 date', () => {
  expect(createObservationId(sampleDecision({ observationAsOf: '2026-07-12' })))
    .not.toBe(createObservationId(sampleDecision({ observationAsOf: '2026-07-11' })))
})

it('does not re-identify a consumed observation after policy or cost refresh', () => {
  const first = sampleDecision({ candidatePolicyVersion: 'hfm-v1', costModelVersion: 'cost-0900' })
  const refreshed = sampleDecision({ candidatePolicyVersion: 'hfm-v2', costModelVersion: 'cost-0905' })
  expect(createExecutionDecisionId(first)).toBe(createExecutionDecisionId(refreshed))
})
```

- [ ] **Step 2: Run the identity test and verify RED**

Run: `pnpm vitest run src/domain/mt5/execution-decision.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the isolated protocol and hashes**

```ts
export interface JmbGateResult {
  name: string
  state: 'pass' | 'block'
  detail: string
}

export interface JmbExecutionDecision {
  schemaVersion: 1
  decisionId: string
  observationId: string
  observationAsOf: string
  createdAt: string
  leaseIssuedAt: string
  leaseExpiresAt: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  accountMode: 'demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  direction: 'buy' | 'sell' | 'flat'
  entryReferencePrice: number | null
  volume: 0.01
  stopLoss: number | null
  maxRiskAmount: number
  candidatePolicyVersion: string
  costModelVersion: string
  gateResults: JmbGateResult[]
}

export function createObservationId(input: Pick<JmbExecutionDecision, 'broker' | 'symbol' | 'strategyVersion' | 'observationAsOf'>): string {
  return hash([input.broker, input.symbol, input.strategyVersion, input.observationAsOf])
}

export function createExecutionDecisionId(input: Pick<JmbExecutionDecision, 'observationId'>): string {
  return hash(['daily-trend-v1', input.observationId])
}
```

The decision ID is permanently bound to the observation ID; policy, cost, quote, direction, and lease refreshes cannot create a second identity for a consumed observation. Before the first entry attempt, a renewed lease may refresh evidence fields under the same ID. After any attempt, the EA's processed-observation store is authoritative and forbids another send. The CSV parser must use an exact allowlisted header and semantic enum validation. The JSONL journal appends only when decision evidence materially changes, while retaining the same decision ID. `latest_decision.csv` uses unique temporary write plus `rename`; a regressed `observationAsOf` must not overwrite a newer lease.

The strict `latest_decision.csv` header is exactly:

```text
schema_version,decision_id,observation_id,observation_as_of,created_at,lease_issued_at,lease_expires_at,broker,server,account_mode,symbol,strategy_version,direction,entry_reference_price,volume,stop_loss,max_risk_amount,candidate_policy_version,cost_model_version,gate_results_json
```

- [ ] **Step 4: Write failing pure-engine tests**

Test HFM Gold `ready`, IC Gold blocked during `hfm_canary`, EURUSD always blocked, stale completed observation blocked, blocked cost model, missing stop, spread breach, and flat direction. The engine must never return executable when any hard gate fails.

- [ ] **Step 5: Implement the pure engine**

`buildDemoExecutionDecision` receives already-parsed bridge, observation, policy, cost model, learning, and quote values. It creates a `buy`, `sell`, or `flat` lease and an ordered `gateResults` array. The function has no file, network, time, LLM, or broker dependencies.

- [ ] **Step 6: Implement the deterministic cycle service**

```ts
export interface JmbMt5Roots {
  bridgeRoot: string
  ledgerRoot: string
  policyRoot: string
  costModelRoot: string
  executionDecisionRoot: string
  executionRoot: string
  researchRoot: string
}

export interface JmbDemoInstrumentConfig {
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  symbol: 'XAUUSD' | 'EURUSD'
  researchArtifactSymbol: 'XAUUSDb' | 'EURUSDb' | 'XAUUSD' | 'EURUSD'
  maxSpread: number
  maxDeviation: number
}

export interface DemoDecisionCycleOptions {
  roots: JmbMt5Roots
  now?: () => Date
  instruments?: readonly JmbDemoInstrumentConfig[]
}

export interface DemoDecisionCycleResult {
  broker: string
  symbol: string
  state: 'published' | 'blocked' | 'error'
  observationId: string | null
  decisionId: string | null
  detail: string
}
```

`resolveJmbMt5Roots` accepts explicit overrides first, then `OPENALICE_MT5_COMMON_FILES_ROOT`, then `%APPDATA%\MetaQuotes\Terminal\Common\Files`; it throws when no absolute Common Files root can be resolved. It derives `OpenAliceMt5BridgeV1`, `OpenAliceMt5TradeLedgerV1`, `OpenAliceMt5DemoPolicyV1`, `OpenAliceMt5CostModelV1`, `OpenAliceMt5ExecutionDecisionV1`, and `OpenAliceMt5ExecutionV1` beneath that root. `researchRoot` resolves from `OPENALICE_RESEARCH_ROOT`, otherwise `~/.openalice/data/research`. Process broker/symbol pairs independently so one malformed broker does not suppress the other three. Read the frozen selected lookback from research artifacts but derive direction from fresh completed-D1 broker bars. Build and atomically persist the current cost model before the engine evaluates it. Publish execution leases only to the isolated execution-decision root. EURUSD returns `blocked`, publishes no execution lease, and continues using the existing shadow-decision journal as its durable record.

- [ ] **Step 7: Add the diagnostic CLI**

`tools/mt5/run_demo_canary_decisions.ts` resolves local roots, calls `runDemoDecisionCycle`, prints one concise line per broker/symbol, and sets a nonzero exit code only for thrown infrastructure errors. It contains no duplicated strategy rules and no child-process calls.

- [ ] **Step 8: Run Task 3 verification**

Run: `pnpm vitest run src/domain/mt5/execution-decision.spec.ts src/domain/mt5/demo-decision-engine.spec.ts src/domain/mt5/demo-decision-service.spec.ts`

Expected: PASS.

Run: `rg -n "child_process|powershell|MetaEditor|OrderSend|OrderCheck" src/domain/mt5/execution-decision.ts src/domain/mt5/demo-decision-engine.ts src/domain/mt5/demo-decision-service.ts tools/mt5/run_demo_canary_decisions.ts`

Expected: no matches.

- [ ] **Step 9: Commit Task 3**

```powershell
git add -- src/domain/mt5/local-paths.ts src/domain/mt5/local-paths.spec.ts src/domain/mt5/execution-decision.ts src/domain/mt5/execution-decision.spec.ts src/domain/mt5/demo-decision-engine.ts src/domain/mt5/demo-decision-engine.spec.ts src/domain/mt5/demo-decision-service.ts src/domain/mt5/demo-decision-service.spec.ts tools/mt5/run_demo_canary_decisions.ts
git commit -m "feat: add deterministic mt5 execution decisions"
```

---

### Task 4: Run the decision cycle through the internal Pump

**Files:**
- Create: `src/task/mt5-decision-scheduler.ts`
- Create: `src/task/mt5-decision-scheduler.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `runDemoDecisionCycle(options)` from Task 3.
- Produces: `createJmbMt5DecisionScheduler(options) => JmbMt5DecisionScheduler`.

- [ ] **Step 1: Write failing lifecycle tests**

```ts
it('runs one catch-up cycle before arming the five-minute pump', async () => {
  const runCycle = vi.fn(async () => [])
  const scheduler = createJmbMt5DecisionScheduler({ runCycle })
  await scheduler.start()
  expect(runCycle).toHaveBeenCalledTimes(1)
  scheduler.stop()
})

it('does not overlap a slow cycle', async () => {
  let release!: () => void
  const slowCycle = new Promise<void>((resolve) => { release = resolve })
  const runCycle = vi.fn()
    .mockResolvedValueOnce([])
    .mockImplementation(() => slowCycle)
  const scheduler = createJmbMt5DecisionScheduler({ runCycle, every: '5m' })
  await scheduler.start()
  await vi.advanceTimersByTimeAsync(15 * 60_000)
  expect(runCycle).toHaveBeenCalledTimes(2)
  release()
  await Promise.resolve()
  scheduler.stop()
})
```

- [ ] **Step 2: Run the scheduler test and verify RED**

Run: `pnpm vitest run src/task/mt5-decision-scheduler.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement using `createPump`**

```ts
import { createPump, type Pump } from '../core/pump.js'

export interface JmbMt5DecisionScheduler {
  start(): Promise<void>
  stop(): void
  runNow(): Promise<void>
}

export function createJmbMt5DecisionScheduler(options: {
  runCycle: () => Promise<unknown>
  every?: string
  logger?: Pick<Console, 'log' | 'warn' | 'error'>
}): JmbMt5DecisionScheduler {
  const pump: Pump = createPump({
    name: 'jmb-mt5-decision-cycle',
    every: options.every ?? '5m',
    serial: true,
    onTick: async () => { await options.runCycle() },
    logger: options.logger,
  })
  return {
    async start() { await pump.runNow(); pump.start() },
    stop() { pump.stop() },
    runNow() { return pump.runNow() },
  }
}
```

- [ ] **Step 4: Wire lifecycle in `src/main.ts`**

Construct the scheduler after data paths are available, call `await scheduler.start()` before the engine-ready log, and call `scheduler.stop()` in shutdown before listeners stop. Do not register it with user Cron, ToolCenter, workspaces, or EngineContext.

- [ ] **Step 5: Run scheduler and source-boundary verification**

Run: `pnpm vitest run src/task/mt5-decision-scheduler.spec.ts src/core/pump.spec.ts`

Expected: PASS.

Run: `rg -n "cron|workspace|child_process|powershell|spawn\(|exec\(" src/task/mt5-decision-scheduler.ts`

Expected: no matches.

- [ ] **Step 6: Commit Task 4**

```powershell
git add -- src/task/mt5-decision-scheduler.ts src/task/mt5-decision-scheduler.spec.ts src/main.ts
git commit -m "feat: schedule mt5 demo decisions internally"
```

---

### Task 5: Add execution status read model and Research Desk projection

**Files:**
- Create: `src/domain/mt5/execution-status.ts`
- Create: `src/domain/mt5/execution-status.spec.ts`
- Modify: `src/webui/routes/research.ts`
- Create: `src/webui/routes/research.spec.ts`
- Modify: `ui/src/api/research.ts`
- Create: `ui/src/components/research/Mt5ExecutionStatusCard.tsx`
- Create: `ui/src/components/research/__tests__/Mt5ExecutionStatusCard.spec.tsx`
- Modify: `ui/src/pages/ResearchDashboardPage.tsx`
- Create: `ui/src/demo/handlers/research.ts`
- Modify: `ui/src/demo/handlers/index.ts`

**Interfaces:**
- Consumes: `OpenAliceMt5ExecutionV1/<broker>/XAUUSD/latest_status.csv` from Tasks 6-8.
- Produces: `summarizeLatestJmbExecutionStatus(root, broker, symbol, now?) => Promise<JmbExecutionStatusSummary>`.
- Produces: read-only `execution` on each Research instrument.

- [ ] **Step 1: Write failing strict-status parser tests**

```ts
it('summarizes a protected demo fill without exposing account login', async () => {
  const summary = await summarizeLatestJmbExecutionStatus(root, 'hfmarkets', 'XAUUSD')
  expect(summary.state).toBe('filled_protected')
  expect(JSON.stringify(summary)).not.toMatch(/account.?login/i)
})

it('rejects an unexpected account_login column', () => {
  expect(() => parseExecutionStatusCsv(validCsv.replace('symbol,', 'account_login,symbol,'))).toThrow(/schema/)
})
```

- [ ] **Step 2: Run the parser test and verify RED**

Run: `pnpm vitest run src/domain/mt5/execution-status.spec.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement the safe lifecycle contract**

```ts
export type JmbExecutionLifecycleState =
  | 'disabled' | 'paused' | 'blocked' | 'ready' | 'order_requesting'
  | 'order_rejected' | 'reconciliation_required' | 'filled_protected'
  | 'close_requesting' | 'closed' | 'stopped' | 'emergency_close' | 'error'

export type JmbExecutionRolloutStage = 'status_only' | 'hfm_canary' | 'ic_canary' | 'both_demo'

export type JmbResearchExecutionState = JmbExecutionLifecycleState | 'demo_blocked' | 'missing' | 'malformed' | 'stale'

export interface JmbExecutionStatusSummary {
  state: JmbResearchExecutionState
  label: string
  detail: string
  capturedAt: string | null
  broker: 'hfmarkets' | 'icmarkets'
  server: string | null
  accountMode: 'demo' | null
  symbol: 'XAUUSD' | 'EURUSD'
  rolloutStage: JmbExecutionRolloutStage
  executionEnabled: boolean
  killSwitch: boolean
  decisionId: string | null
  observationId: string | null
  latestEvent: { id: string; type: string; at: string; resultCode: string; detail: string } | null
  stopProtectionConfirmed: boolean
  position: { direction: 'buy' | 'sell'; volume: number; openPrice: number; stopLoss: number; id: string } | null
  reconciliationState: string
  dailyLossCount: number
  dailyRealizedLoss: number
  blockingGate: string | null
  nextSafeAction: string
}
```

The summary exposes broker, symbol, server, account mode, captured/update times, rollout stage, execution/kill-switch flags, decision/observation IDs, latest event, stop confirmation, EA-only position, reconciliation state, daily losses, blocking gate, and next safe action. It never includes raw or masked login.

The strict `latest_status.csv` header is exactly:

```text
schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action
```

Any missing, duplicate, reordered, or extra column is malformed and maps to a fail-closed Research summary. Position, order, and deal IDs are opaque strings; no account identifier is accepted by this read model.

- [ ] **Step 4: Extend the Research route with a testability seam**

Change the factory to `createResearchRoutes(ctx, overrides?: { executionRoot?: string })`. Use `bridgeSymbol ?? symbol` for execution paths. Gold receives the parsed execution summary; EURUSD receives an explicit read-only `DEMO BLOCKED` projection. Keep top-level `mode: 'research_only'` and `tradingEnabled: false` because those describe Research Desk authority, not broker-local EA state.

- [ ] **Step 5: Write and pass the route privacy test**

Mount the Hono route with a temporary execution root, request `/`, and assert Gold lifecycle state, EURUSD block, and absence of `accountLogin`, `account_login`, or a sentinel login value.

Run: `pnpm vitest run src/webui/routes/research.spec.ts`

Expected: PASS.

- [ ] **Step 6: Add the focused status card and tests**

The component maps approved labels, always shows `DEMO ONLY`, displays latest event/stop/exposure/daily loss/blocking gate/next safe action, and contains no button, toggle, or order action.

```tsx
export function Mt5ExecutionStatusCard({ execution }: { execution: JmbExecutionStatusSummary }) {
  return <section aria-label="MT5 demo execution status">
    <span>DEMO ONLY</span>
    <strong>{execution.label}</strong>
    <p>{execution.detail}</p>
    {execution.blockingGate ? <p>Blocked by: {execution.blockingGate}</p> : null}
    <p>Next: {execution.nextSafeAction}</p>
  </section>
}
```

Test `filled_protected`, `paused`, `reconciliation_required`, and EUR `demo_blocked`; assert no login text and no interactive execution control.

- [ ] **Step 7: Integrate UI and demo handler**

Render the new card after the Plan 2 decision card. Update the hero to explain that the page is a read-only monitor and execution remains broker-local in MT5. Add a typed demo handler before catch-all so demo builds do not return `{}`.

- [ ] **Step 8: Run UI/API verification**

Run: `pnpm vitest run src/domain/mt5/execution-status.spec.ts src/webui/routes/research.spec.ts ui/src/components/research/__tests__/Mt5ExecutionStatusCard.spec.tsx`

Expected: PASS.

Run: `pnpm -F open-alice-ui build`

Expected: PASS.

Run: `pnpm -F open-alice-ui build:demo`

Expected: PASS.

- [ ] **Step 9: Commit Task 5**

```powershell
git add -- src/domain/mt5/execution-status.ts src/domain/mt5/execution-status.spec.ts src/webui/routes/research.ts src/webui/routes/research.spec.ts ui/src/api/research.ts ui/src/components/research/Mt5ExecutionStatusCard.tsx ui/src/components/research/__tests__/Mt5ExecutionStatusCard.spec.tsx ui/src/pages/ResearchDashboardPage.tsx ui/src/demo/handlers/research.ts ui/src/demo/handlers/index.ts
git commit -m "feat: show mt5 demo execution lifecycle"
```

---

### Task 6: Build the modular dry-run EA gates and no-order harness

**Files:**
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5`
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryTypes.mqh`
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryCsv.mqh`
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryPolicy.mqh`
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryGates.mqh`
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryState.mqh`
- Create: `tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5`
- Create: `tools/mt5/tests/README.md`
- Create: `src/domain/mt5/demo-canary-source.spec.ts`

**Interfaces:**
- Consumes: Task 2 policy CSV and Task 3 execution-decision lease CSV.
- Produces: `OpenAliceMt5ExecutionV1/<broker>/XAUUSD/latest_status.csv`.
- No order API is permitted in this task.

- [ ] **Step 1: Write the failing TypeScript source acceptance test**

```ts
it('keeps the dry-run bundle order-free and safe by default', async () => {
  const source = await readCanaryBundle()
  expect(source).not.toMatch(/OrderSend|OrderCheck|CTrade|PositionClose/)
  expect(source).toContain('input bool InpDemoExecutionEnabled = false;')
  expect(source).toContain('input bool InpKillSwitch = true;')
  expect(source).not.toMatch(/live.?mode/i)
})
```

- [ ] **Step 2: Run the source test and verify RED**

Run: `pnpm vitest run src/domain/mt5/demo-canary-source.spec.ts`

Expected: FAIL because the bundle does not exist.

- [ ] **Step 3: Implement types, policy hard ceilings, and pure gates**

Define `CanaryDecision`, `CanaryPolicy`, `CanaryEnvironment`, `CanaryGateResult`, `CanaryLifecycleState`, and `CanaryEvaluation`. `EvaluateCanaryGates` accepts structs and returns a result without reading files or calling MT5 order APIs.

```cpp
CanaryGateResult Gate(const string name,const bool passed,const string detail)
{
   CanaryGateResult result;
   result.name=name;
   result.passed=passed;
   result.detail=detail;
   return result;
}
```

Apply the exact gate order from the design: demo/identity, switches, rollout, allowlists, freshness, volume, stop/risk, daily loss/count, exposure, margin, spread/deviation, session, news, log preflight, reconciliation.

The stop-risk gate calls `OrderCalcProfit` from the current entry quote to the proposed stop and requires the absolute loss to be at most the tighter of policy and hard ceiling. The margin gate calls `OrderCalcMargin` and requires free margin after the estimate to retain the ten-times buffer. The news gate queries the MT5 economic calendar for high-impact USD events; unavailable, incomplete, or failed calendar reads block entry.

- [ ] **Step 4: Implement strict CSV and durable status helpers**

The parser locates fields by exact header name, rejects duplicate/missing fields, forbids physical multiline values, validates enums/numbers, and rejects leases outside `leaseIssuedAt <= TimeGMT() <= leaseExpiresAt`. Status writes use a temporary Common Files path, `FileFlush`, `FileClose`, and `FileMove(temp, FILE_COMMON, destination, FILE_COMMON|FILE_REWRITE)`.

- [ ] **Step 5: Implement thin dry-run EA orchestration**

Use `#property version "0.200"`. `OnInit` validates inputs, sets a ten-second timer, exports no credentials, and evaluates once. `OnTick`/`OnTimer` call one serial `Evaluate()` function that writes `disabled`, `paused`, `blocked`, or `ready`. Even if `InpDemoExecutionEnabled=true`, this task remains order-free and reports `ready` only.

```cpp
input string InpBrokerId = "";
input string InpExpectedServer = "";
input long   InpExpectedAccountLogin = 0;
input string InpSymbol = "XAUUSD";
input long   InpMagicNumber = 0;
input bool   InpDemoExecutionEnabled = false;
input bool   InpKillSwitch = true;

int OnInit()
{
   if(InpExpectedAccountLogin<=0 || InpSymbol!="XAUUSD") return INIT_PARAMETERS_INCORRECT;
   EventSetTimer(10);
   Evaluate();
   return INIT_SUCCEEDED;
}

void OnTimer() { Evaluate(); }
void OnTick()  { Evaluate(); }
void OnDeinit(const int reason) { EventKillTimer(); }
```

`InpExpectedAccountLogin` is checked in memory against `ACCOUNT_LOGIN` but is never written to status, events, logs, comments, or API artifacts.

- [ ] **Step 6: Add table-driven MQL harness cases**

The harness includes production types/gates/state but no trade gateway. It writes PASS/FAIL for demo/server/symbol/magic, switches, volume/stop/risk, spread/session/news, exposure, duplicate observation, four-loss reset, and log failure. A nonzero failure count returns `INIT_FAILED`.

- [ ] **Step 7: Run TypeScript source checks**

Run: `pnpm vitest run src/domain/mt5/demo-canary-source.spec.ts`

Expected: PASS.

Run: `rg -n "OrderSend|OrderCheck|CTrade|PositionClose" tools/mt5/JmbGoldmineDemoCanary tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5`

Expected: no matches.

- [ ] **Step 8: Ask the operator to compile manually**

The operator compiles both `JmbGoldmineDemoCanary.mq5` and `JmbGoldmineDemoCanaryHarness.mq5` in MetaEditor. Acceptance is `0 errors, 0 warnings`; Codex must not launch MetaEditor.

- [ ] **Step 9: Commit Task 6**

```powershell
git add -- tools/mt5/JmbGoldmineDemoCanary tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5 tools/mt5/tests/README.md src/domain/mt5/demo-canary-source.spec.ts
git commit -m "feat: add mt5 demo canary dry run"
```

---

### Task 7: Add the single protected-order gateway

**Files:**
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryTradeGateway.mqh`
- Modify: `tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5`
- Modify: `src/domain/mt5/demo-canary-source.spec.ts`

**Interfaces:**
- Consumes: `CanaryEvaluation` from Task 6.
- Produces: one `TradeSubmitResult SubmitProtectedMarketOrder(...)` function.
- This is the only repository file in Plan 3 allowed to contain `OrderCheck` or `OrderSend`.

- [ ] **Step 1: Strengthen the source test before adding the gateway**

Assert every MQL/MQH file except `JmbCanaryTradeGateway.mqh` contains neither `OrderSend` nor `OrderCheck`, the gateway contains exactly one `OrderSend(` call, and no source contains a live-mode input, EURUSD execution allowlist, martingale/grid/recovery, or volume above `0.01`.

- [ ] **Step 2: Run the source test and verify RED**

Run: `pnpm vitest run src/domain/mt5/demo-canary-source.spec.ts`

Expected: FAIL because the gateway does not exist.

- [ ] **Step 3: Implement the only order gateway**

```cpp
struct TradeSubmitResult
{
   bool sent;
   uint retcode;
   ulong order_ticket;
   ulong deal_ticket;
   string detail;
};

bool ResolveMarketFilling(const string symbol,ENUM_ORDER_TYPE_FILLING &resolved)
{
   long flags=SymbolInfoInteger(symbol,SYMBOL_FILLING_MODE);
   long execution=SymbolInfoInteger(symbol,SYMBOL_TRADE_EXEMODE);
   if((flags&SYMBOL_FILLING_FOK)==SYMBOL_FILLING_FOK) { resolved=ORDER_FILLING_FOK; return true; }
   if((flags&SYMBOL_FILLING_IOC)==SYMBOL_FILLING_IOC) { resolved=ORDER_FILLING_IOC; return true; }
   if(execution!=SYMBOL_TRADE_EXECUTION_MARKET) { resolved=ORDER_FILLING_RETURN; return true; }
   return false;
}

TradeSubmitResult SubmitProtectedMarketOrder(const CanaryDecision &decision,const CanaryPolicy &policy)
{
   TradeSubmitResult result;
   ZeroMemory(result);
   if(AccountInfoInteger(ACCOUNT_TRADE_MODE)!=ACCOUNT_TRADE_MODE_DEMO)
   {
      result.detail="Account is not demo";
      return result;
   }
   MqlTradeRequest request={};
   MqlTradeCheckResult check={};
   MqlTradeResult broker={};
   request.action=TRADE_ACTION_DEAL;
   request.magic=policy.magic_number;
   request.symbol=decision.symbol;
   request.volume=0.01;
   request.type=decision.direction=="buy" ? ORDER_TYPE_BUY : ORDER_TYPE_SELL;
   request.price=decision.direction=="buy" ? SymbolInfoDouble(decision.symbol,SYMBOL_ASK) : SymbolInfoDouble(decision.symbol,SYMBOL_BID);
   request.sl=decision.stop_loss;
   if(!ResolveMarketFilling(decision.symbol,request.type_filling))
   {
      result.detail="No supported market filling mode";
      return result;
   }
   request.deviation=(ulong)MathFloor(policy.max_deviation_price/SymbolInfoDouble(decision.symbol,SYMBOL_POINT));
   request.comment="JMB:"+StringSubstr(decision.decision_id,0,20);
   if(!OrderCheck(request,check) || check.retcode!=0)
   {
      result.retcode=check.retcode;
      result.detail=check.comment;
      return result;
   }
   result.sent=OrderSend(request,broker);
   result.retcode=broker.retcode;
   result.order_ticket=broker.order;
   result.deal_ticket=broker.deal;
   result.detail=broker.comment;
   return result;
}
```

Do not interpret `OrderSend=true` as a fill. The caller records `order_requesting` before the call, flushes the event, invokes the gateway once, and always moves to broker reconciliation.

- [ ] **Step 4: Wire the gateway behind all dry-run gates**

The EA calls the gateway only when `InpDemoExecutionEnabled=true`, kill switch is off, lifecycle is `ready`, event journal flush succeeded, and the observation has no prior attempt. Store the attempted observation before any possible retry path. `OnTradeTransaction` only marks reconciliation dirty and returns.

- [ ] **Step 5: Run source and TypeScript regression tests**

Run: `pnpm vitest run src/domain/mt5/demo-canary-source.spec.ts src/domain/mt5/execution-status.spec.ts`

Expected: PASS.

Run: `rg -n "OrderSend|OrderCheck" tools/mt5/JmbGoldmineDemoCanary`

Expected: matches only `JmbCanaryTradeGateway.mqh`.

- [ ] **Step 6: Ask the operator to compile manually with execution disabled**

Acceptance is `0 errors, 0 warnings`. The operator attaches it to an HFM demo Gold duplicate chart with `InpDemoExecutionEnabled=false` and `InpKillSwitch=true`; status must remain `disabled` and zero orders must be created.

- [ ] **Step 7: Commit Task 7**

```powershell
git add -- tools/mt5/JmbGoldmineDemoCanary/JmbCanaryTradeGateway.mqh tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5 src/domain/mt5/demo-canary-source.spec.ts
git commit -m "feat: add protected mt5 demo order gateway"
```

---

### Task 8: Reconcile fills, protection, closures, and daily loss

**Files:**
- Create: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryReconcile.mqh`
- Modify: `tools/mt5/JmbGoldmineDemoCanary/JmbCanaryState.mqh`
- Modify: `tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5`
- Modify: `tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5`
- Modify: `src/domain/mt5/execution-status.spec.ts`

**Interfaces:**
- Consumes: magic, symbol, decision/observation IDs, broker orders/deals/positions.
- Produces: authoritative lifecycle events and daily-loss state.
- Produces: append-only `OpenAliceMt5ExecutionV1/<broker>/XAUUSD/events.jsonl` with this stable event shape:

```ts
interface JmbExecutionEventV1 {
  schema_version: 1
  event_id: string
  event_type: JmbExecutionLifecycleState
  event_time: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  account_mode: 'demo'
  account_identity_masked: string
  symbol: 'XAUUSD'
  strategy_version: 'daily-trend-v1'
  magic_number: 880101 | 880201
  decision_id: string
  observation_id: string
  gate_results: JmbGateResult[]
  calculated_risk: number | null
  requested_volume: number | null
  requested_price: number | null
  requested_stop_loss: number | null
  accepted_volume: number | null
  accepted_price: number | null
  accepted_stop_loss: number | null
  result_code: string
  result_detail: string
  order_ticket: string
  deal_ticket: string
  position_id: string
  reconciliation_state: string
  daily_loss_count: number
  daily_realized_loss: number
  commission: number | null
  swap: number | null
  fee: number | null
  net_result: number | null
  max_adverse_excursion: number | null
  max_favorable_excursion: number | null
}
```

`account_identity_masked` is derived locally and must never equal the raw login. Ticket and position identifiers remain strings to avoid numeric precision loss.

- [ ] **Step 1: Add failing transition and daily-reset harness scenarios**

Add table cases for rejected request, unknown result, partial fill, filled-with-stop, filled-without-stop, stopped observation, opposite-signal close, four losing positions, server-day reset, restart with protected position, and restart with foreign exposure. Expected next states must exactly match the design lifecycle union.

- [ ] **Step 2: Add failing TypeScript fixtures for reconciliation states**

`execution-status.spec.ts` must parse `reconciliation_required`, `filled_protected`, `stopped`, and `emergency_close`, and must reject a status that claims `filled_protected` while `stop_protection_confirmed=0`.

- [ ] **Step 3: Implement authoritative reconciliation**

Scan orders/positions by symbol and classify JMB versus foreign using magic number. Do not use account-wide `PositionsTotal()>0`. Query history by server-day range, group fully closed results by `DEAL_POSITION_ID`, and calculate net as `DEAL_PROFIT + DEAL_COMMISSION + DEAL_SWAP + DEAL_FEE`. Attribute loss to the server day of final closure.

```cpp
double DealNet(const ulong deal_ticket)
{
   return HistoryDealGetDouble(deal_ticket,DEAL_PROFIT)
      +HistoryDealGetDouble(deal_ticket,DEAL_COMMISSION)
      +HistoryDealGetDouble(deal_ticket,DEAL_SWAP)
      +HistoryDealGetDouble(deal_ticket,DEAL_FEE);
}
```

- [ ] **Step 4: Implement protection and unknown-result rules**

Only broker-confirmed exposure with a nonzero valid stop may enter `filled_protected`. Unknown/timeout/partial results enter `reconciliation_required` and forbid another send. An unprotected EA-owned fill triggers the explicit emergency protective close, logs every attempt, and pauses the broker; it never opens replacement exposure.

- [ ] **Step 5: Implement same-direction, reversal, and consumed-observation behavior**

Same-direction observation is a durable no-op. An opposite observation closes the existing EA-owned position, waits for confirmed closure, flushes the close event, re-evaluates every entry gate, and only then may submit the new side once. A stopped observation is consumed and cannot re-enter until `observationAsOf` advances.

- [ ] **Step 6: Run all source/parser tests and manual harness**

Run: `pnpm vitest run src/domain/mt5/demo-canary-source.spec.ts src/domain/mt5/execution-status.spec.ts`

Expected: PASS.

The operator compiles and runs the harness. Expected Experts output ends with `JMB_CANARY_HARNESS PASS` and MetaEditor reports `0 errors, 0 warnings`.

- [ ] **Step 7: Commit Task 8**

```powershell
git add -- tools/mt5/JmbGoldmineDemoCanary/JmbCanaryReconcile.mqh tools/mt5/JmbGoldmineDemoCanary/JmbCanaryState.mqh tools/mt5/JmbGoldmineDemoCanary/JmbGoldmineDemoCanary.mq5 tools/mt5/tests/JmbGoldmineDemoCanaryHarness.mq5 src/domain/mt5/execution-status.spec.ts
git commit -m "feat: reconcile mt5 demo canary outcomes"
```

---

### Task 9: Import reconciled EA outcomes into the learning ledger

**Files:**
- Create: `src/domain/mt5/execution-outcomes.ts`
- Create: `src/domain/mt5/execution-outcomes.spec.ts`
- Create: `src/task/mt5-outcome-importer.ts`
- Create: `src/task/mt5-outcome-importer.spec.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `OpenAliceMt5ExecutionV1/<broker>/XAUUSD/events.jsonl` written by Tasks 6-8.
- Produces: `importReconciledExecutionOutcomes(options) => Promise<ExecutionOutcomeImportResult[]>`.
- Learning root: `~/.openalice/data/research/mt5-execution-learning/<broker>/XAUUSD/`.
- The importer receives only execution and learning roots; it has no policy, decision, EA-input, or broker write interface.

- [ ] **Step 1: Write failing terminal-outcome and idempotency tests**

```ts
it('imports one fully reconciled close exactly once', async () => {
  await writeExecutionEvents(executionRoot, [requestEvent, fillEvent, closedEvent])
  await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })
  await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })
  const records = await readExecutionLearningRecords(learningRoot, 'hfmarkets', 'XAUUSD')
  expect(records).toHaveLength(1)
  expect(records[0]).toMatchObject({
    decisionId: closedEvent.decision_id,
    outcomeEventId: closedEvent.event_id,
    result: 'loss',
    netResult: -6.25,
    source: 'ea_demo',
  })
})

it('does not import an unresolved or unprotected exposure', async () => {
  await writeExecutionEvents(executionRoot, [requestEvent, reconciliationRequiredEvent])
  const result = await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })
  expect(result[0].imported).toBe(0)
})
```

- [ ] **Step 2: Run the outcome tests and verify RED**

Run: `pnpm vitest run src/domain/mt5/execution-outcomes.spec.ts src/task/mt5-outcome-importer.spec.ts`

Expected: FAIL because both modules do not exist.

- [ ] **Step 3: Implement the strict immutable outcome contract**

```ts
export interface JmbExecutionOutcomeRecord {
  schemaVersion: 1
  outcomeEventId: string
  outcomeAt: string
  broker: 'hfmarkets' | 'icmarkets'
  server: 'HFMarketsGlobal-Demo4' | 'ICMarketsSC-Demo'
  accountMode: 'demo'
  symbol: 'XAUUSD'
  strategyVersion: 'daily-trend-v1'
  decisionId: string
  observationId: string
  positionId: string
  result: 'win' | 'loss' | 'breakeven'
  netResult: number
  commission: number
  swap: number
  fee: number
  requestedPrice: number | null
  acceptedPrice: number | null
  slippage: number | null
  maxAdverseExcursion: number | null
  maxFavorableExcursion: number | null
  source: 'ea_demo'
}

export interface ExecutionOutcomeImportOptions {
  executionRoot: string
  learningRoot: string
  instruments: readonly Pick<JmbDemoInstrumentConfig, 'broker' | 'server' | 'symbol'>[]
}

export interface ExecutionOutcomeImportResult {
  broker: 'hfmarkets' | 'icmarkets'
  symbol: 'XAUUSD'
  state: 'imported' | 'no_new_outcome' | 'blocked' | 'error'
  imported: number
  detail: string
}
```

Parse physical JSONL lines independently and fail closed on malformed schema, non-demo mode, non-Gold symbol, unknown lifecycle, non-finite money fields, or missing identifiers. Only a fully reconciled terminal `closed` or `stopped` event may become a learning outcome. Derive `result` from the reconciled net result after commission, swap, and fee. Never mutate the original decision or execution event.

- [ ] **Step 4: Implement append-once learning persistence**

```ts
export async function appendOutcomeOnce(root: string, record: JmbExecutionOutcomeRecord): Promise<boolean> {
  const records = await readExecutionLearningRecords(root, record.broker, record.symbol)
  if (records.some((item) => item.outcomeEventId === record.outcomeEventId)) return false
  await appendDurableJsonLine(outcomeJournalPath(root, record.broker, record.symbol), record)
  await writeJsonAtomically(outcomeSummaryPath(root, record.broker, record.symbol), summarizeOutcomes([...records, record]))
  return true
}
```

The summary contains counts, total net, win/loss/breakeven counts, cost totals, average slippage, and latest outcome time. It is evidence only and contains no approval flag, new risk limit, strategy parameter, or profit prediction.

- [ ] **Step 5: Add the isolated five-minute importer**

```ts
export interface JmbMt5OutcomeImporter {
  start(): Promise<void>
  stop(): void
  runNow(): Promise<void>
}

export function createJmbMt5OutcomeImporter(options: {
  runCycle: () => Promise<ExecutionOutcomeImportResult[]>
  every?: string
}): JmbMt5OutcomeImporter {
  const pump = createPump({
    name: 'jmb-mt5-outcome-import',
    every: options.every ?? '5m',
    serial: true,
    onTick: async () => { await options.runCycle() },
  })
  return {
    async start() { await pump.runNow(); pump.start() },
    stop() { pump.stop() },
    runNow() { return pump.runNow() },
  }
}
```

Wire it in `src/main.ts` after the decision scheduler. Start with one catch-up import, run serially, isolate broker failures, and stop it during shutdown. It may write only the learning root.

- [ ] **Step 6: Run outcome and boundary verification**

Run: `pnpm vitest run src/domain/mt5/execution-outcomes.spec.ts src/task/mt5-outcome-importer.spec.ts`

Expected: PASS.

Run: `rg -n "policyRoot|OrderSend|OrderCheck|child_process|openai|anthropic|llm" src/domain/mt5/execution-outcomes.ts src/task/mt5-outcome-importer.ts`

Expected: no matches.

- [ ] **Step 7: Commit Task 9**

```powershell
git add -- src/domain/mt5/execution-outcomes.ts src/domain/mt5/execution-outcomes.spec.ts src/task/mt5-outcome-importer.ts src/task/mt5-outcome-importer.spec.ts src/main.ts
git commit -m "feat: import reconciled mt5 demo outcomes"
```

---

### Task 10: Document and verify Stage 0 readiness

**Files:**
- Modify: `tools/mt5/README.md`
- Modify: `docs/mt5-data-and-training-protocol.md`
- Modify: `docs/PRD.md`

**Interfaces:**
- Produces: operator ceremony for installation, dry-run, HFM canary, IC canary, rollback, pause, and recovery.

- [ ] **Step 1: Document exact operator steps**

Document bridge recompilation for completed-D1 export, policy-script use, folder paths, EA copy layout, MetaEditor compile, harness run, status-only attach, HFM inputs, IC inputs, rollout stages, kill switch, expected status files, rollback to `JmbGoldmineDemoRiskShell`, and emergency verification. Name the staged ceremonies exactly “HFM canary” and “IC Markets canary.” Explicitly state that Codex does not launch MetaEditor and that live/EURUSD execution is absent.

Update `docs/PRD.md` without rewriting unrelated sections:

- In Current State, replace the claim that all MT5 work is research-only with the truthful split: the Research Desk and bridge are read-only; the separately installed Plan 3 EA may execute Gold on exact demo accounts only after local operator enablement.
- In R6, link the approved Plan 3 design and restate HFM-first, IC-second, EURUSD-shadow-only, no-live scope.
- In R7, clarify that UTA approval governs app/API/AI-managed orders, while the independently approved broker-local MT5 demo EA is governed by R6 and exposes no remote order command.
- In Success Criteria, require zero Research/AI execution endpoints, both demo-account bindings, broker-confirmed stop protection, and HFM evidence before IC promotion.

- [ ] **Step 2: Run the complete TypeScript test slice**

Run:

```powershell
pnpm vitest run src/domain/mt5 src/task/mt5-decision-scheduler.spec.ts src/task/mt5-outcome-importer.spec.ts src/webui/routes/research.spec.ts ui/src/components/research/__tests__/Mt5ExecutionStatusCard.spec.tsx
```

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run builds**

Run: `pnpm -F open-alice-ui build`

Expected: PASS.

Run: `pnpm -F open-alice-ui build:demo`

Expected: PASS.

Run: `pnpm build`

Expected: PASS.

- [ ] **Step 4: Run mandatory safety scans**

Run:

```powershell
rg -n "live.?mode|ACCOUNT_TRADE_MODE_REAL|EURUSD|martingale|grid|recovery|lot.?growth" tools/mt5/JmbGoldmineDemoCanary src/domain/mt5/demo-canary-source.spec.ts
```

Expected: no live-mode input/bypass, no EURUSD allowlist, and no martingale/grid/recovery/lot-growth implementation. A negative `ACCOUNT_TRADE_MODE_REAL` rejection test is allowed.

Run:

```powershell
rg -n "OrderSend|OrderCheck" tools/mt5/JmbGoldmineDemoCanary
```

Expected: matches only `JmbCanaryTradeGateway.mqh`.

Run:

```powershell
rg -n "accountLogin|account_login|expectedAccountLogin|expected_account_login" src/webui/routes/research.ts ui/src/api/research.ts ui/src/pages/ResearchDashboardPage.tsx ui/src/components/research ui/src/demo/handlers/research.ts
```

Expected: no matches.

- [ ] **Step 5: Verify Stage 0 on both demo terminals**

The operator compiles with `0 errors, 0 warnings`, attaches HFM and IC Gold with execution disabled and kill switch on, and confirms current status files update for at least two timer cycles with zero orders and zero new positions. Fresh completed-D1 files must use a date later than the stale `2026-06-23` artifact before any canary stage can be considered.

- [ ] **Step 6: Commit Task 10**

```powershell
git add -- tools/mt5/README.md docs/mt5-data-and-training-protocol.md docs/PRD.md
git commit -m "docs: add mt5 demo canary operations"
```

---

## Post-Implementation Human Gates

These are operational promotion gates, not code tasks and not automatic scheduler actions.

1. Review Stage 0 evidence and leave both EAs execution-disabled if any gate differs from the existing status-only shell.
2. Build an HFM `canary_ready` cost model and write HFM `hfm_canary` policy using the operator-only script.
3. Explicitly set the HFM expected demo account login locally, set `InpDemoExecutionEnabled=true`, and turn off the HFM kill switch.
4. Verify one HFM decision through durable pre-request event, broker result, stop protection, and restart reconciliation.
5. If HFM evidence passes, write IC `ic_canary` policy and repeat the ceremony on IC Markets.
6. Only after both canaries pass, write `both_demo` policies. EURUSD remains shadow-only.
7. Any unprotected fill, unknown result, reconciliation mismatch, non-demo identity, or missing cost evidence returns the affected broker to `status_only`.
