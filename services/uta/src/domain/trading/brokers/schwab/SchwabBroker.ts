/**
 * SchwabBroker — read-only IBroker adapter for Charles Schwab Trader API.
 *
 * This broker is intentionally portfolio-focused:
 * - OAuth access is handled with Schwab refresh tokens.
 * - Account and position reads are supported.
 * - Order writes are refused at the broker boundary.
 *
 * The goal for OpenAlice is Schwab portfolio visibility without pretending
 * we have a production-grade Schwab order router.
 */

import { z } from 'zod'
import Decimal from 'decimal.js'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, isAbsolute, relative, resolve } from 'node:path'
import { Contract, ContractDescription, ContractDetails, Order } from '@traderalice/ibkr'
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
import { dataPath } from '@/core/paths.js'
import { isSealedEnvelope, seal, unseal } from '@/core/sealing.js'
import { buildContract, buildPosition } from '../contract-builder.js'
import { aggregateAccountFromPositions } from '../../position-math.js'

const SCHWAB_API_BASE = 'https://api.schwabapi.com'
const SCHWAB_OAUTH_TOKEN_URL = `${SCHWAB_API_BASE}/v1/oauth/token`
const SCHWAB_TRADER_BASE = `${SCHWAB_API_BASE}/trader/v1`
const TOKEN_REFRESH_MARGIN_MS = 60_000

export interface SchwabBrokerConfig {
  id?: string
  label?: string
  clientId: string
  clientSecret: string
  refreshToken?: string
  tokenPath?: string
  accountNumber?: string
}

interface SchwabTokenState {
  accessToken?: string
  refreshToken?: string
  expiresAtMs?: number
  raw?: Record<string, unknown>
}

interface SchwabBalanceRaw {
  cashBalance?: number | string
  liquidationValue?: number | string
  buyingPower?: number | string
  availableFunds?: number | string
  maintenanceRequirement?: number | string
  maintenanceMargin?: number | string
  initialMarginRequirement?: number | string
  dayTradingBuyingPower?: number | string
  longMarketValue?: number | string
  shortMarketValue?: number | string
  unrealizedPnL?: number | string
  realizedPnL?: number | string
}

interface SchwabInstrumentRaw {
  assetType?: string
  symbol?: string
  description?: string
  exchange?: string
  primaryExchange?: string
  currency?: string
  underlyingSymbol?: string
  putCall?: string
  expirationDate?: string
  strikePrice?: number | string
  multiplier?: number | string
}

interface SchwabPositionRaw {
  instrument?: SchwabInstrumentRaw
  symbol?: string
  longQuantity?: number | string
  shortQuantity?: number | string
  averagePrice?: number | string
  averageLongPrice?: number | string
  averageShortPrice?: number | string
  marketPrice?: number | string
  marketValue?: number | string
  currentDayProfitLoss?: number | string
  currentDayProfitLossPercentage?: number | string
  longOpenProfitLoss?: number | string
  shortOpenProfitLoss?: number | string
  assetType?: string
}

interface SchwabAccountRaw {
  accountNumber?: string
  hashValue?: string
  currentBalances?: SchwabBalanceRaw
  aggregatedBalance?: SchwabBalanceRaw
  positions?: SchwabPositionRaw[]
  orderStrategies?: unknown[]
  securitiesAccount?: SchwabAccountRaw
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function toStr(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s ? s : undefined
}

function toDecimal(v: unknown, fallback = '0'): Decimal {
  const s = toStr(v) ?? fallback
  return new Decimal(s)
}

function numFrom(v: unknown): number | undefined {
  if (v == null || v === '') return undefined
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

function trimDecimal(v: string): string {
  if (!v.includes('.')) return v
  return v.replace(/\.?0+$/, '')
}

function formatDateLike(value: string | undefined): string | undefined {
  if (!value) return undefined
  const s = value.trim()
  if (!s) return undefined
  return s.replace(/-/g, '')
}

function parsePutCall(value: string | undefined): 'C' | 'P' | undefined {
  const v = value?.trim().toUpperCase()
  if (!v) return undefined
  if (v === 'CALL' || v === 'C') return 'C'
  if (v === 'PUT' || v === 'P') return 'P'
  return undefined
}

function normalizeAccountPayload(payload: unknown): SchwabAccountRaw[] {
  const unwrap = (row: unknown): SchwabAccountRaw | null => {
    if (!isRecord(row)) return null
    if (isRecord(row.securitiesAccount)) return row.securitiesAccount as SchwabAccountRaw
    return row as SchwabAccountRaw
  }

  if (Array.isArray(payload)) return payload.map(unwrap).filter((v): v is SchwabAccountRaw => v !== null)
  if (!isRecord(payload)) return []
  if (Array.isArray(payload.accounts)) return payload.accounts.map(unwrap).filter((v): v is SchwabAccountRaw => v !== null)
  if (Array.isArray(payload.securitiesAccounts)) return payload.securitiesAccounts.map(unwrap).filter((v): v is SchwabAccountRaw => v !== null)
  if (payload.securitiesAccount) {
    const row = unwrap(payload.securitiesAccount)
    return row ? [row] : []
  }
  return []
}

function makeStockContract(symbol: string, description?: string, exchange = 'SMART', currency = 'USD'): Contract {
  return buildContract({
    symbol,
    secType: 'STK',
    exchange,
    currency,
    localSymbol: symbol,
    description,
  })
}

function makeOptionContract(input: {
  symbol: string
  expiry: string
  strike: number
  right: 'C' | 'P'
  multiplier: string
  description?: string
  exchange?: string
  currency?: string
  localSymbol?: string
}): Contract {
  return buildContract({
    symbol: input.symbol,
    secType: 'OPT',
    exchange: input.exchange ?? 'SMART',
    currency: input.currency ?? 'USD',
    localSymbol: input.localSymbol ?? input.symbol,
    lastTradeDateOrContractMonth: input.expiry,
    strike: input.strike,
    right: input.right,
    multiplier: input.multiplier,
    description: input.description,
  })
}

export class SchwabBroker implements IBroker {
  static configSchema = z.object({
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
    refreshToken: z.string().min(1).optional(),
    tokenPath: z.string().min(1).optional(),
    accountNumber: z.string().optional(),
  }).superRefine((data, ctx) => {
    if (!data.refreshToken && !data.tokenPath) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['refreshToken'],
        message: 'Provide either refreshToken or tokenPath',
      })
    }
  })

  static configFields: BrokerConfigField[] = [
    { name: 'clientId', type: 'text', label: 'Client ID', required: true },
    { name: 'clientSecret', type: 'password', label: 'Client Secret', required: true, sensitive: true },
    { name: 'refreshToken', type: 'password', label: 'Refresh Token', sensitive: true, description: 'Optional if tokenPath points to an OAuth token JSON file.' },
    { name: 'tokenPath', type: 'text', label: 'Token Path', description: 'Optional path under this account\'s trading data dir for a Schwab OAuth token JSON file. OpenAlice will refresh and persist the token here, sealed at rest.' },
    { name: 'accountNumber', type: 'text', label: 'Account Number', description: 'Optional; leave blank to aggregate every linked account under the login.' },
  ]

  static fromConfig(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }): SchwabBroker {
    const bc = SchwabBroker.configSchema.parse(config.brokerConfig)
    return new SchwabBroker({
      id: config.id,
      label: config.label,
      clientId: bc.clientId,
      clientSecret: bc.clientSecret,
      refreshToken: bc.refreshToken,
      tokenPath: bc.tokenPath,
      accountNumber: bc.accountNumber,
    })
  }

  readonly id: string
  readonly label: string

  private readonly cfg: SchwabBrokerConfig
  private tokenState: SchwabTokenState | null = null
  private initialized = false

  constructor(cfg: SchwabBrokerConfig) {
    this.cfg = cfg
    this.id = cfg.id ?? (cfg.accountNumber ? `schwab-${cfg.accountNumber}` : 'schwab-portfolio')
    this.label = cfg.label ?? (cfg.accountNumber ? `Schwab ${cfg.accountNumber}` : 'Schwab Portfolio')
  }

  private get tokenPath(): string {
    const baseDir = dataPath('trading', this.id)
    const candidate = this.cfg.tokenPath ?? 'schwab-token.json'
    const path = isAbsolute(candidate) ? resolve(candidate) : resolve(baseDir, candidate)
    const rel = relative(baseDir, path)
    if (rel.startsWith('..') || rel === '..' || isAbsolute(rel)) {
      throw new BrokerError('CONFIG', `Schwab tokenPath must stay inside ${baseDir}.`)
    }
    return path
  }

  async init(): Promise<void> {
    await this.ensureToken(false)
    const rows = await this.fetchAccounts().catch((err) => {
      throw this.toBrokerError(err)
    })
    if (rows.length === 0) {
      throw new BrokerError(
        'CONFIG',
        this.cfg.accountNumber
          ? `Schwab account "${this.cfg.accountNumber}" not found for this login.`
          : 'Schwab Trader API returned no accessible accounts for this login.',
      )
    }
    this.initialized = true
    console.log(`SchwabBroker[${this.id}]: connected (${this.cfg.accountNumber ? `account=${this.cfg.accountNumber}` : 'all linked accounts'})`)
  }

  async close(): Promise<void> {
    // No persistent client handles.
  }

  // ==================== Public reads ====================

  async searchContracts(pattern: string): Promise<ContractDescription[]> {
    if (!pattern) return []
    const symbol = pattern.trim().toUpperCase()
    if (!symbol) return []
    const desc = new ContractDescription()
    desc.contract = makeStockContract(symbol, `Schwab ${symbol}`)
    desc.derivativeSecTypes = ['OPT']
    return [desc]
  }

  async getContractDetails(query: Contract): Promise<ContractDetails | null> {
    if (!query.symbol) return null
    const details = new ContractDetails()
    details.contract = query.secType === 'OPT' && query.lastTradeDateOrContractMonth && query.strike != null && query.right
      ? buildContract({
          symbol: query.symbol,
          secType: 'OPT',
          exchange: query.exchange || 'SMART',
          currency: query.currency || 'USD',
          localSymbol: query.localSymbol || query.symbol,
          lastTradeDateOrContractMonth: query.lastTradeDateOrContractMonth,
          strike: Number(query.strike),
          right: query.right as 'C' | 'P',
          multiplier: query.multiplier || '100',
          description: query.description,
        })
      : makeStockContract(query.symbol, query.description, query.exchange || 'SMART', query.currency || 'USD')
    details.longName = query.description || query.symbol
    details.orderTypes = 'MKT,LMT,STP,STP LMT,TRAIL'
    return details
  }

  async placeOrder(_contract: Contract, _order: Order, _tpsl?: TpSlParams): Promise<PlaceOrderResult> {
    return { success: false, error: 'Schwab support in OpenAlice is read-only. Order placement is disabled.' }
  }

  async modifyOrder(_orderId: string, _changes: Partial<Order>): Promise<PlaceOrderResult> {
    return { success: false, error: 'Schwab support in OpenAlice is read-only. Order modification is disabled.' }
  }

  async cancelOrder(_orderId: string): Promise<PlaceOrderResult> {
    return { success: false, error: 'Schwab support in OpenAlice is read-only. Order cancellation is disabled.' }
  }

  async closePosition(_contract: Contract, _quantity?: Decimal): Promise<PlaceOrderResult> {
    return { success: false, error: 'Schwab support in OpenAlice is read-only. Closing positions is disabled.' }
  }

  async getOrder(_orderId: string): Promise<OpenOrder | null> {
    return null
  }

  async getAccount(subAccountId?: string): Promise<AccountInfo> {
    const rows = await this.fetchAccounts(subAccountId)
    if (rows.length === 0) {
      throw new BrokerError('CONFIG', this.cfg.accountNumber
        ? `Schwab account "${this.cfg.accountNumber}" not found for this login.`
        : 'No Schwab accounts returned by the Trader API.')
    }

    const positions = rows.flatMap((row) => this.mapPositions(row))
    const cash = rows.reduce((sum, row) => sum.plus(this.balanceValue(row, 'cashBalance') ?? 0), new Decimal(0))
    const buyingPower = rows.reduce((sum, row) => sum.plus(this.balanceValue(row, 'buyingPower') ?? 0), new Decimal(0))
    const maintMarginReq = rows.reduce((sum, row) => sum.plus(this.balanceValue(row, 'maintenanceRequirement') ?? 0), new Decimal(0))
    const initMarginReq = rows.reduce((sum, row) => sum.plus(this.balanceValue(row, 'initialMarginRequirement') ?? 0), new Decimal(0))

    const fallback = aggregateAccountFromPositions(cash, positions)
    const netLiq = rows.reduce((sum, row) => {
      const v = this.balanceValue(row, 'liquidationValue')
      return sum.plus(v ?? 0)
    }, new Decimal(0))

    const unrealized = positions.reduce((sum, pos) => sum.plus(pos.unrealizedPnL), new Decimal(0))
    const realized = rows.reduce((sum, row) => sum.plus(this.balanceValue(row, 'realizedPnL') ?? 0), new Decimal(0))

    return {
      baseCurrency: 'USD',
      netLiquidation: (netLiq.gt(0) ? netLiq : fallback.netLiquidation).toString(),
      totalCashValue: cash.toString(),
      unrealizedPnL: unrealized.toString(),
      realizedPnL: realized.toString(),
      buyingPower: buyingPower.gt(0) ? buyingPower.toString() : undefined,
      initMarginReq: initMarginReq.gt(0) ? initMarginReq.toString() : undefined,
      maintMarginReq: maintMarginReq.gt(0) ? maintMarginReq.toString() : undefined,
    }
  }

  async getPositions(subAccountId?: string): Promise<Position[]> {
    const rows = await this.fetchAccounts(subAccountId)
    return rows.flatMap((row) => this.mapPositions(row))
  }

  async getOrders(_orderIds: string[]): Promise<OpenOrder[]> {
    return []
  }

  async getQuote(_contract: Contract): Promise<Quote> {
    throw new BrokerError('CONFIG', 'Schwab quote lookup is not implemented yet. OpenAlice only uses Schwab for portfolio reads.')
  }

  async getMarketClock(): Promise<MarketClock> {
    return this.usMarketClock()
  }

  getCapabilities(): AccountCapabilities {
    return {
      supportedSecTypes: ['STK', 'OPT', 'FUND'],
      supportedOrderTypes: [],
    }
  }

  getNativeKey(contract: Contract): string {
    const symbol = contract.symbol || contract.localSymbol || 'UNKNOWN'
    const secType = (contract.secType || 'STK').toUpperCase()
    if (secType === 'OPT' || secType === 'FOP') {
      const expiry = contract.lastTradeDateOrContractMonth || ''
      const right = (contract.right || '').toUpperCase()
      const strike = trimDecimal(String(contract.strike ?? ''))
      const multiplier = trimDecimal(String(contract.multiplier || '100'))
      return ['OPT', symbol, expiry, right, strike, multiplier].join('|')
    }
    if (secType === 'FUT') {
      return ['FUT', symbol, contract.lastTradeDateOrContractMonth || '', trimDecimal(String(contract.multiplier || '1'))].join('|')
    }
    return ['STK', symbol].join('|')
  }

  resolveNativeKey(nativeKey: string): Contract {
    const parts = nativeKey.split('|')
    if (parts.length === 0) return makeStockContract(nativeKey)

    if (parts[0] === 'OPT') {
      const [, symbol, expiry, right, strike, multiplier] = parts
      if (symbol && expiry && (right === 'C' || right === 'P') && strike) {
        return makeOptionContract({
          symbol,
          expiry,
          right,
          strike: Number(strike),
          multiplier: multiplier || '100',
          localSymbol: symbol,
          exchange: 'SMART',
          currency: 'USD',
        })
      }
    }

    if (parts[0] === 'FUT') {
      const [, symbol, expiry, multiplier] = parts
      if (symbol) {
        return buildContract({
          symbol,
          secType: 'FUT',
          exchange: 'SMART',
          currency: 'USD',
          localSymbol: symbol,
          lastTradeDateOrContractMonth: expiry || undefined,
          multiplier: multiplier || '1',
        })
      }
    }

    return makeStockContract(parts[1] || nativeKey)
  }

  // ==================== Internal helpers ====================

  private async ensureToken(forceRefresh = false): Promise<SchwabTokenState> {
    if (!this.tokenState) {
      this.tokenState = await this.loadTokenState()
    }
    if (forceRefresh || this.needsRefresh(this.tokenState)) {
      this.tokenState = await this.refreshToken(this.tokenState)
      await this.persistTokenState(this.tokenState)
    }
    return this.tokenState
  }

  private needsRefresh(state: SchwabTokenState): boolean {
    if (!state.accessToken) return true
    if (!state.expiresAtMs) return false
    return Date.now() >= state.expiresAtMs - TOKEN_REFRESH_MARGIN_MS
  }

  private async loadTokenState(): Promise<SchwabTokenState> {
    let fileState: Record<string, unknown> = {}
    try {
      const raw = JSON.parse(await readFile(this.tokenPath, 'utf-8'))
      if (isSealedEnvelope(raw)) {
        const unsealed = await unseal<unknown>(raw)
        if (isRecord(unsealed)) fileState = unsealed
      } else if (isRecord(raw)) {
        fileState = raw
      }
    } catch {
      fileState = {}
    }

    const expiresAtMs = this.extractExpiresAtMs(fileState)
    return {
      accessToken: toStr(fileState.access_token) ?? toStr(fileState.accessToken) ?? toStr(fileState.access_token_value) ?? toStr(fileState.access) ?? undefined,
      refreshToken: toStr(fileState.refresh_token) ?? toStr(fileState.refreshToken) ?? this.cfg.refreshToken ?? undefined,
      expiresAtMs,
      raw: Object.keys(fileState).length > 0 ? fileState : undefined,
    }
  }

  private extractExpiresAtMs(raw: Record<string, unknown>): number | undefined {
    const candidates = [
      raw.expires_at,
      raw.expiresAt,
      raw.expires_at_ms,
      raw.expiresAtMs,
      raw.access_token_expires_at,
    ]
    for (const candidate of candidates) {
      if (typeof candidate === 'number' && Number.isFinite(candidate)) {
        return candidate > 1e12 ? candidate : Date.now() + candidate * 1000
      }
      if (typeof candidate === 'string' && candidate) {
        const asNum = Number(candidate)
        if (Number.isFinite(asNum)) {
          return asNum > 1e12 ? asNum : Date.now() + asNum * 1000
        }
        const asDate = new Date(candidate)
        if (!Number.isNaN(asDate.getTime())) return asDate.getTime()
      }
    }
    return undefined
  }

  private async refreshToken(previous: SchwabTokenState): Promise<SchwabTokenState> {
    const refreshToken = previous.refreshToken ?? this.cfg.refreshToken
    if (!refreshToken) {
      throw new BrokerError(
        'CONFIG',
        `No Schwab refresh token available. Provide refreshToken or tokenPath, then retry. The token file can be generated with Schwab OAuth tooling and will be kept up to date automatically.`,
      )
    }

    const basic = Buffer.from(`${this.cfg.clientId}:${this.cfg.clientSecret}`).toString('base64')
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    })

    let response: Response
    try {
      response = await fetch(SCHWAB_OAUTH_TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${basic}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body,
      })
    } catch (err) {
      throw BrokerError.from(err, 'NETWORK')
    }

    if (!response.ok) {
      const msg = await this.responseErrorMessage(response)
      throw new BrokerError(response.status === 401 ? 'AUTH' : 'NETWORK', `Schwab token refresh failed: ${msg}`)
    }

    const json = await response.json().catch(() => ({}))
    if (!isRecord(json) || !toStr(json.access_token ?? json.accessToken)) {
      throw new BrokerError('AUTH', 'Schwab token refresh succeeded but the response did not contain an access token.')
    }

    const expiresIn = numFrom(json.expires_in ?? json.expiresIn)
    return {
      accessToken: toStr(json.access_token ?? json.accessToken) ?? undefined,
      refreshToken: toStr(json.refresh_token ?? json.refreshToken) ?? refreshToken,
      expiresAtMs: expiresIn ? Date.now() + expiresIn * 1000 : previous.expiresAtMs,
      raw: { ...(previous.raw ?? {}), ...(json as Record<string, unknown>) },
    }
  }

  private async persistTokenState(state: SchwabTokenState): Promise<void> {
    const raw = {
      ...(state.raw ?? {}),
      access_token: state.accessToken,
      refresh_token: state.refreshToken,
      expires_at: state.expiresAtMs ? new Date(state.expiresAtMs).toISOString() : undefined,
    }
    await mkdir(dirname(this.tokenPath), { recursive: true })
    await writeFile(this.tokenPath, JSON.stringify(await seal(raw), null, 2) + '\n', { mode: 0o600 })
  }

  private async apiFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
    const token = await this.ensureToken()
    if (!token.accessToken) {
      throw new BrokerError('AUTH', 'No Schwab access token available.')
    }

    const headers = new Headers(init.headers ?? {})
    headers.set('Authorization', `Bearer ${token.accessToken}`)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) {
      headers.set('Content-Type', 'application/json')
    }

    const response = await fetch(`${SCHWAB_TRADER_BASE}${path}`, {
      ...init,
      headers,
    }).catch((err) => {
      throw BrokerError.from(err, 'NETWORK')
    })

    if (response.status === 401 && retry) {
      this.tokenState = await this.refreshToken(token)
      await this.persistTokenState(this.tokenState)
      return this.apiFetch(path, init, false)
    }

    if (!response.ok) {
      const msg = await this.responseErrorMessage(response)
      const code = response.status === 401 ? 'AUTH' : response.status === 403 ? 'EXCHANGE' : 'NETWORK'
      throw new BrokerError(code, `Schwab API ${path} failed (${response.status}): ${msg}`)
    }
    return response
  }

  private async responseErrorMessage(response: Response): Promise<string> {
    const text = await response.text().catch(() => '')
    if (!text) return response.statusText || 'Unknown error'
    try {
      const parsed = JSON.parse(text)
      if (isRecord(parsed)) {
        return toStr(parsed.error) ?? toStr(parsed.message) ?? JSON.stringify(parsed)
      }
    } catch {
      // plain text body
    }
    return text.slice(0, 500)
  }

  private async fetchAccounts(subAccountId?: string): Promise<SchwabAccountRaw[]> {
    const response = await this.apiFetch('/accounts?fields=positions')
    const payload = await response.json().catch(() => ({}))
    const rows = normalizeAccountPayload(payload)
    const selected = this.selectRows(rows, subAccountId)
    if (selected.length > 0) return selected
    if (toStr(subAccountId) || toStr(this.cfg.accountNumber)) return []
    return rows
  }

  private selectRows(rows: SchwabAccountRaw[], subAccountId?: string): SchwabAccountRaw[] {
    const wanted = toStr(subAccountId) ?? toStr(this.cfg.accountNumber)
    if (!wanted) return rows
    const matches = rows.filter((row) => toStr(row.accountNumber) === wanted)
    if (matches.length > 0) return matches
    return rows.filter((row) => toStr(row.hashValue) === wanted)
  }

  private mapPositions(row: SchwabAccountRaw): Position[] {
    const out: Position[] = []
    for (const raw of row.positions ?? []) {
      const mapped = this.mapPosition(raw)
      if (mapped) out.push(mapped)
    }
    return out
  }

  private mapPosition(raw: SchwabPositionRaw): Position | null {
    const instrument = raw.instrument ?? {}
    const assetType = (instrument.assetType ?? raw.assetType ?? '').toUpperCase()
    const symbol = toStr(instrument.underlyingSymbol ?? instrument.symbol ?? raw.symbol)
    if (!symbol) return null

    if (assetType === 'OPTION') {
      const expiry = formatDateLike(instrument.expirationDate)
      const right = parsePutCall(instrument.putCall)
      const strike = numFrom(instrument.strikePrice)
      if (!expiry || !right || strike == null) return null
      const contract = makeOptionContract({
        symbol,
        expiry,
        strike,
        right,
        multiplier: trimDecimal(String(instrument.multiplier ?? 100)),
        description: instrument.description ?? raw.symbol ?? symbol,
        exchange: toStr(instrument.exchange ?? instrument.primaryExchange) ?? 'SMART',
        currency: toStr(instrument.currency) ?? 'USD',
        localSymbol: toStr(raw.symbol ?? instrument.symbol ?? symbol) ?? symbol,
      })
      return this.buildPositionFromRow(contract, raw, true)
    }

    if (assetType === 'FUTURE') {
      const expiry = formatDateLike(instrument.expirationDate)
      const contract = buildContract({
        symbol,
        secType: 'FUT',
        exchange: toStr(instrument.exchange ?? instrument.primaryExchange) ?? 'SMART',
        currency: toStr(instrument.currency) ?? 'USD',
        localSymbol: toStr(raw.symbol ?? instrument.symbol ?? symbol) ?? symbol,
        lastTradeDateOrContractMonth: expiry,
        multiplier: trimDecimal(String(instrument.multiplier ?? 1)) || '1',
        description: instrument.description ?? raw.symbol ?? symbol,
      })
      return this.buildPositionFromRow(contract, raw, false)
    }

    const contract = makeStockContract(
      symbol,
      instrument.description ?? raw.symbol ?? symbol,
      toStr(instrument.exchange ?? instrument.primaryExchange) ?? 'SMART',
      toStr(instrument.currency) ?? 'USD',
    )
    return this.buildPositionFromRow(contract, raw, false)
  }

  private buildPositionFromRow(contract: Contract, raw: SchwabPositionRaw, derivative = false): Position {
    const longQty = toDecimal(raw.longQuantity)
    const shortQty = toDecimal(raw.shortQuantity)
    const netQty = longQty.minus(shortQty)
    const quantity = netQty.abs()
    const side = netQty.isNegative() ? 'short' : 'long'
    const multiplier = trimDecimal(String(contract.multiplier || (derivative ? '100' : '1'))) || '1'

    const marketValueRaw = raw.marketValue != null ? toDecimal(raw.marketValue).abs() : null
    const marketPrice = marketValueRaw && quantity.gt(0)
      ? marketValueRaw.div(quantity).toString()
      : toStr(raw.marketPrice)
        ?? toStr(raw.averagePrice)
        ?? toStr(raw.averageLongPrice)
        ?? toStr(raw.averageShortPrice)
        ?? '0'
    const avgCost = toStr(
      side === 'short'
        ? raw.averageShortPrice ?? raw.averagePrice ?? raw.averageLongPrice ?? marketPrice
        : raw.averageLongPrice ?? raw.averagePrice ?? raw.averageShortPrice ?? marketPrice,
    ) ?? marketPrice

    const marketValue = marketValueRaw?.toString()
      ?? quantity.mul(marketPrice).mul(multiplier).toString()
    const realizedPnL = toStr((raw as Record<string, unknown>).realizedPnL) ?? '0'

    return buildPosition({
      contract,
      currency: contract.currency || 'USD',
      side,
      quantity,
      avgCost,
      marketPrice,
      marketValue,
      unrealizedPnL: toStr(raw.longOpenProfitLoss ?? raw.shortOpenProfitLoss) ?? undefined,
      realizedPnL,
      multiplier,
      avgCostSource: 'broker',
    })
  }

  private balanceValue(row: SchwabAccountRaw, field: keyof SchwabBalanceRaw): Decimal | undefined {
    const balance = row.currentBalances ?? row.aggregatedBalance ?? {}
    const raw = balance[field]
    return raw == null || raw === '' ? undefined : new Decimal(raw)
  }

  private toBrokerError(err: unknown): BrokerError {
    return err instanceof BrokerError ? err : BrokerError.from(err)
  }

  private usMarketClock(): MarketClock {
    const now = new Date()
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).formatToParts(now)

    const pick = (type: string): string => parts.find((p) => p.type === type)?.value ?? '0'
    const year = Number(pick('year'))
    const month = Number(pick('month'))
    const day = Number(pick('day'))
    const hour = Number(pick('hour'))
    const minute = Number(pick('minute'))
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
    const minutes = hour * 60 + minute
    const openMinutes = 9 * 60 + 30
    const closeMinutes = 16 * 60
    const isWeekday = weekday >= 1 && weekday <= 5
    const isOpen = isWeekday && minutes >= openMinutes && minutes < closeMinutes

    const nextOpen = isOpen
      ? undefined
      : (() => {
          const next = new Date(now)
          const addDays = (days: number) => next.setDate(next.getDate() + days)
          if (weekday === 6) addDays(2)
          else if (weekday === 0) addDays(1)
          else if (minutes >= closeMinutes) addDays(1)
          if (next.getDay() === 6) addDays(2)
          if (next.getDay() === 0) addDays(1)
          next.setHours(9, 30, 0, 0)
          return next
        })()

    const nextClose = isOpen
      ? (() => {
          const close = new Date(now)
          close.setHours(16, 0, 0, 0)
          return close
        })()
      : undefined

    return { isOpen, nextOpen, nextClose, timestamp: now }
  }
}
