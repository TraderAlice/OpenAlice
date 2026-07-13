import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import {
  appendOutcomeOnce,
  executionEventToOutcome,
  parseExecutionEventJsonLine,
  readExecutionLearningRecords,
  type JmbExecutionOutcomeRecord,
} from './execution-outcomes.js'

const terminalEvent = {
  schema_version: 1,
  event_id: 'event-closed-1',
  event_type: 'closed',
  event_time: '2026-07-13T09:10:00.000Z',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  account_mode: 'demo',
  account_identity_masked: 'masked-opaque',
  symbol: 'XAUUSD',
  strategy_version: 'daily-trend-v1',
  magic_number: 880101,
  decision_id: 'decision-1',
  observation_id: 'observation-1',
  gate_results: [],
  calculated_risk: 10,
  requested_volume: 0.01,
  requested_price: 3334.25,
  requested_stop_loss: 3324.25,
  accepted_volume: 0.01,
  accepted_price: 3334.5,
  accepted_stop_loss: 3324.25,
  result_code: '10009',
  result_detail: 'Position closed and reconciled.',
  order_ticket: 'order-1',
  deal_ticket: 'deal-1',
  position_id: 'position-1',
  reconciliation_state: 'reconciled',
  daily_loss_count: 1,
  daily_realized_loss: 6.25,
  commission: -0.5,
  swap: -0.25,
  fee: 0,
  net_result: -6.25,
  max_adverse_excursion: null,
  max_favorable_excursion: 2.5,
} as const

const outcome: JmbExecutionOutcomeRecord = {
  schemaVersion: 1,
  outcomeEventId: 'event-closed-1',
  outcomeAt: '2026-07-13T09:10:00.000Z',
  broker: 'hfmarkets',
  server: 'HFMarketsGlobal-Demo4',
  accountMode: 'demo',
  symbol: 'XAUUSD',
  strategyVersion: 'daily-trend-v1',
  decisionId: 'decision-1',
  observationId: 'observation-1',
  positionId: 'position-1',
  result: 'loss',
  netResult: -6.25,
  commission: -0.5,
  swap: -0.25,
  fee: 0,
  requestedPrice: 3334.25,
  acceptedPrice: 3334.5,
  slippage: 0.25,
  maxAdverseExcursion: null,
  maxFavorableExcursion: 2.5,
  source: 'ea_demo',
}

describe('MT5 execution outcomes', () => {
  let root: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'openalice-outcomes-'))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('converts a fully reconciled terminal event into immutable evidence', () => {
    const source = structuredClone(terminalEvent)
    const parsed = parseExecutionEventJsonLine(JSON.stringify(source))

    expect(executionEventToOutcome(parsed)).toEqual(outcome)
    expect(source).toEqual(terminalEvent)
  })

  it.each([
    ['a non-demo account', { account_mode: 'real' }],
    ['a non-Gold symbol', { symbol: 'EURUSD' }],
    ['an unknown lifecycle', { event_type: 'profitable' }],
    ['a missing event identifier', { event_id: '' }],
    ['a missing decision identifier', { decision_id: '' }],
    ['a missing observation identifier', { observation_id: '' }],
    ['a missing position identifier', { position_id: '' }],
    ['a non-finite terminal money field', { net_result: null }],
  ])('fails closed on %s', (_case, replacement) => {
    expect(() => parseExecutionEventJsonLine(JSON.stringify({ ...terminalEvent, ...replacement }))).toThrow()
  })

  it('fails closed when a nonterminal physical line lacks correlation identifiers', () => {
    expect(() => parseExecutionEventJsonLine(JSON.stringify({
      ...terminalEvent,
      event_type: 'order_requesting',
      decision_id: '',
    }))).toThrow(/decision_id|identifier/i)
  })

  it.each([
    ['null', null],
    ['a scalar', 'pass'],
    ['a missing key', { name: 'identity', state: 'pass' }],
    ['an unknown key', { name: 'identity', state: 'pass', detail: 'Matched.', approval: true }],
    ['an unknown state', { name: 'identity', state: 'warn', detail: 'Matched.' }],
    ['an empty name', { name: '', state: 'pass', detail: 'Matched.' }],
    ['an empty detail', { name: 'identity', state: 'pass', detail: '' }],
  ])('rejects gate_results containing %s', (_case, gate) => {
    expect(() => parseExecutionEventJsonLine(JSON.stringify({
      ...terminalEvent,
      gate_results: [gate],
    }))).toThrow(/gate/i)
  })

  it('does not convert nonterminal or unreconciled events', () => {
    const unresolved = parseExecutionEventJsonLine(JSON.stringify({
      ...terminalEvent,
      event_type: 'reconciliation_required',
      reconciliation_state: 'required',
      commission: null,
      swap: null,
      fee: null,
      net_result: null,
    }))
    const unreconciled = parseExecutionEventJsonLine(JSON.stringify({
      ...terminalEvent,
      reconciliation_state: 'required',
    }))

    expect(executionEventToOutcome(unresolved)).toBeNull()
    expect(executionEventToOutcome(unreconciled)).toBeNull()
  })

  it('appends an outcome once and writes an evidence-only summary', async () => {
    await expect(appendOutcomeOnce(root, outcome)).resolves.toBe(true)
    await expect(appendOutcomeOnce(root, outcome)).resolves.toBe(false)

    const records = await readExecutionLearningRecords(root, 'hfmarkets', 'XAUUSD')
    const summary = JSON.parse(await readFile(join(root, 'hfmarkets', 'XAUUSD', 'summary.json'), 'utf8')) as Record<string, unknown>

    expect(records).toEqual([outcome])
    expect(summary).toMatchObject({
      schemaVersion: 1,
      count: 1,
      totalNetResult: -6.25,
      winCount: 0,
      lossCount: 1,
      breakevenCount: 0,
      totalCommission: -0.5,
      totalSwap: -0.25,
      totalFee: 0,
      averageSlippage: 0.25,
      latestOutcomeAt: outcome.outcomeAt,
    })
    expect(JSON.stringify(summary)).not.toMatch(/approval|risk.?limit|strategy.?parameter|profit.?prediction/i)
  })

  it.each(['unexpected', 'approval', 'riskLimit', 'strategyParameter', 'profitPrediction'])(
    'rejects the extra or prohibited outcome key %s',
    async (key) => {
      const contaminated = { ...outcome, [key]: true }

      await expect(appendOutcomeOnce(root, contaminated)).rejects.toThrow(/contract|field|key/i)
      await expect(readExecutionLearningRecords(root, 'hfmarkets', 'XAUUSD')).resolves.toEqual([])
    },
  )

  it('rejects a mismatched outcome broker and server pair', async () => {
    const mismatched = { ...outcome, server: 'ICMarketsSC-Demo' } as JmbExecutionOutcomeRecord

    await expect(appendOutcomeOnce(root, mismatched)).rejects.toThrow(/server|broker/i)
  })

  it('rejects a result that is inconsistent with netResult', async () => {
    const inconsistent = { ...outcome, result: 'win' } as JmbExecutionOutcomeRecord

    await expect(appendOutcomeOnce(root, inconsistent)).rejects.toThrow(/result/i)
  })

  it.each(['missing', 'stale'])('repairs a %s summary when the outcome is already journaled', async (state) => {
    await appendOutcomeOnce(root, outcome)
    const summaryPath = join(root, 'hfmarkets', 'XAUUSD', 'summary.json')
    if (state === 'missing') await rm(summaryPath)
    else await writeFile(summaryPath, '{"schemaVersion":1,"count":999}\n', 'utf8')

    await expect(appendOutcomeOnce(root, outcome)).resolves.toBe(false)

    const summary = JSON.parse(await readFile(summaryPath, 'utf8')) as Record<string, unknown>
    expect(summary).toMatchObject({ count: 1, totalNetResult: -6.25, lossCount: 1 })
  })
})
