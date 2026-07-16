/**
 * Market-data e2e — FRED end-to-end via webui routes.
 *
 * Reproduces the actual path users hit: webui route → bbEngine → fetcher
 * → live FRED API. bbProvider specs only cover the inner fetcher slice
 * and miss the credential-mapping / route-wiring layer where the
 * community-reported "fred 配不下来" failure modes live.
 *
 * Run: pnpm test:e2e
 * Skips if OpenAlice config has no `fred` key configured.
 */

import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { getTestApp, hasProviderKey, getJson, postJson, type TestApp } from './setup.js'

let t: TestApp
beforeAll(async () => { t = await getTestApp() })

describe('market-data e2e — FRED via webui routes', () => {
  beforeEach(({ skip }) => { if (!hasProviderKey(t.config, 'fred')) skip('no fred key in config') })

  it('test-provider endpoint reports ok for valid fred key', async () => {
    // Reproduces "前端 Test Connection" button. Catches the provider
    // name mismatch (config.ts:157 used 'fred', registry has 'federal_reserve')
    // and the credential field-name mismatch in one shot.
    const key = t.config.marketData.providerKeys!.fred!
    const r = await postJson(t.app, '/api/market-data/test-provider', { provider: 'fred', key })
    expect(r.status).toBe(200)
    if (!r.data.ok) console.log('  test-provider error:', r.data.error)
    expect(r.data.ok).toBe(true)
  })

  it('fred_search via opentypebb route returns matching series', async () => {
    // Reproduces AI tool call path. Catches credential-not-flowing-through.
    const rows = await getJson(t.app, '/api/market-data-v1/economy/fred_search?provider=federal_reserve&query=GDP&limit=3')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows[0]).toHaveProperty('series_id')
    console.log(`  fred_search top hit: ${rows[0].series_id} — ${rows[0].title}`)
  })

  it('fred_series limit=5 returns latest data, not 1946', async () => {
    // Catches the asc-by-default + limit regression (returned 1946-1950 era data
    // because FRED API defaults to ascending sort).
    const rows = await getJson(t.app, '/api/market-data-v1/economy/fred_series?provider=federal_reserve&symbol=GDP&limit=5')
    expect(rows.length).toBe(5)
    const lastDate = new Date(rows[rows.length - 1].date)
    expect(lastDate.getFullYear()).toBeGreaterThanOrEqual(2025)
    console.log(`  GDP latest: ${rows[rows.length - 1].date} = ${rows[rows.length - 1].GDP}`)
  })

  it('fred_series multi-symbol returns rows with both columns populated', async () => {
    // Exercise the date merge over an explicit recent window. Using `limit=5`
    // independently for quarterly GDP and monthly UNRATE is time-dependent:
    // once the monthly series advances far enough beyond the latest GDP
    // publication, neither set is required to contain the same date.
    const rows = await getJson(t.app, '/api/market-data-v1/economy/fred_series?provider=federal_reserve&symbol=GDP,UNRATE&start_date=2024-01-01')
    expect(rows.length).toBeGreaterThan(0)
    const hasBoth = rows.some(r => r.GDP != null && r.UNRATE != null)
    expect(hasBoth).toBe(true)
  })

  it('fred_regional returns state-level rows', async () => {
    // Catches all three GeoFRED bugs: wrong base URL prefix, wrong param
    // name (series_group → series_id), wrong response parse path
    // (data.data → data.meta.data). Any one wrong → 0 rows or 404.
    const rows = await getJson(t.app, '/api/market-data-v1/economy/fred_regional?provider=federal_reserve&symbol=WIPCPI&date=2024-01-01')
    expect(rows.length).toBeGreaterThanOrEqual(50)  // 50 states + DC + territories
    expect(rows[0]).toHaveProperty('region')
    expect(rows[0]).toHaveProperty('value')
    const ca = rows.find(r => r.region === 'California')
    if (ca) console.log(`  California 2024 per-capita personal income: $${ca.value}`)
  })
})

// EIA endpoints sit under /commodity/* (OpenBB upstream classification),
// not /economy/*. Provider must be explicit because the commodity asset
// class default provider is yfinance, which has no EIA fetchers.
describe('market-data e2e — EIA via webui routes', () => {
  beforeEach(({ skip }) => { if (!hasProviderKey(t.config, 'eia')) skip('no eia key in config') })

  it('test-provider endpoint reports ok for valid eia key', async () => {
    // Catches the same class of bugs FRED had: provider name + cred field
    // alignment. EIA had its own twist — declared `credentials: ['eia_api_key']`
    // (already prefixed) so the constructor double-prefixed to `eia_eia_api_key`.
    const key = t.config.marketData.providerKeys!.eia!
    const r = await postJson(t.app, '/api/market-data/test-provider', { provider: 'eia', key })
    expect(r.status).toBe(200)
    if (!r.data.ok) console.log('  test-provider error:', r.data.error)
    expect(r.data.ok).toBe(true)
  })

  it('short_term_energy_outlook returns recent + forecast rows', async () => {
    // STEO returns ~10 years of monthly data, mixing observed and forecast.
    // Catches: PHP-bracket sort param (was JSON.stringify, EIA returned 403);
    // string→number coercion of `value` (EIA wire format is string).
    const rows = await getJson(
      t.app,
      '/api/market-data-v1/commodity/short_term_energy_outlook?provider=eia&category=crude_oil_price',
    )
    expect(rows.length).toBeGreaterThan(60)
    expect(typeof rows[0].value).toBe('number')
    const hasForecast = rows.some(r => r.forecast === true)
    expect(hasForecast).toBe(true)
    const last = rows[rows.length - 1]
    console.log(`  STEO crude oil price latest: ${last.date} = $${last.value} (forecast=${last.forecast})`)
  })

  it('petroleum_status_report returns weekly inventory rows', async () => {
    const rows = await getJson(
      t.app,
      '/api/market-data-v1/commodity/petroleum_status_report?provider=eia&category=crude_oil_stocks',
    )
    expect(rows.length).toBeGreaterThan(50)  // ~5 years of weekly data
    expect(typeof rows[0].value).toBe('number')
    const last = rows[rows.length - 1]
    const lastDate = new Date(last.date)
    expect(lastDate.getFullYear()).toBeGreaterThanOrEqual(2025)
    console.log(`  Crude oil stocks latest: ${last.date} = ${last.value} ${last.unit}`)
  })
})

describe('market-data e2e — BLS via webui routes', () => {
  beforeEach(({ skip }) => { if (!hasProviderKey(t.config, 'bls')) skip('no bls key in config') })

  it('test-provider endpoint reports ok for valid bls key', async () => {
    const key = t.config.marketData.providerKeys!.bls!
    const r = await postJson(t.app, '/api/market-data/test-provider', { provider: 'bls', key })
    expect(r.status).toBe(200)
    if (!r.data.ok) console.log('  test-provider error:', r.data.error)
    expect(r.data.ok).toBe(true)
  })

  it('bls_search returns curated series matching keyword', async () => {
    // BLS doesn't have a real search API — bls-search.ts hardcodes a curated list.
    // The probe verifies the wiring is intact; the catalog itself is provider-side.
    const rows = await getJson(t.app, '/api/market-data-v1/economy/survey/bls_search?provider=bls&query=unemployment')
    expect(rows.length).toBeGreaterThan(0)
    const seriesIds = rows.map(r => r.series_id)
    expect(seriesIds).toContain('LNS14000000')
    console.log(`  BLS search "unemployment": ${seriesIds.join(', ')}`)
  })

  it('bls_series returns observations + skips missing periods', async () => {
    // Catches the parseFloat-NaN bug — BLS returns '-' for unavailable
    // observations (e.g. 2025-10 UNRATE during government shutdown).
    // Without the NaN-skip the schema would reject the whole batch.
    const rows = await getJson(
      t.app,
      '/api/market-data-v1/economy/survey/bls_series?provider=bls&symbol=LNS14000000&start_date=2024-01-01',
    )
    expect(rows.length).toBeGreaterThan(20)
    expect(typeof rows[0].value).toBe('number')
    expect(rows.every(r => Number.isFinite(r.value))).toBe(true)  // no NaN sneak through
    const last = rows[rows.length - 1]
    const lastDate = new Date(last.date)
    expect(lastDate.getFullYear()).toBeGreaterThanOrEqual(2025)
    console.log(`  UNRATE latest: ${last.date} = ${last.value}%`)
  })
})
