import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendJmbDecisionRecord,
  createJmbDecisionId,
  parseLatestDecisionCsv,
  serializeLatestDecisionCsv,
  summarizeLatestJmbDecision,
  writeLatestJmbDecision,
  type JmbDecisionRecord,
} from './decision-record.js'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function sampleDecision(overrides: Partial<JmbDecisionRecord> = {}): JmbDecisionRecord {
  const base: JmbDecisionRecord = {
    schemaVersion: 1,
    decisionId: 'decision-1',
    createdAt: '2026-07-13T09:00:00.000Z',
    broker: 'hfmarkets',
    server: 'HFMarketsGlobal-Demo4',
    accountMode: 'demo',
    symbol: 'XAUUSD',
    canonicalInstrument: 'Gold / USD',
    strategyVersion: 'daily-trend-v1',
    mode: 'shadow',
    direction: 'buy',
    reasonCode: 'daily_trend_shadow',
    reasonDetail: 'Completed daily trend filter is positive.',
    entryReferencePrice: 2410.25,
    stopLoss: 2402.25,
    takeProfit: null,
    volume: 0.01,
    spread: 0.36,
    riskAmount: 0.8,
    maxAllowedRisk: 1,
    gateResults: [
      { gate: 'account_demo', state: 'pass', detail: 'MT5 reports demo mode' },
      { gate: 'shadow_only', state: 'pass', detail: 'No order submission in Plan 2' },
    ],
    orderTicket: null,
    positionId: null,
    outcome: null,
  }
  return { ...base, ...overrides }
}

describe('JMB decision records', () => {
  it('creates stable ids from deterministic fields', () => {
    const id = createJmbDecisionId(sampleDecision())
    expect(id).toBe(createJmbDecisionId(sampleDecision()))
    expect(id).not.toBe(createJmbDecisionId(sampleDecision({ direction: 'sell' })))
  })

  it('round-trips latest-decision CSV without losing gate results', () => {
    const decision = sampleDecision({ reasonDetail: 'Spread, trend, and stop checked' })
    const parsed = parseLatestDecisionCsv(serializeLatestDecisionCsv(decision))
    expect(parsed).toMatchObject({
      broker: 'hfmarkets',
      symbol: 'XAUUSD',
      mode: 'shadow',
      direction: 'buy',
      volume: 0.01,
      stopLoss: 2402.25,
    })
    expect(parsed.gateResults).toHaveLength(2)
  })

  it('round-trips quoted CSV fields containing commas, quotes, and newlines', () => {
    const decision = sampleDecision({
      reasonDetail: 'Spread, "trend", and stop checked\nwith broker evidence',
      gateResults: [
        { gate: 'broker_note', state: 'warn', detail: 'Value had comma, "quote", and newline\nfrom MT5' },
      ],
    })

    const parsed = parseLatestDecisionCsv(serializeLatestDecisionCsv(decision))

    expect(parsed.reasonDetail).toBe('Spread, "trend", and stop checked\nwith broker evidence')
    expect(parsed.gateResults).toEqual([
      { gate: 'broker_note', state: 'warn', detail: 'Value had comma, "quote", and newline\nfrom MT5' },
    ])
  })

  it('writes append-only JSONL and latest CSV under broker symbol folders', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jmb-decisions-'))
    directories.push(root)
    const decision = sampleDecision()

    await appendJmbDecisionRecord(root, decision)
    await writeLatestJmbDecision(root, decision)

    const jsonl = await readFile(join(root, 'hfmarkets', 'XAUUSD', 'decisions.jsonl'), 'utf8')
    const latest = await readFile(join(root, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'), 'utf8')
    expect(jsonl.trim().split('\n')).toHaveLength(1)
    expect(parseLatestDecisionCsv(latest).decisionId).toBe('decision-1')
  })

  it('summarizes unreadable latest CSV as blocked instead of throwing', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jmb-decisions-'))
    directories.push(root)
    await writeLatestJmbDecision(root, sampleDecision())
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(join(root, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'), 'broken,csv\n1'),
    )

    const summary = await summarizeLatestJmbDecision(root, 'hfmarkets', 'XAUUSD')

    expect(summary.state).toBe('error')
    expect(summary.label).toBe('Decision unreadable')
  })

  it('summarizes malformed required numeric fields as unreadable', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jmb-decisions-'))
    directories.push(root)
    await writeLatestJmbDecision(root, sampleDecision())
    await import('node:fs/promises').then(({ writeFile }) =>
      writeFile(
        join(root, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'),
        serializeLatestDecisionCsv(sampleDecision()).replace(',0.01,0.36,0.8,1,', ',not-a-number,0.36,0.8,also-bad,'),
      ),
    )

    const summary = await summarizeLatestJmbDecision(root, 'hfmarkets', 'XAUUSD')

    expect(summary.state).toBe('error')
    expect(summary.label).toBe('Decision unreadable')
  })

  it('summarizes read errors as unreadable instead of missing decision', async () => {
    const root = await mkdtemp(join(tmpdir(), 'jmb-decisions-'))
    directories.push(root)
    await mkdir(join(root, 'hfmarkets', 'XAUUSD', 'latest_decision.csv'), { recursive: true })

    const summary = await summarizeLatestJmbDecision(root, 'hfmarkets', 'XAUUSD')

    expect(summary.state).toBe('error')
    expect(summary.label).toBe('Decision unreadable')
  })
})
