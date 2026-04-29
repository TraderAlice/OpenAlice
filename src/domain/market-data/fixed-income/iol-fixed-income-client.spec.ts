import { afterEach, describe, expect, it, vi } from 'vitest'
import { EmptyFixedIncomeClient, IolFixedIncomeClient, createIolFixedIncomeClientFromAccounts } from './iol-fixed-income-client.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('IolFixedIncomeClient', () => {
  it('discovers Argentine fixed-income rows from IOL quote panels', async () => {
    const api = {
      getCotizacionInstrumentos: vi.fn().mockResolvedValue({
        instrumentos: [
          { codigo: 'bonos', nombre: 'Bonos' },
          { codigo: 'acciones', nombre: 'Acciones' },
        ],
      }),
      getCotizacionPaneles: vi.fn().mockResolvedValue({ paneles: [{ codigo: 'todos' }] }),
      getCotizaciones: vi.fn().mockResolvedValue({
        titulos: [
          {
            simbolo: 'AL30',
            descripcion: 'Bonar 2030',
            mercado: 'bCBA',
            moneda: 'peso_Argentino',
          },
      {
        titulo: {
          simbolo: 'GD30D',
          descripcion: 'Global 2030 D',
          mercado: 'bCBA',
          moneda: 'US$',
          tipo: 'TITULOSPUBLICOS',
        },
      },
        ],
      }),
    }

    const client = new IolFixedIncomeClient(api as never)
    const result = await client.search({ query: 'AL30', market: 'argentina', limit: 10 })

    expect(result).toEqual([
      expect.objectContaining({
        symbol: 'AL30',
        name: 'Bonar 2030',
        market: 'argentina',
        country: 'AR',
        exchange: 'bCBA',
        currency: 'ARS',
        instrumentType: 'sovereign_bond',
        source: 'iol',
      }),
    ])
    expect(api.getCotizaciones).toHaveBeenCalledWith('bonos', 'todos', 'argentina')
  })

  it('keeps fallback fixed-income instruments when catalog discovery is partial', async () => {
    const api = {
      getCotizacionInstrumentos: vi.fn().mockResolvedValue({ instrumentos: [{ codigo: 'bonos' }] }),
      getCotizacionPaneles: vi.fn().mockResolvedValue({ paneles: [{ codigo: 'todos' }] }),
      getCotizaciones: vi.fn().mockResolvedValue({ titulos: [] }),
    }

    const client = new IolFixedIncomeClient(api as never)
    await client.search({ query: 'bonos argentinos', market: 'argentina', limit: 10 })

    expect(api.getCotizaciones).toHaveBeenCalledWith('bonos', 'todos', 'argentina')
    expect(api.getCotizaciones).toHaveBeenCalledWith('letras', 'todos', 'argentina')
    expect(api.getCotizaciones).toHaveBeenCalledWith('obligaciones-negociables', 'todos', 'argentina')
  })

  it('treats generic bond research queries as fixed-income discovery', async () => {
    const api = {
      getCotizacionInstrumentos: vi.fn().mockRejectedValue(new Error('not available')),
      getCotizacionPaneles: vi.fn().mockRejectedValue(new Error('not available')),
      getCotizaciones: vi.fn().mockResolvedValue({
        cotizaciones: [{ simbolo: 'TX26', descripcion: 'Boncer 2026', mercado: 'bCBA' }],
      }),
    }

    const client = new IolFixedIncomeClient(api as never)
    const result = await client.search({ query: 'Argentine national bonds', market: 'argentina', limit: 3 })

    expect(result).toEqual([
      expect.objectContaining({
        symbol: 'TX26',
        assetType: 'sovereign_bond',
      }),
    ])
  })

  it('does not answer non-Argentina market searches', async () => {
    const api = {
      getCotizacionInstrumentos: vi.fn(),
      getCotizacionPaneles: vi.fn(),
      getCotizaciones: vi.fn(),
    }

    const client = new IolFixedIncomeClient(api as never)
    await expect(client.search({ query: 'treasury', market: 'united_states' })).resolves.toEqual([])
    expect(api.getCotizaciones).not.toHaveBeenCalled()
  })

  it('does not treat US bond queries as Argentine discovery when no market is provided', async () => {
    const api = {
      getCotizacionInstrumentos: vi.fn(),
      getCotizacionPaneles: vi.fn(),
      getCotizaciones: vi.fn(),
    }

    const client = new IolFixedIncomeClient(api as never)
    await expect(client.search({ query: 'United States treasury bonds' })).resolves.toEqual([])
    expect(api.getCotizaciones).not.toHaveBeenCalled()
  })
})

describe('createIolFixedIncomeClientFromAccounts', () => {
  it('creates an empty client when no IOL credentials are configured', async () => {
    const client = createIolFixedIncomeClientFromAccounts([])

    expect(client).toBeInstanceOf(EmptyFixedIncomeClient)
    await expect(client.search({ query: 'AL30', market: 'argentina' })).resolves.toEqual([])
  })

  it('accepts IOL credentials from configured env references', () => {
    vi.stubEnv('IOL_TEST_USER', 'user')
    vi.stubEnv('IOL_TEST_PASS', 'pass')

    const client = createIolFixedIncomeClientFromAccounts([
      {
        id: 'iol-main',
        presetId: 'iol',
        enabled: true,
        guards: [],
        presetConfig: {
          username: '$env:IOL_TEST_USER',
          password: '$env:IOL_TEST_PASS',
        },
      },
    ])

    expect(client).toBeInstanceOf(IolFixedIncomeClient)
  })
})
