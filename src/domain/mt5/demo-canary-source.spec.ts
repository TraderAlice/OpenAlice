import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const CANARY_DIRECTORY = join('tools', 'mt5', 'JmbGoldmineDemoCanary')
const CANARY_FILES = [
  join(CANARY_DIRECTORY, 'JmbGoldmineDemoCanary.mq5'),
  join(CANARY_DIRECTORY, 'JmbCanaryTypes.mqh'),
  join(CANARY_DIRECTORY, 'JmbCanaryCsv.mqh'),
  join(CANARY_DIRECTORY, 'JmbCanaryPolicy.mqh'),
  join(CANARY_DIRECTORY, 'JmbCanaryGates.mqh'),
  join(CANARY_DIRECTORY, 'JmbCanaryState.mqh'),
  join('tools', 'mt5', 'tests', 'JmbGoldmineDemoCanaryHarness.mq5'),
] as const

async function readCanaryBundle(): Promise<string> {
  const sources = await Promise.all(CANARY_FILES.map((path) => readFile(path, 'utf8')))
  return sources.join('\n')
}

async function readCanarySource(file: string): Promise<string> {
  return readFile(join(CANARY_DIRECTORY, file), 'utf8')
}

describe('MT5 demo canary source contract', () => {
  it('keeps the dry-run bundle order-free and safe by default', async () => {
    const source = await readCanaryBundle()

    expect(source).not.toMatch(/OrderSend|OrderCheck|CTrade|PositionClose/)
    expect(source).toContain('input bool InpDemoExecutionEnabled = false;')
    expect(source).toContain('input bool InpKillSwitch = true;')
    expect(source).not.toMatch(/live.?mode/i)
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
