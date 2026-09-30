import { describe, expect, it } from 'vitest'
import { buildAnalysisDocument, validateAnalysisDocument } from './analysis.js'
import { validateEditorial } from './editorial.js'
import { renderAnalysisMarkdown } from './render.js'
import type { AnalysisDocument, FactsDocument } from './schema.js'

const facts: FactsDocument = {
  version: 1,
  focus_markets: ['macro'],
  facts: [
    {
      id: 'us30y',
      series_id: 'FRED:DGS30',
      value: 5.56,
      unit: 'pct',
      asof: '2026-09-28',
      source: 'FRED',
      caliber: 'fred_daily',
      fetched_at: '2026-09-30T12:00:00Z',
      kind: 'observed',
    },
    {
      id: 'd30_bp',
      series_id: 'FRED:DGS30.delta_bp',
      value: 27,
      unit: 'bp',
      asof: '2026-09-28',
      source: 'FRED',
      caliber: 'derived:delta_bp(a,b,scale=100)',
      fetched_at: '2026-09-30T12:00:00Z',
      kind: 'derived',
      derived_from: ['us30y'],
    },
  ],
}

describe('market-brief analysis + editorial', () => {
  it('builds analysis from judgments with certainty', () => {
    const doc = buildAnalysisDocument({
      asof: '2026-09-30',
      facts,
      data_limitations: ['南北向资金未获得'],
      judgments: {
        version: 1,
        judgments: [
          {
            id: 'j1',
            claim: '长端利率仍高，通胀预期并非唯一解释',
            evidence_ids: ['us30y', 'd30_bp'],
            confidence: 'medium',
            falsifier: 'BEIR jumps with yields',
            horizon: '1w',
            kind: 'judgment',
            certainty: 'interpretation',
          },
        ],
      },
    })
    expect(doc.signals).toHaveLength(1)
    expect(doc.signals[0]?.certainty).toBe('interpretation')
    const v = validateAnalysisDocument(doc)
    expect(v.ok).toBe(true)
  })

  it('renders two-layer analysis markdown', () => {
    const doc = buildAnalysisDocument({
      asof: '2026-09-30',
      facts,
      data_limitations: ['南北向资金未获得'],
      judgments: {
        version: 1,
        judgments: [
          {
            id: 'j1',
            claim: '长端利率仍高，可能主要来自实际利率',
            evidence_ids: ['us30y'],
            confidence: 'medium',
            falsifier: 'yields fall',
            horizon: '1w',
            kind: 'judgment',
            certainty: 'interpretation',
          },
        ],
      },
    })
    const out = renderAnalysisMarkdown(doc, { locale: 'zh' })
    expect(out.markdown).toContain('今天最重要的三个变化')
    expect(out.markdown).toContain('详细分析')
    expect(out.markdown).toContain('数据限制')
    expect(out.markdown).toContain('南北向资金未获得')
  })

  it('fails editorial-check on unit flip and dropped limitations', () => {
    const analysis: AnalysisDocument = buildAnalysisDocument({
      asof: '2026-09-30',
      facts,
      data_limitations: ['南北向资金未获得'],
      signals: [
        {
          id: 's1',
          title: '长端承压',
          conclusion: '长端收益率4天上行27bp，可能主要来自实际利率',
          certainty: 'interpretation',
          evidence_ids: ['us30y', 'd30_bp'],
          interpretation: [],
          hypotheses: [],
          watch_points: ['10Y能否站稳'],
          confidence: 'medium',
        },
      ],
    })

    const bad = validateEditorial({
      analysis,
      edited: '收益率上升27%，已经确认是通胀推动。美债到了5.56。',
    })
    expect(bad.ok).toBe(false)
    expect(bad.errors.some((e) => e.code === 'unit_flip')).toBe(true)
    expect(bad.errors.some((e) => e.code === 'limitation_dropped')).toBe(true)

    const good = validateEditorial({
      analysis,
      edited: [
        '## 今天最重要的三个变化',
        '',
        '长端收益率4天上行27bp至5.56%，可能主要来自实际利率。',
        '',
        '## 数据限制',
        '',
        '- 南北向资金未获得',
        '',
      ].join('\n'),
    })
    expect(good.ok).toBe(true)
  })

  it('errors when hedges collapse into certainty', () => {
    const analysis = buildAnalysisDocument({
      asof: '2026-09-30',
      facts,
      data_limitations: ['南北向资金未获得'],
      judgments: {
        version: 1,
        judgments: [
          {
            id: 'j1',
            claim: '邮轮股上涨可能与油价回落有关，尚无法确认因果关系',
            evidence_ids: ['us30y'],
            confidence: 'low',
            falsifier: 'oil rises with cruise stocks',
            horizon: '1w',
            kind: 'hypothesis',
            certainty: 'hypothesis',
          },
        ],
      },
    })
    const r = validateEditorial({
      analysis,
      edited: '邮轮股上涨就是因为油价回落，可以确认。\n\n南北向资金未获得',
    })
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'uncertainty_collapsed' || e.code === 'hedge_to_causal')).toBe(
      true,
    )
  })
})
