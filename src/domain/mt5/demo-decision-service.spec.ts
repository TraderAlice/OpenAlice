import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { parseExecutionDecisionCsv } from './execution-decision.js'
import {
  DEFAULT_JMB_DEMO_INSTRUMENTS,
  runDemoDecisionCycle,
  type JmbDemoInstrumentConfig,
} from './demo-decision-service.js'
import type { JmbMt5Roots } from './local-paths.js'

const now = new Date('2026-07-13T10:00:00.000Z')
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function roots(): Promise<JmbMt5Roots> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-demo-cycle-'))
  directories.push(root)
  return {
    bridgeRoot: join(root, 'OpenAliceMt5BridgeV1'),
    ledgerRoot: join(root, 'OpenAliceMt5TradeLedgerV1'),
    policyRoot: join(root, 'OpenAliceMt5DemoPolicyV1'),
    costModelRoot: join(root, 'OpenAliceMt5CostModelV1'),
    executionDecisionRoot: join(root, 'OpenAliceMt5ExecutionDecisionV1'),
    executionRoot: join(root, 'OpenAliceMt5ExecutionV1'),
    researchRoot: join(root, 'research'),
  }
}

function statusCsv(broker: string, server: string, symbol = 'XAUUSD'): string {
  return [
    'captured_at,broker,symbol,bridge_mode,account_mode,server,terminal_connected,trade_allowed,trade_expert,symbol_trade_mode,bid,ask,spread_price,tick_time,contract_size,volume_min,volume_max,volume_step,stops_level,open_positions,open_orders',
    `2026-07-13T09:59:30.000Z,${broker},${symbol},read_only,demo,${server},1,1,1,4,2399.9,2400.1,0.2,2026-07-13T09:59:30.000Z,100,0.01,100,0.01,10,0,0`,
  ].join('\n')
}

function completedD1Csv(broker: string, server: string, closes = [2300, 2350, 2400]): string {
  return [
    'schema_version,captured_at,broker,server,account_mode,symbol,bar_as_of,bar_open_epoch,open,high,low,close',
    ...closes.map((close, index) => `1,2026-07-13T09:59:30.000Z,${broker},${server},demo,XAUUSD,2026-07-${String(10 + index).padStart(2, '0')},${index + 1},${close},${close},${close},${close}`),
  ].join('\n')
}

function spreadCsv(broker: string, server: string): string {
  return [
    'schema_version,captured_at,broker,server,account_mode,symbol,bid,ask,spread,point,digits,contract_size,volume_min,volume_step,stops_level,freeze_level',
    ...Array.from({ length: 100 }, (_, index) => {
      const capturedAt = new Date(now.getTime() - (100 - index) * 60_000).toISOString()
      return `1,${capturedAt},${broker},${server},demo,XAUUSD,2399.9,2400.1,0.2,0.01,2,100,0.01,0.01,10,0`
    }),
  ].join('\n')
}

function ledgerCsv(broker: string, server: string): string {
  return [
    'account_mode,server,login,broker,symbol,deal_ticket,order_ticket,position_id,time,entry,type,reason,volume,price,commission,fee,swap,profit,magic,comment',
    `demo,${server},redacted,${broker},XAUUSD,1,1,1,2026-07-13T09:00:00.000Z,out,buy,expert,0.01,2390,-0.1,0,0,1,880101,JMB Goldmine`,
  ].join('\n')
}

function policyCsv(broker: 'hfmarkets' | 'icmarkets', server: string): string {
  const hfm = broker === 'hfmarkets'
  return [
    'schema_version,policy_version,broker,server,symbol,strategy_version,rollout_stage,candidate_approved,completed_observation_max_age_hours,max_spread,max_deviation,max_risk_amount,max_daily_loss,max_daily_losing_trades,max_volume,magic_number',
    `1,${broker}-canary-v1,${broker},${server},XAUUSD,daily-trend-v1,${hfm ? 'hfm_canary' : 'ic_canary'},1,72,${hfm ? '0.75' : '0.3'},${hfm ? '0.5' : '0.3'},10,40,4,0.01,${hfm ? '880101' : '880201'}`,
  ].join('\n')
}

async function writeReadyGoldFiles(
  rootsValue: JmbMt5Roots,
  instrument: JmbDemoInstrumentConfig,
  closes?: number[],
): Promise<void> {
  const bridgeDirectory = join(rootsValue.bridgeRoot, instrument.broker, 'XAUUSD')
  const ledgerDirectory = join(rootsValue.ledgerRoot, instrument.broker, 'XAUUSD')
  const policyDirectory = join(rootsValue.policyRoot, instrument.broker, 'XAUUSD')
  await Promise.all([bridgeDirectory, ledgerDirectory, policyDirectory, rootsValue.researchRoot].map((directory) => mkdir(directory, { recursive: true })))
  const statusPath = join(bridgeDirectory, 'status.csv')
  const completedPath = join(bridgeDirectory, 'completed_d1.csv')
  const ledgerPath = join(ledgerDirectory, 'deals.csv')
  await writeFile(statusPath, statusCsv(instrument.broker, instrument.server))
  await writeFile(completedPath, completedD1Csv(instrument.broker, instrument.server, closes))
  await writeFile(join(bridgeDirectory, 'spread_samples_20260713.csv'), spreadCsv(instrument.broker, instrument.server))
  await writeFile(ledgerPath, ledgerCsv(instrument.broker, instrument.server))
  await writeFile(join(policyDirectory, 'policy.csv'), policyCsv(instrument.broker, instrument.server))
  const researchName = instrument.broker === 'hfmarkets' ? 'xauusd-trend-baseline.json' : 'icmarkets-xauusd-trend-baseline.json'
  await writeFile(join(rootsValue.researchRoot, researchName), JSON.stringify({
    symbol: instrument.researchArtifactSymbol,
    selected_on_training_sharpe: { lookback_days: 2 },
    latest_observation: { as_of: '2026-07-12', direction: 'downtrend', lookback_days: 2 },
  }))
  await Promise.all([statusPath, completedPath, ledgerPath].map((path) => utimes(path, now, now)))
}

describe('demo decision cycle', () => {
  it('keeps the diagnostic CLI delegation-only', async () => {
    const source = await readFile(join(process.cwd(), 'tools', 'mt5', 'run_demo_canary_decisions.ts'), 'utf8')
    expect(source).toContain('resolveJmbMt5Roots')
    expect(source).toContain('runDemoDecisionCycle')
    expect(source).not.toMatch(/child_process|powershell|MetaEditor|OrderSend|OrderCheck|lookback|stopDistance/)
  })

  it('inherits the approved eight-unit protective Gold stop for both brokers', () => {
    expect(DEFAULT_JMB_DEMO_INSTRUMENTS.filter((item) => item.symbol === 'XAUUSD').map((item) => [item.broker, item.stopDistance]))
      .toEqual([['hfmarkets', 8], ['icmarkets', 8]])
  })

  it('publishes HFM from fresh completed D1 bars, persists cost first, and isolates a malformed IC cycle', async () => {
    const rootsValue = await roots()
    const hfm = DEFAULT_JMB_DEMO_INSTRUMENTS.find((item) => item.broker === 'hfmarkets' && item.symbol === 'XAUUSD')!
    const ic = DEFAULT_JMB_DEMO_INSTRUMENTS.find((item) => item.broker === 'icmarkets' && item.symbol === 'XAUUSD')!
    await writeReadyGoldFiles(rootsValue, hfm)
    await writeReadyGoldFiles(rootsValue, ic)
    await writeFile(join(rootsValue.researchRoot, 'icmarkets-xauusd-trend-baseline.json'), '{malformed')

    const results = await runDemoDecisionCycle({ roots: rootsValue, now: () => now, instruments: [ic, hfm] })

    expect(results).toEqual([
      expect.objectContaining({ broker: 'icmarkets', symbol: 'XAUUSD', state: 'error', observationId: null, decisionId: null }),
      expect.objectContaining({ broker: 'hfmarkets', symbol: 'XAUUSD', state: 'published', observationId: expect.any(String), decisionId: expect.any(String) }),
    ])
    const decision = parseExecutionDecisionCsv(await readFile(join(rootsValue.executionDecisionRoot, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'), 'utf8'))
    expect(decision).toMatchObject({ direction: 'buy', entryReferencePrice: 2400.1, stopLoss: 2392.1 })
    expect(decision.observationAsOf).toBe('2026-07-12')
    expect((await readFile(join(rootsValue.costModelRoot, 'hfmarkets', 'XAUUSD', 'cost_model.csv'), 'utf8'))).toContain(',canary_ready,')
    expect((await stat(join(rootsValue.costModelRoot, 'hfmarkets', 'XAUUSD', 'cost_model.csv'))).mtimeMs).toBeLessThanOrEqual(
      (await stat(join(rootsValue.executionDecisionRoot, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'))).mtimeMs,
    )
  })

  it('uses the IC Gold default on the protective side of a sell reference', async () => {
    const rootsValue = await roots()
    const ic = DEFAULT_JMB_DEMO_INSTRUMENTS.find((item) => item.broker === 'icmarkets' && item.symbol === 'XAUUSD')!
    await writeReadyGoldFiles(rootsValue, ic, [2500, 2450, 2400])

    const [result] = await runDemoDecisionCycle({ roots: rootsValue, now: () => now, instruments: [ic] })

    expect(result).toMatchObject({ state: 'published' })
    const decision = parseExecutionDecisionCsv(await readFile(join(rootsValue.executionDecisionRoot, 'icmarkets', 'XAUUSD', 'latest_decision.csv'), 'utf8'))
    expect(decision).toMatchObject({ direction: 'sell', entryReferencePrice: 2399.9, stopLoss: 2407.9 })
  })

  it('returns EURUSD blocked and never creates an execution lease directory', async () => {
    const rootsValue = await roots()
    const eurusd = DEFAULT_JMB_DEMO_INSTRUMENTS.find((item) => item.broker === 'hfmarkets' && item.symbol === 'EURUSD')!
    const [result] = await runDemoDecisionCycle({ roots: rootsValue, now: () => now, instruments: [eurusd] })

    expect(result).toMatchObject({ broker: 'hfmarkets', symbol: 'EURUSD', state: 'blocked', observationId: null, decisionId: null })
    await expect(stat(join(rootsValue.executionDecisionRoot, 'hfmarkets', 'EURUSD'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
