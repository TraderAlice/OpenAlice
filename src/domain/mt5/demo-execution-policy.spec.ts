import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readDemoExecutionPolicy, validateDemoExecutionPolicy } from './demo-execution-policy.js'

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

const header = 'schema_version,policy_version,broker,server,symbol,strategy_version,rollout_stage,candidate_approved,completed_observation_max_age_hours,max_spread,max_deviation,max_risk_amount,max_daily_loss,max_daily_losing_trades,max_volume,magic_number'
const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('demo execution policy', () => {
  it('accepts the exact HFM canary ceiling', () => expect(validateDemoExecutionPolicy(policy).state).toBe('ready'))

  it('blocks a policy that loosens max volume', () => {
    expect(validateDemoExecutionPolicy({ ...policy, maxVolume: 0.02 }).state).toBe('blocked')
  })

  it('blocks EURUSD regardless of candidate flag', () => {
    expect(validateDemoExecutionPolicy({ ...policy, symbol: 'EURUSD' }).state).toBe('blocked')
  })

  it('allows tightened limits but blocks every loosened hard ceiling', () => {
    expect(validateDemoExecutionPolicy({
      ...policy,
      completedObservationMaxAgeHours: 48,
      maxSpread: 0.5,
      maxDeviation: 0.25,
      maxRiskAmount: 5,
      maxDailyLoss: 20,
      maxDailyLosingTrades: 2,
      maxVolume: 0.005,
    }).state).toBe('ready')

    for (const [field, value] of [
      ['completedObservationMaxAgeHours', 73],
      ['maxSpread', 0.76],
      ['maxDeviation', 0.51],
      ['maxRiskAmount', 10.01],
      ['maxDailyLoss', 40.01],
      ['maxDailyLosingTrades', 5],
      ['maxVolume', 0.02],
    ] as const) {
      expect(validateDemoExecutionPolicy({ ...policy, [field]: value }).state, field).toBe('blocked')
    }
  })

  it('blocks status-only, unapproved, mismatched, and non-finite policies', () => {
    expect(validateDemoExecutionPolicy({ ...policy, rolloutStage: 'status_only' }).state).toBe('blocked')
    expect(validateDemoExecutionPolicy({ ...policy, candidateApproved: false }).state).toBe('blocked')
    expect(validateDemoExecutionPolicy({ ...policy, server: 'ICMarketsSC-Demo' }).state).toBe('blocked')
    expect(validateDemoExecutionPolicy({ ...policy, maxSpread: Number.NaN }).state).toBe('blocked')
  })

  it('reads only the exact strict CSV contract and requested identity', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-policy-'))
    directories.push(root)
    const directory = join(root, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'policy.csv'), [
      header,
      '1,hfm-canary-v1,hfmarkets,HFMarketsGlobal-Demo4,XAUUSD,daily-trend-v1,hfm_canary,1,72,0.75,0.5,10,40,4,0.01,880101',
    ].join('\n'))

    await expect(readDemoExecutionPolicy(root, 'hfmarkets', 'XAUUSD')).resolves.toMatchObject({
      state: 'ready',
      policy: { broker: 'hfmarkets', symbol: 'XAUUSD', candidateApproved: true },
    })

    await writeFile(join(directory, 'policy.csv'), `${header},unexpected\n1,hfm-canary-v1,hfmarkets,HFMarketsGlobal-Demo4,XAUUSD,daily-trend-v1,hfm_canary,1,72,0.75,0.5,10,40,4,0.01,880101,extra`)
    await expect(readDemoExecutionPolicy(root, 'hfmarkets', 'XAUUSD')).resolves.toMatchObject({ state: 'malformed', policy: null })
  })

  it('returns missing for an unreadable policy file', async () => {
    await expect(readDemoExecutionPolicy('missing-root', 'hfmarkets', 'XAUUSD')).resolves.toMatchObject({ state: 'missing', policy: null })
  })

  it('keeps policy writes operator-only and demo-Gold allowlisted in MQL', async () => {
    const source = await readFile(join(process.cwd(), 'tools', 'mt5', 'ConfigureJmbGoldmineDemoPolicy.mq5'), 'utf8')
    expect(source).toContain('input string InpRolloutStage = "status_only";')
    expect(source).toContain('ACCOUNT_TRADE_MODE_DEMO')
    expect(source).toContain('HFMarketsGlobal-Demo4')
    expect(source).toContain('ICMarketsSC-Demo')
    expect(source).toContain('880101')
    expect(source).toContain('880201')
    expect(source).toContain('OpenAliceMt5DemoPolicyV1')
    expect(source).toContain('"schema_version","policy_version","broker","server","symbol","strategy_version","rollout_stage","candidate_approved","completed_observation_max_age_hours","max_spread","max_deviation","max_risk_amount","max_daily_loss","max_daily_losing_trades","max_volume","magic_number"')
    expect(source).not.toMatch(/OrderSend|OrderCheck|PositionClose/)
  })
})
