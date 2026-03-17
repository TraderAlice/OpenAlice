/**
 * Mock IBroker for testing.
 *
 * All methods are vi.fn() so callers can override return values or inspect calls.
 */

import { vi } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, ContractDescription, ContractDetails, Order, OrderState } from '@traderalice/ibkr'
import type {
  IBroker,
  AccountCapabilities,
  AccountInfo,
  Position,
  PlaceOrderResult,
  OpenOrder,
  Quote,
  MarketClock,
} from '../brokers/types.js'
import '../contract-ext.js'

// ==================== Defaults ====================

export const DEFAULT_ACCOUNT_INFO: AccountInfo = {
  netLiquidation: 105_000,
  totalCashValue: 100_000,
  unrealizedPnL: 5_000,
  realizedPnL: 1_000,
  buyingPower: 200_000,
}

export const DEFAULT_CAPABILITIES: AccountCapabilities = {
  supportedSecTypes: ['STK'],
  supportedOrderTypes: ['MKT', 'LMT', 'STP', 'STP LMT'],
}

export function makeContract(overrides: Partial<Contract> & { aliceId?: string } = {}): Contract {
  const c = new Contract()
  c.aliceId = overrides.aliceId ?? 'mock-AAPL'
  c.symbol = overrides.symbol ?? 'AAPL'
  c.secType = overrides.secType ?? 'STK'
  c.exchange = overrides.exchange ?? 'NASDAQ'
  c.currency = overrides.currency ?? 'USD'
  return c
}

export function makePosition(overrides: Partial<Position> = {}): Position {
  const contract = overrides.contract ?? makeContract()
  return {
    contract,
    side: 'long',
    quantity: new Decimal(10),
    avgCost: 150,
    marketPrice: 160,
    marketValue: 1600,
    unrealizedPnL: 100,
    realizedPnL: 0,
    leverage: 1,
    ...overrides,
  }
}

export function makeOpenOrder(overrides: Partial<OpenOrder> = {}): OpenOrder {
  const contract = overrides.contract ?? makeContract()
  const order = overrides.order ?? new Order()
  if (!overrides.order) {
    order.action = 'BUY'
    order.orderType = 'MKT'
    order.totalQuantity = new Decimal(10)
  }
  const orderState = overrides.orderState ?? new OrderState()
  if (!overrides.orderState) {
    orderState.status = 'Filled'
  }
  return { contract, order, orderState }
}

export function makePlaceOrderResult(overrides: Partial<PlaceOrderResult> = {}): PlaceOrderResult {
  return {
    success: true,
    orderId: 'order-1',
    ...overrides,
  }
}

// ==================== MockBroker ====================

export interface MockBrokerOptions {
  id?: string
  provider?: string
  label?: string
  capabilities?: Partial<AccountCapabilities>
  positions?: Position[]
  orders?: OpenOrder[]
  accountInfo?: Partial<AccountInfo>
}

export class MockBroker implements IBroker {
  readonly id: string
  readonly provider: string
  readonly label: string

  private _capabilities: AccountCapabilities
  private _positions: Position[]
  private _orders: OpenOrder[]
  private _accountInfo: AccountInfo

  // Spied methods
  init = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
  close = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)

  searchContracts = vi.fn<(pattern: string) => Promise<ContractDescription[]>>()
    .mockImplementation(async () => {
      const desc = new ContractDescription()
      desc.contract = makeContract()
      return [desc]
    })

  getContractDetails = vi.fn<(query: Contract) => Promise<ContractDetails | null>>()
    .mockImplementation(async () => {
      const details = new ContractDetails()
      details.contract = makeContract()
      details.longName = 'Apple Inc.'
      return details
    })

  placeOrder = vi.fn<(contract: Contract, order: Order) => Promise<PlaceOrderResult>>()
    .mockResolvedValue(makePlaceOrderResult())

  modifyOrder = vi.fn<(orderId: string, changes: Order) => Promise<PlaceOrderResult>>()
    .mockResolvedValue(makePlaceOrderResult())

  cancelOrder = vi.fn<(orderId: string) => Promise<boolean>>()
    .mockResolvedValue(true)

  closePosition = vi.fn<(contract: Contract, qty?: Decimal) => Promise<PlaceOrderResult>>()
    .mockResolvedValue(makePlaceOrderResult())

  getQuote = vi.fn<(contract: Contract) => Promise<Quote>>()
    .mockResolvedValue({
      contract: makeContract(),
      last: 160,
      bid: 159.9,
      ask: 160.1,
      volume: 1_000_000,
      timestamp: new Date(),
    })

  getMarketClock = vi.fn<() => Promise<MarketClock>>()
    .mockResolvedValue({
      isOpen: true,
      nextClose: new Date('2025-01-01T21:00:00Z'),
    })

  constructor(options: MockBrokerOptions = {}) {
    this.id = options.id ?? 'mock-paper'
    this.provider = options.provider ?? 'mock'
    this.label = options.label ?? 'Mock Paper Account'
    this._capabilities = { ...DEFAULT_CAPABILITIES, ...options.capabilities }
    this._positions = options.positions ?? []
    this._orders = options.orders ?? []
    this._accountInfo = { ...DEFAULT_ACCOUNT_INFO, ...options.accountInfo }
  }

  getCapabilities(): AccountCapabilities {
    return this._capabilities
  }

  getAccount = vi.fn<() => Promise<AccountInfo>>()
    .mockImplementation(async () => this._accountInfo)

  getPositions = vi.fn<() => Promise<Position[]>>()
    .mockImplementation(async () => this._positions)

  getOrders = vi.fn<() => Promise<OpenOrder[]>>()
    .mockImplementation(async () => this._orders)

  // ---- Test helpers ----

  setPositions(positions: Position[]): void {
    this._positions = positions
  }

  setOrders(orders: OpenOrder[]): void {
    this._orders = orders
  }

  setAccountInfo(info: Partial<AccountInfo>): void {
    this._accountInfo = { ...this._accountInfo, ...info }
  }
}
