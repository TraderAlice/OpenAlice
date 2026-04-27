import type { AccountConfig } from '../../../core/config.js'
import { IolApiClient } from '../../trading/brokers/iol/iol-client.js'
import type { FixedIncomeClientLike, FixedIncomeSearchData } from '../client/types.js'

const ENV_USERNAME = 'IOL_USERNAME'
const ENV_PASSWORD = 'IOL_PASSWORD'
const ENV_REF_PREFIX = '$env:'

const ARGENTINA_MARKET_HINTS = new Set(['argentina', 'merval', 'byma', 'bcba', 'buenos aires', 'ar'])
const FIXED_INCOME_TERMS = [
  'bond',
  'bonds',
  'bono',
  'bonos',
  'sovereign',
  'soberano',
  'soberanos',
  'treasury',
  'tesoro',
  'national',
  'nacional',
  'renta fija',
  'fixed income',
  'letra',
  'letras',
  'obligacion',
  'obligaciones',
  'negociable',
  'negociables',
  'on',
]

const ARGENTINA_FIXED_INCOME_INSTRUMENTS = [
  'bonos',
  'letras',
  'obligaciones-negociables',
]

const FALLBACK_PANELS = ['todos']

export class EmptyFixedIncomeClient implements FixedIncomeClientLike {
  async search(): Promise<FixedIncomeSearchData[]> {
    return []
  }
}

export class IolFixedIncomeClient implements FixedIncomeClientLike {
  private panelCache = new Map<string, string[]>()

  constructor(private readonly client: IolApiClient) {}

  async search(params: Record<string, unknown>): Promise<FixedIncomeSearchData[]> {
    const query = String(params.query ?? '').trim()
    if (!query) return []

    const market = normalizeMarket(params.market)
    const country = String(params.country ?? '').toLowerCase()
    if (market && !isArgentinaMarket(market)) return []
    if (country && country !== 'ar' && country !== 'argentina') return []
    if (!market && looksLikeUnitedStatesQuery(query) && !looksLikeArgentinaQuery(query)) return []

    const limit = positiveLimit(params.limit, 20)
    const rows = await this.fetchArgentinaRows()
    const matches = rows
      .map((row) => mapIolRow(row))
      .filter((row): row is FixedIncomeSearchData => Boolean(row?.symbol))
      .filter((row) => matchesQuery(query, row))

    return dedupeBySymbol(matches).slice(0, limit)
  }

  private async fetchArgentinaRows(): Promise<Record<string, unknown>[]> {
    const instruments = await this.discoverArgentinaFixedIncomeInstruments()
    const settled = await Promise.allSettled(
      instruments.flatMap((instrument) => (
        this.getPanels(instrument).then((panels) => (
          Promise.allSettled(
            panels.map(async (panel) => {
              const response = await this.client.getCotizaciones(instrument, panel, 'argentina')
              return extractRows(response).map((row) => ({ ...row, __instrument: instrument, __panel: panel }))
            }),
          )
        ))
      )),
    )

    const out: Record<string, unknown>[] = []
    for (const instrumentResult of settled) {
      if (instrumentResult.status !== 'fulfilled') continue
      for (const panelResult of instrumentResult.value) {
        if (panelResult.status === 'fulfilled') out.push(...panelResult.value)
      }
    }
    return out
  }

  private async discoverArgentinaFixedIncomeInstruments(): Promise<string[]> {
    try {
      const response = await this.client.getCotizacionInstrumentos('argentina')
      const discovered = extractCatalogValues(response)
        .filter(Boolean)
        .filter((value) => {
          const v = normalizeText(value)
          return v.includes('bono') || v.includes('letra') || v.includes('obligacion')
        })
        .map(slugifyInstrument)
        .filter(Boolean)

      if (discovered.length > 0) return Array.from(new Set([...discovered, ...ARGENTINA_FIXED_INCOME_INSTRUMENTS]))
    } catch {
      // Older/limited IOL API access can reject the discovery endpoint; quote panels below are best effort.
    }
    return ARGENTINA_FIXED_INCOME_INSTRUMENTS
  }

  private async getPanels(instrument: string): Promise<string[]> {
    const cached = this.panelCache.get(instrument)
    if (cached) return cached

    try {
      const response = await this.client.getCotizacionPaneles(instrument, 'argentina')
      const panels = extractCatalogValues(response)
        .filter(Boolean)
        .map(slugifyInstrument)
        .filter(Boolean)

      if (panels.length > 0) {
        const unique = Array.from(new Set(panels))
        this.panelCache.set(instrument, unique)
        return unique
      }
    } catch {
      // Fall through to the broad panel used by IOL quote-panel APIs.
    }

    this.panelCache.set(instrument, FALLBACK_PANELS)
    return FALLBACK_PANELS
  }
}

export function createIolFixedIncomeClientFromAccounts(accounts: AccountConfig[]): FixedIncomeClientLike {
  const iolAccount = accounts.find((account) => account.enabled !== false && account.type === 'iol')
  const username = resolveSecret(
    typeof iolAccount?.brokerConfig.username === 'string' ? iolAccount.brokerConfig.username : undefined,
    ENV_USERNAME,
  )
  const password = resolveSecret(
    typeof iolAccount?.brokerConfig.password === 'string' ? iolAccount.brokerConfig.password : undefined,
    ENV_PASSWORD,
  )

  if (!username || !password) return new EmptyFixedIncomeClient()
  return new IolFixedIncomeClient(new IolApiClient(username, password))
}

function mapIolRow(row: Record<string, unknown>): FixedIncomeSearchData | null {
  const title = isRecord(row.titulo) ? row.titulo : row
  const symbol = String(title.simbolo ?? row.simbolo ?? title.symbol ?? row.symbol ?? '').trim()
  if (!symbol) return null

  const name = stringOrNull(title.descripcion ?? row.descripcion ?? row.nombre ?? title.nombre)
  const market = stringOrNull(title.mercado ?? row.mercado ?? 'bCBA')
  const currency = normalizeCurrency(title.moneda ?? row.moneda)
  const instrumentType = inferInstrumentType(row.__instrument, title.tipo ?? row.tipo)

  return {
    symbol,
    name,
    assetType: instrumentType,
    market: 'argentina',
    country: 'AR',
    exchange: market,
    currency,
    instrumentType,
    source: 'iol',
    native: {
      ...row,
      titulo: title,
    },
  }
}

function extractRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isRecord)
  if (!isRecord(value)) return []

  for (const key of ['titulos', 'cotizaciones', 'data', 'items', 'results', 'instrumentos', 'paneles']) {
    const nested = value[key]
    if (Array.isArray(nested)) return nested.filter(isRecord)
  }

  return []
}

function extractCatalogValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(catalogValue).filter(Boolean)
  if (!isRecord(value)) return []

  for (const key of ['instrumentos', 'paneles', 'titulos', 'cotizaciones', 'data', 'items', 'results']) {
    const nested = value[key]
    if (Array.isArray(nested)) return nested.map(catalogValue).filter(Boolean)
  }

  const single = catalogValue(value)
  return single ? [single] : []
}

function catalogValue(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (!isRecord(value)) return ''
  return String(value.codigo ?? value.nombre ?? value.descripcion ?? value.instrumento ?? value.panel ?? value.id ?? '').trim()
}

function matchesQuery(query: string, row: FixedIncomeSearchData): boolean {
  if (isGenericFixedIncomeQuery(query)) return true

  const q = normalizeText(query)
  const haystack = normalizeText([
    row.symbol,
    row.name,
    row.instrumentType,
    row.issuer,
    row.currency,
    row.isin,
  ].filter(Boolean).join(' '))
  return haystack.includes(q)
}

function isGenericFixedIncomeQuery(query: string): boolean {
  const q = normalizeText(query)
  return FIXED_INCOME_TERMS.some((term) => q.includes(term))
}

function looksLikeUnitedStatesQuery(query: string): boolean {
  const q = normalizeText(query)
  return /\b(united states|u\.?s\.?|usa|treasury|treasuries|t-bill|t bill|corporate bond)\b/.test(q)
}

function looksLikeArgentinaQuery(query: string): boolean {
  const q = normalizeText(query)
  return /\b(argentina|argentine|argentino|argentina|bonar|globales|bopreal|boncer|lecap|letes|tesoro nacional)\b/.test(q)
}

function inferInstrumentType(instrument: unknown, rawType: unknown): string {
  const value = normalizeText(String(instrument ?? rawType ?? ''))
  if (value.includes('obligacion')) return 'corporate_bond'
  if (value.includes('letra')) return 'treasury_bill'
  if (value.includes('bono')) return 'sovereign_bond'
  return 'fixed_income'
}

function normalizeMarket(market: unknown): string | undefined {
  return typeof market === 'string' && market.trim() ? market.trim().toLowerCase() : undefined
}

function isArgentinaMarket(market: string): boolean {
  return ARGENTINA_MARKET_HINTS.has(market)
}

function positiveLimit(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback
}

function normalizeCurrency(value: unknown): string | null {
  const s = stringOrNull(value)
  if (!s) return null
  const v = normalizeText(s)
  if (v.includes('dolar') || v === 'us$' || v === 'usd' || v.includes('u$s')) return 'USD'
  if (v.includes('peso') || v === 'ar$' || v === '$' || v === 'ars') return 'ARS'
  return s
}

function normalizeText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

function slugifyInstrument(value: string): string {
  return normalizeText(value)
    .replace(/&/g, ' y ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function stringOrNull(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function dedupeBySymbol<T extends FixedIncomeSearchData>(rows: T[]): T[] {
  const out: T[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    const key = row.symbol.toUpperCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

function resolveSecret(configValue: string | undefined, fallbackEnv: string): string {
  if (configValue && configValue.startsWith(ENV_REF_PREFIX)) {
    const key = configValue.slice(ENV_REF_PREFIX.length).trim()
    return process.env[key] ?? ''
  }
  if (configValue && configValue.length > 0) return configValue
  return process.env[fallbackEnv] ?? ''
}
