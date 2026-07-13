import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readExecutionLearningRecords } from '../domain/mt5/execution-outcomes.js'
import {
  createJmbMt5OutcomeImporter,
  importReconciledExecutionOutcomes,
} from './mt5-outcome-importer.js'

const hfmGold = { broker: 'hfmarkets', server: 'HFMarketsGlobal-Demo4', symbol: 'XAUUSD' } as const
const icGold = { broker: 'icmarkets', server: 'ICMarketsSC-Demo', symbol: 'XAUUSD' } as const

function executionEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: 1,
    event_id: 'event-request-1',
    event_type: 'order_requesting',
    event_time: '2026-07-13T09:00:00.000Z',
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
    accepted_volume: null,
    accepted_price: null,
    accepted_stop_loss: null,
    result_code: '',
    result_detail: 'Request persisted.',
    order_ticket: '',
    deal_ticket: '',
    position_id: '',
    reconciliation_state: 'pending',
    daily_loss_count: 0,
    daily_realized_loss: 0,
    commission: null,
    swap: null,
    fee: null,
    net_result: null,
    max_adverse_excursion: null,
    max_favorable_excursion: null,
    ...overrides,
  }
}

const requestEvent = executionEvent()
const fillEvent = executionEvent({
  event_id: 'event-fill-1',
  event_type: 'filled_protected',
  event_time: '2026-07-13T09:01:00.000Z',
  accepted_volume: 0.01,
  accepted_price: 3334.5,
  accepted_stop_loss: 3324.25,
  order_ticket: 'order-1',
  deal_ticket: 'deal-open-1',
  position_id: 'position-1',
  reconciliation_state: 'reconciled',
})
const closedEvent = executionEvent({
  event_id: 'event-closed-1',
  event_type: 'closed',
  event_time: '2026-07-13T10:00:00.000Z',
  accepted_volume: 0.01,
  accepted_price: 3334.5,
  accepted_stop_loss: null,
  order_ticket: 'order-1',
  deal_ticket: 'deal-close-1',
  position_id: 'position-1',
  reconciliation_state: 'reconciled',
  daily_loss_count: 1,
  daily_realized_loss: 6.25,
  commission: -0.5,
  swap: -0.25,
  fee: 0,
  net_result: -6.25,
})
const reconciliationRequiredEvent = executionEvent({
  event_id: 'event-reconcile-1',
  event_type: 'reconciliation_required',
  event_time: '2026-07-13T09:01:00.000Z',
  accepted_volume: 0.01,
  accepted_price: 3334.5,
  order_ticket: 'order-1',
  deal_ticket: 'deal-open-1',
  position_id: 'position-1',
  reconciliation_state: 'required',
})

async function writeExecutionEvents(root: string, events: readonly Record<string, unknown>[]): Promise<void> {
  const directory = join(root, String(events[0]?.['broker']), 'XAUUSD')
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'events.jsonl'), `${events.map((event) => JSON.stringify(event)).join('\n')}\n`, 'utf8')
}

describe('MT5 outcome importer', () => {
  let executionRoot: string
  let learningRoot: string

  beforeEach(async () => {
    executionRoot = await mkdtemp(join(tmpdir(), 'openalice-execution-'))
    learningRoot = await mkdtemp(join(tmpdir(), 'openalice-learning-'))
  })

  afterEach(async () => {
    vi.useRealTimers()
    await Promise.all([
      rm(executionRoot, { recursive: true, force: true }),
      rm(learningRoot, { recursive: true, force: true }),
    ])
  })

  it('imports one fully reconciled close exactly once', async () => {
    await writeExecutionEvents(executionRoot, [requestEvent, fillEvent, closedEvent])
    await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })
    await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })

    const records = await readExecutionLearningRecords(learningRoot, 'hfmarkets', 'XAUUSD')
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({
      decisionId: closedEvent['decision_id'],
      outcomeEventId: closedEvent['event_id'],
      result: 'loss',
      netResult: -6.25,
      source: 'ea_demo',
    })
  })

  it('imports a fully reconciled stopped outcome', async () => {
    const stoppedEvent = {
      ...closedEvent,
      event_id: 'event-stopped-1',
      event_type: 'stopped',
      event_time: '2026-07-13T09:30:00.000Z',
    }
    await writeExecutionEvents(executionRoot, [requestEvent, fillEvent, stoppedEvent])

    const result = await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })

    expect(result[0]).toMatchObject({ state: 'imported', imported: 1 })
    await expect(readExecutionLearningRecords(learningRoot, 'hfmarkets', 'XAUUSD')).resolves.toEqual([
      expect.objectContaining({ outcomeEventId: 'event-stopped-1', result: 'loss' }),
    ])
  })

  it('does not import an unresolved or unprotected exposure', async () => {
    await writeExecutionEvents(executionRoot, [requestEvent, reconciliationRequiredEvent])

    const result = await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })

    expect(result[0]).toMatchObject({ state: 'no_new_outcome', imported: 0 })
  })

  it('fails the broker closed when any physical JSONL line is malformed', async () => {
    const directory = join(executionRoot, 'hfmarkets', 'XAUUSD')
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'events.jsonl'), `${JSON.stringify(closedEvent)}\n{"schema_version":1\n`, 'utf8')

    const result = await importReconciledExecutionOutcomes({ executionRoot, learningRoot, instruments: [hfmGold] })

    expect(result[0]).toMatchObject({ state: 'blocked', imported: 0 })
    await expect(readExecutionLearningRecords(learningRoot, 'hfmarkets', 'XAUUSD')).resolves.toEqual([])
  })

  it('isolates a malformed broker journal from another broker', async () => {
    const hfmDirectory = join(executionRoot, 'hfmarkets', 'XAUUSD')
    await mkdir(hfmDirectory, { recursive: true })
    await writeFile(join(hfmDirectory, 'events.jsonl'), '{bad json}\n', 'utf8')
    await writeExecutionEvents(executionRoot, [{
      ...closedEvent,
      event_id: 'ic-event-closed-1',
      broker: 'icmarkets',
      server: 'ICMarketsSC-Demo',
      magic_number: 880201,
    }])

    const result = await importReconciledExecutionOutcomes({
      executionRoot,
      learningRoot,
      instruments: [hfmGold, icGold],
    })

    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ broker: 'hfmarkets', state: 'blocked', imported: 0 }),
      expect.objectContaining({ broker: 'icmarkets', state: 'imported', imported: 1 }),
    ]))
  })

  it('runs one catch-up cycle then uses a serial five-minute Pump', async () => {
    vi.useFakeTimers()
    let release: (() => void) | undefined
    const runCycle = vi.fn(async () => {
      if (runCycle.mock.calls.length === 2) await new Promise<void>((resolve) => { release = resolve })
      return []
    })
    const importer = createJmbMt5OutcomeImporter({ runCycle })

    await importer.start()
    expect(runCycle).toHaveBeenCalledTimes(1)

    const scheduled = vi.advanceTimersByTimeAsync(5 * 60_000)
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(runCycle).toHaveBeenCalledTimes(2)
    release?.()
    await scheduled
    await importer.runNow()
    expect(runCycle).toHaveBeenCalledTimes(3)
    importer.stop()
  })

  it('starts after the decision scheduler and stops during shutdown', async () => {
    const mainSource = await readFile(join(import.meta.dirname, '..', 'main.ts'), 'utf8')
    const schedulerStart = mainSource.indexOf('await mt5DecisionScheduler.start()')
    const importerStart = mainSource.indexOf('await mt5OutcomeImporter.start()')

    expect(mainSource).toContain("join(mt5Roots.researchRoot, 'mt5-execution-learning')")
    expect(importerStart).toBeGreaterThan(schedulerStart)
    expect(mainSource).toContain('mt5OutcomeImporter.stop()')
  })
})
