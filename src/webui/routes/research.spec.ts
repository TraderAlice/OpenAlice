import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { EngineContext } from '../../core/types.js'
import type { JmbExecutionStatusSummary } from '../../domain/mt5/execution-status.js'
import { createResearchRoutes } from './research.js'

const HEADER = 'schema_version,captured_at,broker,server,account_mode,symbol,state,detail,rollout_stage,execution_enabled,kill_switch,decision_id,observation_id,event_id,event_type,event_time,result_code,result_detail,stop_protection_confirmed,position_direction,position_volume,position_open_price,position_stop_loss,position_id,reconciliation_state,daily_loss_count,daily_realized_loss,blocking_gate,next_safe_action'

function statusCsv(capturedAt: string): string {
  return `${HEADER}\n${[
    '1', capturedAt, 'hfmarkets', 'HFMarketsGlobal-Demo4', 'demo', 'XAUUSD', 'filled_protected',
    'Broker confirms protected demo exposure.', 'hfm_canary', '1', '0', 'decision-1', 'observation-1',
    'event-1', 'fill_confirmed', capturedAt, '10009', 'Request completed', '1', 'buy', '0.01',
    '3334.25', '3324.25', 'position-1', 'reconciled', '1', '-8.75', '', 'Monitor protection.',
  ].join(',')}\n`
}

type ResearchResponse = {
  mode: string
  tradingEnabled: boolean
  stages: Array<{ key: string; detail: string }>
  instruments: Array<{ broker: string; symbol: string; execution: JmbExecutionStatusSummary }>
}

describe('GET /', () => {
  let executionRoot: string

  beforeEach(async () => {
    executionRoot = await mkdtemp(join(tmpdir(), 'openalice-research-route-'))
  })

  afterEach(async () => {
    await rm(executionRoot, { recursive: true, force: true })
  })

  it('projects Gold status and blocks EURUSD without exposing account login', async () => {
    const directory = join(executionRoot, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'latest_status.csv'), statusCsv(new Date().toISOString()), 'utf8')
    const app = createResearchRoutes({} as EngineContext, { executionRoot })

    const response = await app.request('/')
    const body = await response.json() as ResearchResponse
    const hfmGold = body.instruments.find((instrument) => instrument.broker === 'hfmarkets' && instrument.symbol === 'XAUUSDb')
    const hfmEuro = body.instruments.find((instrument) => instrument.broker === 'hfmarkets' && instrument.symbol === 'EURUSDb')

    expect(response.status).toBe(200)
    expect(body.mode).toBe('research_only')
    expect(body.tradingEnabled).toBe(false)
    expect(body.stages.find((stage) => stage.key === 'demo')?.detail).toMatch(/broker-local/i)
    expect(hfmGold?.execution).toMatchObject({ state: 'filled_protected', symbol: 'XAUUSD' })
    expect(hfmEuro?.execution).toMatchObject({ state: 'demo_blocked', label: 'DEMO BLOCKED', symbol: 'EURUSD' })
    expect(JSON.stringify(body)).not.toMatch(/accountLogin|account_login/i)
  })

  it('fails closed and drops a sentinel login from a malformed status artifact', async () => {
    const directory = join(executionRoot, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    const malformed = statusCsv(new Date().toISOString())
      .replace('symbol,state', 'account_login,symbol,state')
      .replace(',hfmarkets,HFMarkets', ',hfmarkets,SENTINEL-LOGIN-884422,HFMarkets')
    await writeFile(join(directory, 'latest_status.csv'), malformed, 'utf8')
    const app = createResearchRoutes({} as EngineContext, { executionRoot })

    const response = await app.request('/')
    const serialized = JSON.stringify(await response.json())

    expect(serialized).toContain('malformed')
    expect(serialized).not.toContain('SENTINEL-LOGIN-884422')
    expect(serialized).not.toMatch(/accountLogin|account_login/i)
  })
})
