import { describe, expect, it } from 'vitest'
import { assembleFacts } from './assemble.js'
import { renderBriefMarkdown } from './render.js'
import { validateFactsDocument } from './validate.js'
import type { FactsDocument } from './schema.js'

function baseObserved(overrides: Partial<FactsDocument['facts'][number]> = {}): FactsDocument {
  return {
    version: 1,
    facts: [
      {
        id: 'csi300',
        series_id: 'CSI:000300',
        value: 4000,
        asof: '2026-09-30',
        source: 'CSI',
        caliber: 'csi_index_perf',
        fetched_at: '2026-09-30T12:00:00Z',
        kind: 'observed',
        data_type: 'official_close',
        quality: 'A',
        domain: 'market',
        ...overrides,
      },
    ],
  }
}

describe('market-brief fact provenance', () => {
  it('rejects proxy without proxy_for', () => {
    const doc = baseObserved({
      id: 'uup',
      series_id: 'ETF:UUP',
      is_proxy: true,
      data_type: 'proxy',
      source: 'Yahoo',
      caliber: 'yahoo_close',
      quality: 'B',
    })
    const r = validateFactsDocument(doc)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'proxy_missing_target')).toBe(true)
  })

  it('rejects proxy_for without is_proxy', () => {
    const doc = baseObserved({
      proxy_for: 'ICE:DXY',
      data_type: 'proxy',
    })
    const r = validateFactsDocument(doc)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'proxy_flag_missing' || e.code === 'proxy_data_type_without_flag')).toBe(
      true,
    )
  })

  it('accepts labeled UUP→DXY proxy', () => {
    const doc = baseObserved({
      id: 'uup',
      series_id: 'ETF:UUP',
      value: 28.5,
      source: 'Yahoo',
      caliber: 'yahoo_close',
      data_type: 'proxy',
      quality: 'B',
      domain: 'macro',
      is_proxy: true,
      proxy_for: 'ICE:DXY',
      source_symbol: 'UUP',
    })
    const r = validateFactsDocument(doc)
    expect(r.ok).toBe(true)
  })

  it('errors when concept-board flow is labeled as Stock Connect', () => {
    const doc = baseObserved({
      id: 'fake_nb',
      series_id: 'EM:概念板块资金',
      value: 12.3,
      unit: 'yi',
      source: 'Eastmoney',
      caliber: 'eastmoney_sector_flow',
      note: '北向净流入（概念）',
      domain: 'flow',
      data_type: 'intraday',
      quality: 'B',
    })
    const r = validateFactsDocument(doc)
    expect(r.ok).toBe(false)
    expect(r.errors.some((e) => e.code === 'forbidden_connect_flow_series')).toBe(true)
  })

  it('allows exchange day-end connect disclosure wording', () => {
    const doc = baseObserved({
      id: 'sse_connect',
      series_id: 'SSE:STOCK_CONNECT_TURNOVER',
      value: 500,
      unit: 'yi',
      source: 'SSE',
      caliber: 'exchange_day_end',
      note: '沪股通成交额（日终披露）',
      domain: 'flow',
      data_type: 'exchange_day_end',
      quality: 'A',
    })
    const r = validateFactsDocument(doc)
    expect(r.ok).toBe(true)
  })

  it('assembleFacts preserves provenance and defaults proxy data_type', () => {
    const doc = assembleFacts({
      observations: [
        {
          id: 'uup',
          series_id: 'ETF:UUP',
          value: 28.1,
          asof: '2026-09-30',
          source: 'Yahoo',
          caliber: 'yahoo_close',
          is_proxy: true,
          proxy_for: 'ICE:DXY',
          source_symbol: 'UUP',
          quality: 'B',
          domain: 'macro',
        },
      ],
      fetched_at: '2026-09-30T12:00:00Z',
    })
    const f = doc.facts[0]!
    expect(f.is_proxy).toBe(true)
    expect(f.proxy_for).toBe('ICE:DXY')
    expect(f.data_type).toBe('proxy')
    expect(validateFactsDocument(doc).ok).toBe(true)
  })

  it('render shows proxy badge', () => {
    const facts = assembleFacts({
      observations: [
        {
          id: 'uup',
          series_id: 'ETF:UUP',
          value: 28.1,
          asof: '2026-09-30',
          source: 'Yahoo',
          caliber: 'yahoo_close',
          is_proxy: true,
          proxy_for: 'ICE:DXY',
          source_symbol: 'UUP',
          data_type: 'proxy',
          quality: 'B',
          domain: 'macro',
        },
      ],
      fetched_at: '2026-09-30T12:00:00Z',
    })
    const out = renderBriefMarkdown(facts, { version: 1, judgments: [] }, { locale: 'en' })
    expect(out.markdown).toMatch(/proxy:ICE:DXY/)
    expect(out.markdown).toMatch(/proxy→ICE:DXY/)
  })
})
