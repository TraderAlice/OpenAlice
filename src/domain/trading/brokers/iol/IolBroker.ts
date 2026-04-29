/**
 * IolBroker — IBroker adapter for InvertirOnline (IOL).
 *
 * InvertirOnline is an Argentine online broker with access to BCBA/BYMA
 * equities, CEDEARs, sovereign bonds, FCIs, and US markets via CEDEAR proxy.
 * Authentication uses OAuth2 password grant (username + password) against
 * https://api.invertironline.com.
 *
 * Secrets flow:
 *   1. brokerConfig.username/password literal   → used as-is
 *   2. brokerConfig.username/password = "$env:FOO" → process.env.FOO
 *   3. brokerConfig fields empty/undefined      → IOL_USERNAME / IOL_PASSWORD
 *
 * Resolution happens inside init() so the agent never holds raw credentials.
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import {
  Contract,
  ContractDescription,
  ContractDetails,
  Order,
  OrderState,
  UNSET_DOUBLE,
  UNSET_DECIMAL,
} from '@traderalice/ibkr'
import {
  BrokerError,
  type IBroker,
  type AccountCapabilities,
  type AccountInfo,
  type Position,
  type PlaceOrderResult,
  type OpenOrder,
  type Quote,
  type MarketClock,
  type BrokerConfigField,
  type TpSlParams,
} from '../types.js'
import '../../contract-ext.js'
import { IolApiClient } from './iol-client.js'
import {
  makeContract,
  resolveSymbol,
  encodeNativeKey,
  decodeNativeKey,
  mapCurrency,
  makeOrderState,
} from './iol-contracts.js'
import type {
  IolBrokerConfig,
  IolActivo,
  IolCuenta,
  IolOperacion,
  IolPlaceOrderBody,
} from './iol-types.js'

const ENV_USERNAME = 'IOL_USERNAME'
const ENV_PASSWORD = 'IOL_PASSWORD'
const ENV_REF_PREFIX = '$env:'

/**
 * Resolve a config string into its final value.
 * - "$env:FOO"   → process.env.FOO
 * - ""/undefined → process.env[fallbackEnv]
 * - otherwise    → literal value
 */
function resolveSecret(configValue: string | undefined, fallbackEnv: string): string {
  if (configValue && configValue.startsWith(ENV_REF_PREFIX)) {
    const key = configValue.slice(ENV_REF_PREFIX.length).trim()
    return process.env[key] ?? ''
  }
  if (configValue && configValue.length > 0) return configValue
  return process.env[fallbackEnv] ?? ''
}

/** Argentine market clock — BYMA trades 11:00–17:00 America/Argentina/Buenos_Aires, Mon–Fri. */
function bymaClock(now: Date = new Date()): MarketClock {
  // Argentina is UTC-3 year-round (no DST since 2009)
  const artMs = now.getTime() - 3 * 60 * 60 * 1000
  const art = new Date(artMs)
  const dow = art.getUTCDay()      // 0=Sun ... 6=Sat
  const hour = art.getUTCHours()
  const minute = art.getUTCMinutes()
  const minuteOfDay = hour * 60 + minute
  const OPEN = 11 * 60
  const CLOSE = 17 * 60
  const isWeekday = dow >= 1 && dow <= 5
  const isOpen = isWeekday && minuteOfDay >= OPEN && minuteOfDay < CLOSE
  return { isOpen, timestamp: now }
}

/** IBKR order type → IOL modalidad. IOL supports limit and market only. */
function ibkrOrderTypeToIol(orderType: string): 'precioLimite' | 'precioMercado' {
  const t = orderType?.toUpperCase()
  if (t === 'MKT') return 'precioMercado'
  if (t === 'LMT') return 'precioLimite'
  throw new BrokerError('EXCHANGE', `IOL does not support order type "${orderType}" — use MKT or LMT`)
}

/** IBKR TIF → IOL plazo. Default spot settlement is t+2 (CI = t0 is cash-in-hand only). */
function ibkrTifToIolPlazo(tif: string | undefined): 't0' | 't1' | 't2' {
  const v = tif?.toUpperCase()
  // Unusual but supported: OPG/IOC have no direct mapping — default to t+2
  if (v === 'DAY' || v === 'GTC' || !v) return 't2'
  return 't2'
}

/** Default validity = end of the current trading day (Argentina). */
function defaultValidez(): string {
  const now = new Date()
  const artMs = now.getTime() - 3 * 60 * 60 * 1000
  const art = new Date(artMs)
  art.setUTCHours(20, 0, 0, 0) // 17:00 ART == 20:00 UTC
  return art.toISOString().replace(/\.\d+Z$/, '')
}

export class IolBroker implements IBroker {
  // ==================== Self-registration ====================

  static configSchema = z.object({
    username: z.string().default(''),
    password: z.string().default(''),
    market: z.string().default('bCBA'),
    sandbox: z.boolean().default(false),
  })

  static configFields: BrokerConfigField[] = [
    {
      name: 'username',
      type: 'text',
      label: 'Username / Email',
      placeholder: `Leave blank to read from ${ENV_USERNAME}`,
      description: `Your InvertirOnline account username. Accepts "$env:VAR" to read from a custom env var, or leave empty to use ${ENV_USERNAME}.`,
      sensitive: true,
    },
    {
      name: 'password',
      type: 'password',
      label: 'Password',
      placeholder: `Leave blank to read from ${ENV_PASSWORD}`,
      description: `Accepts "$env:VAR" to read from a custom env var, or leave empty to use ${ENV_PASSWORD}.`,
      sensitive: true,
    },
    {
      name: 'market',
      type: 'select',
      label: 'Default Market',
      default: 'bCBA',
      options: [
        { value: 'bCBA', label: 'BYMA / Buenos Aires (bCBA)' },
        { value: 'nYSE', label: 'NYSE' },
        { value: 'nASDAQ', label: 'NASDAQ' },
        { value: 'rOFX', label: 'ROFEX / MATBA' },
      ],
      description: 'Market used when a contract does not specify one.',
    },
    {
      name: 'sandbox',
      type: 'boolean',
      label: 'Dry-run Mode',
      default: false,
      description: 'When enabled, placeOrder is short-circuited (for testing) — no real orders are sent.',
    },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): IolBroker {
    const bc = IolBroker.configSchema.parse(config.brokerConfig)
    return new IolBroker({
      id: config.id,
      label: config.label,
      username: bc.username,
      password: bc.password,
      market: bc.market,
      sandbox: bc.sandbox,
    })
  }

  // ==================== Instance ====================

  readonly id: string
  readonly label: string

  private readonly configUsername: string
  private readonly configPassword: string
  private readonly market: string
  private readonly sandbox: boolean
  private client: IolApiClient | null = null

  constructor(config: IolBrokerConfig) {
    // Store the raw config values — resolved to real credentials at init() time
    this.configUsername = config.username
    this.configPassword = config.password
    this.market = config.market ?? 'bCBA'
    this.sandbox = config.sandbox ?? false
    this.id = config.id ?? 'iol-main'
    this.label = config.label ?? 'InvertirOnline'
  }

  // ==================== Lifecycle ====================

  async init(): Promise<void> {
    const username = resolveSecret(this.configUsername, ENV_USERNAME)
    const password = resolveSecret(this.configPassword, ENV_PASSWORD)
    if (!username || !password) {
      throw new BrokerError(
        'CONFIG',
        `No IOL credentials configured. Set brokerConfig.username/password in accounts.json, use "$env:VAR" references, or export ${ENV_USERNAME} and ${ENV_PASSWORD}.`,
      )
    }

    this.client = new IolApiClient(username, password)
    try {
      await this.client.authenticate()
      console.log(`IolBroker[${this.id}]: authenticated (market=${this.market}${this.sandbox ? ', DRY-RUN' : ''})`)
    } catch (err) {
      this.client = null
      throw err instanceof BrokerError ? err : BrokerError.from(err, 'AUTH')
    }
  }

  async close(): Promise<void> {
    // No socket to tear down — token will expire naturally
    this.client = null
  }

  private getClient(): IolApiClient {
    if (!this.client) throw new BrokerError('CONFIG', 'IolBroker not initialized — call init() first')
    return this.client
  }

  // ==================== Contract search ====================

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    // IOL has no free-text symbol search endpoint — treat pattern as an exact ticker.
    const desc = new ContractDescription()
    desc.contract = makeContract(pattern.toUpperCase(), this.market)
    return [desc]
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    const resolved = resolveSymbol(query, this.market)
    if (!resolved) return null
    const details = new ContractDetails()
    details.contract = makeContract(resolved.symbol, resolved.market)
    details.validExchanges = resolved.market
    details.orderTypes = 'MKT,LMT'
    return details
  }

  // ==================== Trading operations ====================

  async placeOrder(contract: Contract, order: Order, _tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    const resolved = resolveSymbol(contract, this.market)
    if (!resolved) return { success: false, error: 'Cannot resolve contract to IOL symbol' }

    let cantidad: number
    try {
      if (order.totalQuantity.equals(UNSET_DECIMAL)) {
        return { success: false, error: 'IOL requires totalQuantity (cashQty not supported)' }
      }
      cantidad = Number(order.totalQuantity.toString())
      if (!Number.isFinite(cantidad) || cantidad <= 0) {
        return { success: false, error: `Invalid quantity: ${order.totalQuantity}` }
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    let tipo: 'precioLimite' | 'precioMercado'
    try {
      tipo = ibkrOrderTypeToIol(order.orderType)
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }

    const body: IolPlaceOrderBody = {
      mercado: resolved.market,
      simbolo: resolved.symbol,
      cantidad,
      tipo,
      plazo: ibkrTifToIolPlazo(order.tif),
      validez: defaultValidez(),
    }
    if (tipo === 'precioLimite') {
      if (order.lmtPrice.equals(UNSET_DECIMAL) || order.lmtPrice == null) {
        return { success: false, error: 'LMT orders require lmtPrice' }
      }
      body.precio = order.lmtPrice.toNumber()
    }

    const action = (order.action ?? '').toUpperCase()
    if (action !== 'BUY' && action !== 'SELL') {
      return { success: false, error: `Unsupported order action: ${order.action}` }
    }

    if (this.sandbox) {
      return {
        success: true,
        orderId: `dry-run-${Date.now()}`,
        orderState: makeOrderState('pendiente'),
        message: 'DRY-RUN — no order sent',
      }
    }

    try {
      const client = this.getClient()
      const res = action === 'BUY' ? await client.comprar(body) : await client.vender(body)
      if (res.ok === false) {
        const msg = firstMessage(res.mensajes, res.messages, res.description, res.message) ?? 'IOL rejected order'
        return { success: false, error: msg, orderState: makeOrderState('rechazada', msg) }
      }
      return {
        success: true,
        orderId: res.numeroOperacion != null ? String(res.numeroOperacion) : undefined,
        orderState: makeOrderState('pendiente'),
      }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async modifyOrder(_orderId: string, _changes: Partial<Order>): Promise<PlaceOrderResult> {
    // IOL has no modify endpoint — caller must cancel + re-place
    return {
      success: false,
      error: 'IOL does not support order modification — cancel the order and place a new one',
    }
  }

  async cancelOrder(orderId: string): Promise<PlaceOrderResult> {
    try {
      await this.getClient().cancelarOperacion(orderId)
      return { success: true, orderId, orderState: makeOrderState('cancelada') }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  async closePosition(contract: Contract, quantity?: Decimal): Promise<PlaceOrderResult> {
    const resolved = resolveSymbol(contract, this.market)
    if (!resolved) return { success: false, error: 'Cannot resolve contract to IOL symbol' }

    const positions = await this.getPositions()
    const pos = positions.find(p => {
      const r = resolveSymbol(p.contract, this.market)
      return r && r.market === resolved.market && r.symbol === resolved.symbol
    })
    if (!pos) return { success: false, error: `No position for ${resolved.market}:${resolved.symbol}` }

    const closeQty = quantity ?? pos.quantity
    const order = new Order()
    order.action = pos.side === 'long' ? 'SELL' : 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = closeQty
    order.tif = 'DAY'
    return this.placeOrder(contract, order)
  }

  // ==================== Queries ====================

  async getAccount(): Promise<AccountInfo> {
    try {
      const estado = await this.getClient().getEstadoCuenta()
      const cuentas = estado.cuentas ?? []

      // Aggregate ARS-denominated subaccounts first; USD subaccounts reported separately would need FX
      const pesosAccounts = cuentas.filter((c: IolCuenta) => (c.moneda ?? '').toLowerCase().includes('peso'))
      const dollarAccounts = cuentas.filter((c: IolCuenta) => (c.moneda ?? '').toLowerCase().includes('dolar'))

      const sum = (list: IolCuenta[], field: keyof IolCuenta): Decimal =>
        list.reduce((acc, c) => acc.plus(new Decimal((c[field] as number) ?? 0)), new Decimal(0))

      // Prefer totalEnPesos (broker-computed ARS aggregate) for netLiquidation when available
      const netLiqArs = estado.totalEnPesos != null
        ? new Decimal(estado.totalEnPesos)
        : sum(pesosAccounts, 'total')
      const cashArs = sum(pesosAccounts, 'disponible')

      return {
        baseCurrency: 'ARS',
        netLiquidation: netLiqArs.toString(),
        totalCashValue: cashArs.toString(),
        unrealizedPnL: '0',
        buyingPower: sum(pesosAccounts, 'disponible').toString(),
        ...(dollarAccounts.length > 0 && {
          // Expose USD cash via extra field consumers can inspect; keep base=ARS for consistency
          realizedPnL: '0',
        }),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getPositions(): Promise<Position[]> {
    try {
      const pais = this.market === 'nYSE' || this.market === 'nASDAQ' ? 'estados_Unidos' : 'argentina'
      const portfolio = await this.getClient().getPortafolio(pais)
      const activos = portfolio.activos ?? []
      return activos.map((a: IolActivo) => this.mapPosition(a))
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  private mapPosition(a: IolActivo): Position {
    const contract = makeContract(a.titulo.simbolo, a.titulo.mercado)
    const qty = new Decimal(a.cantidad ?? 0)
    const avgCost = new Decimal(a.ppc ?? 0)
    const marketPrice = new Decimal(a.ultimoPrecio ?? 0)
    const marketValue = new Decimal(a.valorizado ?? qty.mul(marketPrice))
    return {
      contract,
      currency: mapCurrency(a.titulo.moneda),
      side: qty.isNegative() ? 'short' : 'long',
      quantity: qty.abs(),
      avgCost: avgCost.toString(),
      marketPrice: marketPrice.toString(),
      marketValue: marketValue.abs().toString(),
      unrealizedPnL: new Decimal(a.gananciaDinero ?? 0).toString(),
      realizedPnL: '0',
    }
  }

  async getOrders(orderIds: string[]): Promise<OpenOrder[]> {
    // When no ids supplied, return recent operations; otherwise fetch each by number.
    try {
      if (orderIds.length === 0) {
        const ops = await this.getClient().getOperaciones({ estado: 'todas' })
        return ops.map((o) => this.mapOpenOrder(o))
      }
      const out: OpenOrder[] = []
      for (const id of orderIds) {
        const o = await this.getOrder(id)
        if (o) out.push(o)
      }
      return out
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getOrder(orderId: string): Promise<OpenOrder | null> {
    try {
      const op = await this.getClient().getOperacion(orderId)
      return this.mapOpenOrder(op)
    } catch {
      return null
    }
  }

  private mapOpenOrder(o: IolOperacion): OpenOrder {
    const contract = makeContract(o.simbolo, o.mercado)
    const order = new Order()
    order.action = (o.tipo ?? '').toLowerCase().startsWith('c') ? 'BUY' : 'SELL'
    order.totalQuantity = new Decimal(o.cantidad ?? 0)
    order.orderType = o.modalidad === 'precioMercado' ? 'MKT' : 'LMT'
    if (o.precio != null) order.lmtPrice = new Decimal(o.precio)
    order.tif = 'DAY'
    order.orderId = 0  // IOL ids are numbers but not compatible with IBKR's 32-bit space
    if (o.cantidadOperada != null) order.filledQuantity = new Decimal(o.cantidadOperada)

    return {
      contract,
      order,
      orderState: makeOrderState(o.estado),
      ...(o.precioOperado != null && { avgFillPrice: o.precioOperado }),
    }
  }

  async getQuote(contract: Contract): Promise<Quote> {
    const resolved = resolveSymbol(contract, this.market)
    if (!resolved) throw new BrokerError('EXCHANGE', 'Cannot resolve contract to IOL symbol')

    try {
      const cot = await this.getClient().getCotizacion(resolved.market, resolved.symbol)
      const punta = cot.puntas ?? cot.puntasNegociables?.[0]
      return {
        contract: makeContract(resolved.symbol, resolved.market),
        last: cot.ultimoPrecio ?? 0,
        bid: punta?.precioCompra ?? 0,
        ask: punta?.precioVenta ?? 0,
        volume: cot.volumenNominal ?? 0,
        high: cot.maximo,
        low: cot.minimo,
        timestamp: cot.fecha ? new Date(cot.fecha) : new Date(),
      }
    } catch (err) {
      throw BrokerError.from(err)
    }
  }

  async getMarketClock(): Promise<MarketClock> {
    // IOL has no dedicated clock endpoint — compute from BYMA trading hours
    return bymaClock()
  }

  // ==================== Capabilities ====================

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK', 'BOND', 'FUND'],
      supportedOrderTypes: ['MKT', 'LMT'],
    }
  }

  // ==================== Contract identity ====================

  getNativeKey(contract: Contract): string {
    const resolved = resolveSymbol(contract, this.market)
    if (!resolved) return contract.symbol ?? ''
    return encodeNativeKey(resolved.market, resolved.symbol)
  }

  resolveNativeKey(nativeKey: string): Contract {
    const { market, symbol } = decodeNativeKey(nativeKey)
    return makeContract(symbol, market)
  }
}

// ==================== Local helpers ====================

function firstMessage(...sources: Array<string[] | string | undefined>): string | undefined {
  for (const s of sources) {
    if (Array.isArray(s) && s.length > 0) return s[0]
    if (typeof s === 'string' && s.length > 0) return s
  }
  return undefined
}
