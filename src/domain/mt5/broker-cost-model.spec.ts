import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBrokerCostModel, writeBrokerCostModel } from './broker-cost-model.js'

const now = '2026-07-13T10:00:00.000Z'
const fingerprint = 'XAUUSD|100|0.01|0.01|10|0'

function readyInput() {
  return {
    version: 'hfm-observed-v1',
    broker: 'hfmarkets' as const,
    server: 'HFMarketsGlobal-Demo4',
    symbol: 'XAUUSD' as const,
    now,
    bridge: {
      state: 'ready' as const,
      capturedAt: '2026-07-13T09:59:30.000Z',
      contractFingerprint: fingerprint,
    },
    spreadSamples: Array.from({ length: 100 }, (_, index) => ({
      capturedAt: new Date(Date.parse(now) - (100 - index) * 60_000).toISOString(),
      spread: 0.25 + index / 1_000,
      contractFingerprint: fingerprint,
    })),
    closedDeals: [{
      accountMode: 'demo',
      symbol: 'XAUUSD',
      closed: true,
      commission: '-0.10',
      swap: '0.00',
    }],
    expectedContractFingerprint: fingerprint,
    configuredMaxSpread: 0.75,
    configuredMaxDeviation: 0.5,
  }
}

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('broker cost model', () => {
  it('becomes canary-ready only with complete fresh observed evidence', () => {
    expect(buildBrokerCostModel(readyInput())).toMatchObject({
      state: 'canary_ready',
      spreadSampleCount: 100,
      observedMaxSpread: 0.349,
      configuredMaxSpread: 0.75,
      configuredMaxDeviation: 0.5,
      commissionObserved: true,
      swapObserved: true,
      contractFingerprint: fingerprint,
    })
  })

  it('blocks missing evidence instead of degrading to a warning', () => {
    const input = readyInput()
    input.spreadSamples = input.spreadSamples.slice(0, 99)
    input.closedDeals = []

    const model = buildBrokerCostModel(input)
    expect(model.state).toBe('blocked')
    expect(model.evidence).toEqual(expect.arrayContaining([
      expect.stringMatching(/100 recent spread samples/),
      expect.stringMatching(/closed demo Gold deal/),
    ]))
  })

  it('blocks stale bridge, stale samples, fingerprint mismatch, and loose deviation independently', () => {
    const staleBridge = readyInput()
    staleBridge.bridge.capturedAt = '2026-07-13T09:57:00.000Z'
    expect(buildBrokerCostModel(staleBridge).state).toBe('blocked')

    const staleSamples = readyInput()
    staleSamples.spreadSamples = staleSamples.spreadSamples.map((sample) => ({ ...sample, capturedAt: '2026-07-11T10:00:00.000Z' }))
    expect(buildBrokerCostModel(staleSamples).state).toBe('blocked')

    const mismatch = readyInput()
    mismatch.bridge.contractFingerprint = 'different'
    expect(buildBrokerCostModel(mismatch).state).toBe('blocked')

    const looseDeviation = readyInput()
    looseDeviation.configuredMaxDeviation = 0.51
    expect(buildBrokerCostModel(looseDeviation).state).toBe('blocked')
  })

  it('blocks contradictory recent contract evidence even when 100 samples match', () => {
    const input = readyInput()
    input.spreadSamples.push({
      capturedAt: '2026-07-13T09:59:45.000Z',
      spread: 0.25,
      contractFingerprint: 'different',
    })

    expect(buildBrokerCostModel(input).state).toBe('blocked')
  })

  it('requires finite commission and swap fields on the same closed demo Gold deal', () => {
    const input = readyInput()
    input.closedDeals = [{
      accountMode: 'demo',
      symbol: 'XAUUSD',
      closed: true,
      commission: '-0.10',
      swap: 'not-a-number',
    }]

    expect(buildBrokerCostModel(input)).toMatchObject({
      state: 'blocked',
      commissionObserved: false,
      swapObserved: false,
    })
  })

  it('writes the exact CSV schema through a replaced temporary file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-cost-model-'))
    directories.push(root)
    const model = buildBrokerCostModel(readyInput())
    await writeBrokerCostModel(root, model)
    await writeBrokerCostModel(root, { ...model, version: 'hfm-observed-v2' })

    const directory = join(root, 'hfmarkets', 'XAUUSD')
    const text = await readFile(join(directory, 'cost_model.csv'), 'utf8')
    expect(text.split(/\r?\n/, 1)[0]).toBe('schema_version,version,broker,server,symbol,state,observed_from,observed_to,expires_at,spread_sample_count,observed_max_spread,configured_max_spread,configured_max_deviation,commission_observed,swap_observed,contract_fingerprint,evidence_json')
    expect(text.split(/\r?\n/)[1]).toContain('hfm-observed-v2')
    expect(await readdir(directory)).toEqual(['cost_model.csv'])
  })
})
