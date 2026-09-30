import { describe, expect, it } from 'vitest'
import { assembleFacts } from './assemble.js'
import { deriveFacts } from './derive.js'
import { suggestBriefPath } from './paths.js'
import { renderBriefMarkdown } from './render.js'
import {
  assertNoOrphanNumbersInProse,
  validateFactsDocument,
  validateJudgmentsDocument,
} from './validate.js'
import type { FactsDocument } from './schema.js'

const baseFacts: FactsDocument = {
  version: 1,
  focus_markets: ['macro'],
  facts: [
    {
      id: 'us10y_t0',
      series_id: 'FRED:DGS10',
      value: 4.2,
      unit: 'pct',
      asof: '2026-09-29',
      source: 'FRED',
      caliber: 'fred_daily',
      fetched_at: '2026-09-30T12:00:00Z',
      kind: 'observed',
    },
    {
      id: 'us10y_t1',
      series_id: 'FRED:DGS10',
      value: 4.35,
      unit: 'pct',
      asof: '2026-09-30',
      source: 'FRED',
      caliber: 'fred_daily',
      fetched_at: '2026-09-30T12:00:00Z',
      kind: 'observed',
    },
  ],
}

describe('market-brief derive', () => {
  it('computes delta_bp without LLM arithmetic', () => {
    const out = deriveFacts(baseFacts, [
      { op: 'delta_bp', id: 'us10y_d1_bp', from_id: 'us10y_t0', to_id: 'us10y_t1', scale: 100 },
    ])
    const derived = out.facts.find((f) => f.id === 'us10y_d1_bp')
    expect(derived?.kind).toBe('derived')
    expect(derived?.value).toBe(15)
    expect(derived?.unit).toBe('bp')
    expect(derived?.derived_from).toEqual(['us10y_t0', 'us10y_t1'])
    expect(String(derived?.caliber)).toMatch(/^derived:delta_bp/)
  })

  it('computes pct_change and spread', () => {
    const doc: FactsDocument = {
      version: 1,
      facts: [
        {
          id: 'px0',
          series_id: 'CSI:000300',
          value: 100,
          asof: '2026-09-29',
          source: 'CSI',
          caliber: 'index-perf',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
        {
          id: 'px1',
          series_id: 'CSI:000300',
          value: 101.5,
          asof: '2026-09-30',
          source: 'CSI',
          caliber: 'index-perf',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
        {
          id: 'left',
          series_id: 'FRED:T10Y2Y',
          value: 0.4,
          asof: '2026-09-30',
          source: 'FRED',
          caliber: 'fred_daily',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
        {
          id: 'right',
          series_id: 'FRED:T10Y3M',
          value: 0.1,
          asof: '2026-09-30',
          source: 'FRED',
          caliber: 'fred_daily',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
      ],
    }
    const out = deriveFacts(doc, [
      { op: 'pct_change', id: 'csi_pct', from_id: 'px0', to_id: 'px1' },
      { op: 'spread', id: 'curve', left_id: 'left', right_id: 'right' },
    ])
    expect(out.facts.find((f) => f.id === 'csi_pct')?.value).toBe(1.5)
    expect(out.facts.find((f) => f.id === 'curve')?.value).toBe(0.3)
  })

  it('refuses duplicate derive ids', () => {
    expect(() =>
      deriveFacts(baseFacts, [
        { op: 'delta_bp', id: 'us10y_t1', from_id: 'us10y_t0', to_id: 'us10y_t1', scale: 100 },
      ]),
    ).toThrow(/already exists/)
  })
})

describe('market-brief validate', () => {
  it('accepts clean observed facts', () => {
    const r = validateFactsDocument(baseFacts)
    expect(r.ok).toBe(true)
    expect(r.asof_span_days).toBe(1)
    expect(r.warnings.some((w) => w.code === 'asof_span')).toBe(false)
  })

  it('warns when asof spans multiple days', () => {
    const wide = {
      ...baseFacts,
      facts: [
        ...baseFacts.facts,
        {
          id: 'old',
          series_id: 'FRED:DGS2',
          value: 4,
          asof: '2026-09-01',
          source: 'FRED',
          caliber: 'fred_daily',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed' as const,
        },
      ],
    }
    const r = validateFactsDocument(wide)
    expect(r.ok).toBe(true)
    expect(r.asof_span_days).toBeGreaterThan(1)
    expect(r.warnings.some((w) => w.code === 'asof_span')).toBe(true)
  })

  it('requires evidence_ids to resolve', () => {
    const r = validateJudgmentsDocument(
      {
        version: 1,
        judgments: [
          {
            id: 'j1',
            claim: 'Rates are rising',
            evidence_ids: ['missing'],
            confidence: 'medium',
            falsifier: 'US10Y falls next session',
            horizon: '1d',
            kind: 'judgment',
          },
        ],
      },
      baseFacts,
    )
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'evidence_missing')).toBe(true)
  })

  it('flags orphan numbers in prose', () => {
    expect(
      assertNoOrphanNumbersInProse('CSI 300 rose 3.7% while US10Y moved 15 bp', baseFacts.facts).some(
        (i) => i.code === 'orphan_number',
      ),
    ).toBe(true)
  })

  it('warns time_misalignment when judgment evidence spans >1 day', () => {
    const wide: FactsDocument = {
      version: 1,
      facts: [
        {
          id: 'a',
          series_id: 'FRED:DGS10',
          value: 4.2,
          asof: '2026-09-28',
          source: 'FRED',
          caliber: 'fred_daily',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
        {
          id: 'b',
          series_id: 'CSI:000300',
          value: 1.1,
          unit: 'pct',
          asof: '2026-09-30',
          source: 'CSI',
          caliber: 'index-perf',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
      ],
    }
    const r = validateJudgmentsDocument(
      {
        version: 1,
        judgments: [
          {
            id: 'j1',
            claim: 'Rates pressuring A-shares',
            evidence_ids: ['a', 'b'],
            confidence: 'low',
            falsifier: 'CSI rises with yields flat',
            horizon: '1d',
            kind: 'judgment',
          },
        ],
      },
      wide,
    )
    expect(r.ok).toBe(true)
    expect(r.warnings.some((w) => w.code === 'time_misalignment')).toBe(true)
  })
})

describe('market-brief assemble + render', () => {
  it('assembles observed facts with shared fetched_at', () => {
    const doc = assembleFacts({
      focus_markets: ['macro'],
      fetched_at: '2026-09-30T12:00:00Z',
      observations: [
        {
          id: 'csi300',
          series_id: 'CSI:000300',
          value: 1.2,
          unit: 'pct',
          asof: '2026-09-30',
          source: 'CSI',
          caliber: 'index-perf',
        },
      ],
    })
    expect(doc.facts[0]?.kind).toBe('observed')
    expect(doc.facts[0]?.fetched_at).toBe('2026-09-30T12:00:00Z')
    expect(doc.focus_markets).toEqual(['macro'])
  })

  it('renders markdown with time-misalignment badge', () => {
    const facts: FactsDocument = {
      version: 1,
      focus_markets: ['macro', 'cn-ashare'],
      facts: [
        {
          id: 'a',
          series_id: 'FRED:DGS10',
          value: 4.2,
          unit: 'pct',
          asof: '2026-09-28',
          source: 'FRED',
          caliber: 'fred_daily',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
        {
          id: 'b',
          series_id: 'CSI:000300',
          value: 1.1,
          unit: 'pct',
          asof: '2026-09-30',
          source: 'CSI',
          caliber: 'index-perf',
          fetched_at: '2026-09-30T12:00:00Z',
          kind: 'observed',
        },
      ],
    }
    const out = renderBriefMarkdown(
      facts,
      {
        version: 1,
        judgments: [
          {
            id: 'j1',
            claim: 'Rates pressuring A-shares',
            evidence_ids: ['a', 'b'],
            confidence: 'low',
            falsifier: 'CSI rises with yields flat',
            horizon: '1d',
            kind: 'judgment',
          },
        ],
      },
      { gaps: ['Tushare gated'], locale: 'zh' },
    )
    expect(out.ok).toBe(true)
    expect(out.time_misalignments).toHaveLength(1)
    expect(out.markdown).toContain('时间错位')
    expect(out.markdown).toContain('Tushare gated')
    expect(out.markdown).toContain('`a`')
    expect(out.markdown).toContain('数据截至')
  })
})

describe('market-brief paths', () => {
  it('suggests research/briefs tree', () => {
    expect(suggestBriefPath({ asofDate: '2026-09-30', runId: 'evening', kind: 'facts' })).toBe(
      'research/briefs/2026-09-30/evening/facts.json',
    )
    expect(suggestBriefPath({ asofDate: '2026-09-30', runId: 'evening', kind: 'report' })).toBe(
      'research/briefs/2026-09-30/evening/report.md',
    )
  })
})
