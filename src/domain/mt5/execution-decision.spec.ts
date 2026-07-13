import { afterEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  createExecutionDecisionId,
  createObservationId,
  parseExecutionDecisionCsv,
  serializeExecutionDecisionCsv,
  writeExecutionDecision,
  type JmbExecutionDecision,
} from './execution-decision.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function sampleDecision(overrides: Partial<JmbExecutionDecision> = {}): JmbExecutionDecision {
  const identity = {
    broker: 'hfmarkets' as const,
    symbol: 'XAUUSD' as const,
    strategyVersion: 'daily-trend-v1' as const,
    observationAsOf: '2026-07-12',
    ...overrides,
  }
  const observationId = overrides.observationId ?? createObservationId(identity)
  return {
    schemaVersion: 1,
    decisionId: overrides.decisionId ?? createExecutionDecisionId({ observationId }),
    observationId,
    observationAsOf: identity.observationAsOf,
    createdAt: '2026-07-13T09:00:00.000Z',
    leaseIssuedAt: '2026-07-13T09:00:00.000Z',
    leaseExpiresAt: '2026-07-13T09:10:00.000Z',
    broker: identity.broker,
    server: 'HFMarketsGlobal-Demo4',
    accountMode: 'demo',
    symbol: identity.symbol,
    strategyVersion: identity.strategyVersion,
    direction: 'buy',
    entryReferencePrice: 2400.25,
    volume: 0.01,
    stopLoss: 2392.25,
    maxRiskAmount: 10,
    candidatePolicyVersion: 'hfm-v1',
    costModelVersion: 'cost-0900',
    gateResults: [{ name: 'candidate_policy', state: 'pass', detail: 'HFM canary approved.' }],
    ...overrides,
  }
}

describe('execution decision identity', () => {
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
})

describe('execution decision CSV', () => {
  it('round-trips the exact allowlisted schema', () => {
    const decision = sampleDecision()
    const csv = serializeExecutionDecisionCsv(decision)
    expect(csv.split(/\r?\n/, 1)[0]).toBe('schema_version,decision_id,observation_id,observation_as_of,created_at,lease_issued_at,lease_expires_at,broker,server,account_mode,symbol,strategy_version,direction,entry_reference_price,volume,stop_loss,max_risk_amount,candidate_policy_version,cost_model_version,gate_results_json')
    expect(parseExecutionDecisionCsv(csv)).toEqual(decision)
  })

  it('rejects extra headers and invalid semantic enum values', () => {
    const csv = serializeExecutionDecisionCsv(sampleDecision())
    expect(() => parseExecutionDecisionCsv(csv.replace('gate_results_json', 'gate_results_json,unexpected').replace('\n', '\nextra,'))).toThrow(/schema/i)
    expect(() => parseExecutionDecisionCsv(csv.replace(',buy,', ',hold,'))).toThrow(/direction/i)
    expect(() => parseExecutionDecisionCsv(csv.replace('HFMarketsGlobal-Demo4', 'ICMarketsSC-Demo'))).toThrow(/server/i)
    expect(() => parseExecutionDecisionCsv(csv.replace('"pass"', '"warn"'))).toThrow(/gate/i)
  })

  it('rejects forged identities and invalid lease ordering', () => {
    const csv = serializeExecutionDecisionCsv(sampleDecision())
    expect(() => parseExecutionDecisionCsv(csv.replace(/\n1,[^,]+/, '\n1,forged'))).toThrow(/decision id/i)
    expect(() => parseExecutionDecisionCsv(csv.replace('2026-07-13T09:10:00.000Z', '2026-07-13T08:59:00.000Z'))).toThrow(/lease/i)
  })
})

describe('execution decision persistence', () => {
  it('validates the complete decision before writing any artifact', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-execution-decision-'))
    directories.push(root)
    const invalid = { ...sampleDecision(), volume: 0.02 } as unknown as JmbExecutionDecision

    await expect(writeExecutionDecision(root, invalid)).rejects.toThrow(/volume/i)
    await expect(readdir(join(root, 'hfmarkets', 'XAUUSD'))).resolves.toEqual([])
  })

  it('atomically replaces latest and appends only materially changed evidence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-execution-decision-'))
    directories.push(root)
    const first = sampleDecision()
    const renewed = sampleDecision({
      createdAt: '2026-07-13T09:05:00.000Z',
      leaseIssuedAt: '2026-07-13T09:05:00.000Z',
      leaseExpiresAt: '2026-07-13T09:15:00.000Z',
    })
    const refreshedEvidence = sampleDecision({
      createdAt: '2026-07-13T09:05:00.000Z',
      leaseIssuedAt: '2026-07-13T09:05:00.000Z',
      leaseExpiresAt: '2026-07-13T09:15:00.000Z',
      candidatePolicyVersion: 'hfm-v2',
    })

    await writeExecutionDecision(root, first)
    await writeExecutionDecision(root, renewed)
    await writeExecutionDecision(root, refreshedEvidence)

    const directory = join(root, 'hfmarkets', 'XAUUSD')
    expect(parseExecutionDecisionCsv(await readFile(join(directory, 'latest_decision.csv'), 'utf8'))).toEqual(refreshedEvidence)
    expect((await readFile(join(directory, 'decisions.jsonl'), 'utf8')).trim().split(/\r?\n/)).toHaveLength(2)
    expect(await readdir(directory)).toEqual(['decisions.jsonl', 'latest_decision.csv'])
  })

  it('does not let an older observation replace or append after a newer lease', async () => {
    const root = await mkdtemp(join(tmpdir(), 'openalice-execution-decision-'))
    directories.push(root)
    const newer = sampleDecision({ observationAsOf: '2026-07-12' })
    const olderIdentity = {
      broker: newer.broker,
      symbol: newer.symbol,
      strategyVersion: newer.strategyVersion,
      observationAsOf: '2026-07-11',
    }
    const olderObservationId = createObservationId(olderIdentity)
    const older = sampleDecision({
      observationAsOf: olderIdentity.observationAsOf,
      observationId: olderObservationId,
      decisionId: createExecutionDecisionId({ observationId: olderObservationId }),
    })

    await writeExecutionDecision(root, newer)
    await expect(writeExecutionDecision(root, older)).resolves.toMatchObject({ state: 'regressed' })

    const directory = join(root, 'hfmarkets', 'XAUUSD')
    expect(parseExecutionDecisionCsv(await readFile(join(directory, 'latest_decision.csv'), 'utf8'))).toEqual(newer)
    expect((await readFile(join(directory, 'decisions.jsonl'), 'utf8')).trim().split(/\r?\n/)).toHaveLength(1)
  })
})
