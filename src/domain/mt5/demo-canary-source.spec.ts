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
})
