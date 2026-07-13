import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CANARY_DIRECTORY = join('tools', 'mt5', 'JmbGoldmineDemoCanary')

async function readCanarySource(file: string): Promise<string> {
  return readFile(join(CANARY_DIRECTORY, file), 'utf8')
}

async function readMqlSources(directory: string): Promise<Array<{ path: string; source: string }>> {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map(async (entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return readMqlSources(path)
    if (!/\.mq[5h]$/i.test(entry.name)) return []
    return [{ path, source: await readFile(path, 'utf8') }]
  }))
  return nested.flat()
}

async function readCanarySources(): Promise<Array<{ path: string; source: string }>> {
  return readMqlSources(CANARY_DIRECTORY)
}

async function readCanaryBundle(): Promise<string> {
  return (await readCanarySources()).map(({ source }) => source).join('\n')
}

describe('MT5 demo canary source contract', () => {
  it('has one protected gateway and keeps every other MQL source order-API-free', async () => {
    const sources = await readMqlSources(join('tools', 'mt5'))
    const gatewayPath = join(CANARY_DIRECTORY, 'JmbCanaryTradeGateway.mqh')
    const gateway = sources.find(({ path }) => path === gatewayPath)

    expect(gateway, 'the protected-order gateway must exist').toBeDefined()
    expect(gateway?.source.match(/\bOrderCheck\s*\(/g)).toHaveLength(1)
    expect(gateway?.source.match(/\bOrderSend\s*\(/g)).toHaveLength(1)
    expect(gateway?.source).not.toMatch(/\bCTrade\b/)
    for (const file of sources.filter(({ path }) => path !== gatewayPath)) {
      expect(file.source, `${file.path} must not call an order API`).not.toMatch(/\bOrder(?:Check|Send)\s*\(/)
      expect(file.source, `${file.path} must not use CTrade`).not.toMatch(/\bCTrade\b/)
    }
  })

  it('keeps execution disabled, demo-only, Gold-only, fixed-volume, and non-expanding', async () => {
    const [sources, gateway, types] = await Promise.all([
      readCanarySources(),
      readCanarySource('JmbCanaryTradeGateway.mqh'),
      readCanarySource('JmbCanaryTypes.mqh'),
    ])
    const source = sources.map((file) => file.source).join('\n')

    expect(source).toContain('input bool InpDemoExecutionEnabled = false;')
    expect(source).toContain('input bool InpKillSwitch = true;')
    for (const file of sources) {
      expect(file.source, `${file.path} must not add a live-mode input`).not.toMatch(/input[^;]*(?:live|real)/i)
      expect(file.source, `${file.path} must remain Gold-only and non-expanding`).not.toMatch(
        /EURUSD|martingale|grid|recovery|take.?profit|\b(?:tp|take_profit)\s*=|lot.?growth|volume.?growth|scale.?in|pyramid/i,
      )
      for (const match of file.source.matchAll(/\b(?:volume|maxVolume|max_volume)\s*=\s*(\d+(?:\.\d+)?)/g)) {
        expect(Number(match[1]), `${file.path} must not assign volume above 0.01`).toBeLessThanOrEqual(0.01)
      }
      for (const match of file.source.matchAll(/\b(?:volume|maxVolume|max_volume)\s*=(?!=)\s*([^;\r\n]+)/g)) {
        expect(match[1], `${file.path} must not scale a volume assignment`).not.toMatch(/[*/+-]/)
      }
    }
    expect(types).toMatch(/const double CANARY_HARD_MAX_VOLUME\s*=\s*0\.01;/)
    expect(gateway).toContain('ACCOUNT_TRADE_MODE_DEMO')
    expect(gateway).toContain('decision.symbol!="XAUUSD"')
    expect(gateway).toContain('decision.volume!=CANARY_HARD_MAX_VOLUME')
    expect([...gateway.matchAll(/request\.volume\s*=\s*([^;]+);/g)].map((match) => match[1].trim()))
      .toEqual(['CANARY_HARD_MAX_VOLUME'])
    expect(gateway).not.toMatch(/(?:request\.volume\s*(?:\*=|\/=|\+=|-=)|(?:\+\+|--)request\.volume|request\.volume(?:\+\+|--))/)
    expect(gateway).toContain('request.sl=decision.stopLoss;')
    expect(gateway).toMatch(/policy\.magicNumber!=880101\s*&&\s*policy\.magicNumber!=880201/)
  })

  it('persists requesting and attempt barriers before one submit then defers every result to reconciliation', async () => {
    const main = await readCanarySource('JmbGoldmineDemoCanary.mq5')
    const submissionFlow = main.match(/void SubmitReadyCanaryDecision\([\s\S]*?\n\}/)?.[0] ?? ''
    const eventBarrier = submissionFlow.indexOf('AppendCanaryOrderRequestingEvent(')
    const attemptBarrier = submissionFlow.indexOf('PersistCanaryAttempt(')
    const submit = submissionFlow.indexOf('SubmitProtectedMarketOrder(')

    expect(main).toContain('#include "JmbCanaryTradeGateway.mqh"')
    expect(main).toContain('evaluation.state!=CANARY_LIFECYCLE_READY')
    expect(main).toContain('!InpDemoExecutionEnabled || InpKillSwitch')
    expect(main).toContain('if(!status_persisted)')
    expect(main).toContain('CanaryProcessedStateContains(processed_state,decision.decisionId,decision.observationId)')
    expect(eventBarrier).toBeGreaterThan(-1)
    expect(attemptBarrier).toBeGreaterThan(eventBarrier)
    expect(submit).toBeGreaterThan(attemptBarrier)
    expect(main).toMatch(/AppendCanaryOrderRequestingEvent\([\s\S]*FileFlush\(handle\)[\s\S]*ReadCanaryCommonText/)
    expect(main).toMatch(/PersistCanaryAttempt\([\s\S]*FileFlush\(handle\)[\s\S]*LoadCanaryProcessedState/)
    expect(main).toContain('processed_observations.lock')
    expect(main).toMatch(/PersistCanaryAttempt\([\s\S]*FileOpen\(lock_path[\s\S]*LoadCanaryProcessedState\(path,locked_state/)
    expect(main.match(/SubmitProtectedMarketOrder\s*\(/g)).toHaveLength(1)
    expect(main).toContain('g_reconciliation_dirty=true;')
    expect(main).toContain('environment.reconciliationComplete=!g_reconciliation_dirty')
    expect(main).toContain('void OnTradeTransaction(')
    expect(main).not.toMatch(/filled_protected/)
    expect(main).not.toMatch(/\b(?:retry|resend)\b/i)
  })

  it('rejects durable replacements that drop, mutate, reorder, duplicate, or truncate prior attempts', async () => {
    const main = await readCanarySource('JmbGoldmineDemoCanary.mq5')
    const submissionFlow = main.match(/void SubmitReadyCanaryDecision\([\s\S]*?\n\}/)?.[0] ?? ''

    expect(main).toContain('bool CanaryProcessedStateIsExactAppend(')
    expect(main).toMatch(/CanaryProcessedStateIsExactAppend\([\s\S]*candidate_count!=prior_count\+1/)
    expect(main).toMatch(/CanaryProcessedStateIsExactAppend\([\s\S]*candidate\.decisionIds\[index\]!=prior\.decisionIds\[index\][\s\S]*candidate\.observationIds\[index\]!=prior\.observationIds\[index\][\s\S]*candidate\.attemptedAt\[index\]!=prior\.attemptedAt\[index\]/)
    expect(main).toMatch(/candidate\.decisionIds\[prior_count\]==decision\.decisionId[\s\S]*candidate\.observationIds\[prior_count\]==decision\.observationId[\s\S]*candidate\.attemptedAt\[prior_count\]==attempted_at/)
    expect(main).toContain('CanaryProcessedStateIsExactAppend(locked_state,temporary_state,decision,attempted_at)')
    expect(main).toContain('CanaryProcessedStateIsExactAppend(locked_state,durable_state,decision,attempted_at)')
    expect(submissionFlow).toMatch(/if\(!PersistCanaryAttempt\([\s\S]*?\n\s*return;\n\s*\}[\s\S]*TradeSubmitResult submission=SubmitProtectedMarketOrder/)
  })

  it('keeps risk evaluation pure while retaining broker-side calculation evidence', async () => {
    const source = await readCanaryBundle()

    expect(source).toContain('CanaryEvaluation EvaluateCanaryGates(')
    expect(source).toContain('OrderCalcProfit(')
    expect(source).toContain('OrderCalcMargin(')
    expect(source).toContain('CalendarValueHistory(')
    expect(source).toContain('FileMove(temporary_path, FILE_COMMON, destination_path, FILE_COMMON | FILE_REWRITE)')
    expect(source).toContain('FileFlush(handle)')
  })

  it('binds the exact policy, decision, status, and harness safety contracts', async () => {
    const source = await readCanaryBundle()

    expect(source).toContain('HFMarketsGlobal-Demo4')
    expect(source).toContain('ICMarketsSC-Demo')
    expect(source).toContain('daily-trend-v1')
    expect(source).toContain('880101')
    expect(source).toContain('880201')
    expect(source).toContain('schema_version,decision_id,observation_id,observation_as_of,created_at,lease_issued_at,lease_expires_at,broker,server,account_mode,symbol,strategy_version,direction,entry_reference_price,volume,stop_loss,max_risk_amount,candidate_policy_version,cost_model_version,gate_results_json')
    expect(source).toContain('schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action')
    expect(source).not.toMatch(/FileWrite\([^;]*InpExpectedAccountLogin/s)
    expect(source).not.toMatch(/(?:Print|Comment)\([^;]*InpExpectedAccountLogin/s)
  })

  it('strictly validates policy grammar, gate JSON, and Task 3 hash identities', async () => {
    const [csv, policy, harness] = await Promise.all([
      readCanarySource('JmbCanaryCsv.mqh'),
      readCanarySource('JmbCanaryPolicy.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(policy).toContain('bool IsCanonicalCanaryPolicyVersion(')
    expect(policy).toContain('StringFind(value,",")')
    expect(policy).toContain('StringFind(value,"\\\"")')
    expect(csv).toContain('bool ParseCanaryGateResultsJson(')
    expect(csv).toContain('CRYPT_HASH_SHA256')
    expect(csv).toContain('CreateCanaryObservationId(')
    expect(csv).toContain('CreateCanaryDecisionId(')
    expect(csv).toContain('decision.observationId!=CreateCanaryObservationId(decision)')
    expect(csv).toContain('decision.decisionId!=CreateCanaryDecisionId(decision)')
    expect(harness).toContain('arbitrary decision ids')
    expect(harness).toContain('malformed gate JSON')
    expect(harness).toContain('unknown gate name')
    expect(harness).toContain('unknown gate state')
    expect(harness).toContain('unknown gate field')
    expect(harness).toContain('duplicate gate field')
    expect(harness).toContain('missing gate field')
    expect(harness).toContain('noncanonical gate evidence')
    expect(harness).toContain('policy version grammar')
  })

  it('exports Task 5-compatible effective enablement and loads durable attempt state', async () => {
    const [main, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(state).toContain('schema_version,decision_id,observation_id,attempted_at')
    expect(state).toContain('processed_observations.csv')
    expect(state).toContain('bool LoadCanaryProcessedState(')
    expect(state).toContain('CanarySha256Identity("daily-trend-v1|"+values[2])')
    expect(main).toContain('LoadCanaryProcessedState(')
    expect(main).toContain('bool effective_execution_enabled=')
    expect(state).toContain('policy.rolloutStage!="status_only"')
    expect(state).toContain('if(policy.rolloutStage=="status_only" && execution_enabled) return false;')
    expect(main).not.toMatch(/WriteCanaryLatestStatus\([^;]*InpDemoExecutionEnabled/s)
    expect(harness).toContain('loaded duplicate state')
    expect(harness).toContain('malformed processed state')
  })

  it('requires broker-valid stop metadata, checked writes, and a working timer', async () => {
    const [main, state, harness] = await Promise.all([
      readCanarySource('JmbGoldmineDemoCanary.mq5'),
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(main).toContain('SYMBOL_ORDER_MODE')
    expect(main).toContain('SYMBOL_ORDER_SL')
    expect(main).toContain('SYMBOL_TRADE_TICK_SIZE')
    expect(main).toContain('if(!EventSetTimer(10))')
    expect(state).toContain('uint preflight_written=FileWriteString(handle,payload)')
    expect(state).toContain('if(preflight_written!=StringLen(payload))')
    expect(state).toContain('uint header_written=FileWrite(')
    expect(state).toContain('uint row_written=FileWrite(')
    expect(state).toContain('ReadStrictCanaryCsv(temporary_path')
    expect(harness).toContain('stop mode unsupported')
    expect(harness).toContain('stop tick unavailable')
    expect(harness).toContain('stop tick misaligned')
  })

  it('rejects physical policy quotes without weakening quoted decision CSV', async () => {
    const [csv, policy, harness] = await Promise.all([
      readCanarySource('JmbCanaryCsv.mqh'),
      readCanarySource('JmbCanaryPolicy.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(csv).toContain('bool ReadStrictCanaryCsvText(')
    expect(csv).toMatch(/bool ReadCanaryDecision\([\s\S]*ReadStrictCanaryCsv\(path,expected,values,detail\)/)
    expect(policy).toContain('bool ParseCanaryPolicyCsvText(')
    expect(policy).toContain('StringFind(policy_text,"\\\"")>=0')
    expect(policy).toContain('ReadStrictCanaryCsvText(policy_text')
    expect(harness).toContain('fully quoted policy row')
    expect(harness).toContain('partially quoted policy row')
  })

  it('verifies exact reopened preflight and all intended status fields', async () => {
    const [state, harness] = await Promise.all([
      readCanarySource('JmbCanaryState.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(state).toContain('const string payload="openalice-canary-preflight\\r\\n";')
    expect(state).toContain('ReadCanaryCommonText(path,reopened,read_detail)')
    expect(state).toContain('reopened!=payload')
    expect(state).toContain('bool CanaryExactValuesMatch(')
    expect(state).toContain('CanaryExactValuesMatch(intended_values,verified_values)')
    expect(harness).toContain('truncated next safe action')
  })

  it('decodes canonical JSON escapes and rejects malformed Unicode sequences', async () => {
    const [csv, harness] = await Promise.all([
      readCanarySource('JmbCanaryCsv.mqh'),
      readFile(join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'), 'utf8'),
    ])

    expect(csv).toContain('bool ParseCanaryUnicodeEscape(')
    expect(csv).toContain('escaped=="b"')
    expect(csv).toContain('escaped=="f"')
    expect(csv).toContain('escaped=="n"')
    expect(csv).toContain('escaped=="r"')
    expect(csv).toContain('escaped=="t"')
    expect(csv).toContain('escaped=="/"')
    expect(harness).toContain('canonical JSON escapes')
    expect(harness).toContain('invalid JSON escapes')
    expect(harness).toContain('invalid surrogate pairs')
  })
})
