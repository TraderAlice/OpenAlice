import type {
  TradingAccount,
  UTASummary,
  AccountInfo,
  Position,
  UTAConfig,
  EquityCurvePoint,
  UTASnapshotSummary,
  HistoryContract,
  OrderHistoryEntry,
  TradeHistoryEntry,
} from '../../api/types'

export const DEMO_UTA_ID = 'demo-uta'           // alias kept for back-compat
export const DEMO_UTA_PAPER = 'demo-paper'
export const DEMO_UTA_IBKR = 'demo-ibkr'
export const DEMO_UTA_CRYPTO = 'demo-crypto'

// ==================== UTA listing ====================

export const demoTradingAccounts: TradingAccount[] = [
  { id: DEMO_UTA_PAPER, provider: 'alpaca', label: 'Alpaca Paper' },
  { id: DEMO_UTA_IBKR, provider: 'ibkr', label: 'IBKR Demo' },
  { id: DEMO_UTA_CRYPTO, provider: 'ccxt', label: 'Binance Spot' },
]

const healthOk = {
  status: 'healthy' as const,
  reach: 'readable' as const,
  tier: 'trading' as const,
  consecutiveFailures: 0,
  lastSuccessAt: new Date().toISOString(),
  recovering: false,
  disabled: false,
}

export const demoUTASummaries: UTASummary[] = [
  {
    id: DEMO_UTA_PAPER,
    label: 'Alpaca Paper',
    capabilities: { supportedSecTypes: ['STK'], supportedOrderTypes: ['MKT', 'LMT'] },
    health: healthOk,
  },
  {
    id: DEMO_UTA_IBKR,
    label: 'IBKR Demo',
    capabilities: { supportedSecTypes: ['STK', 'OPT'], supportedOrderTypes: ['MKT', 'LMT', 'STP'] },
    health: healthOk,
  },
  {
    id: DEMO_UTA_CRYPTO,
    label: 'Binance Spot',
    capabilities: { supportedSecTypes: ['CRYPTO'], supportedOrderTypes: ['MKT', 'LMT'] },
    health: healthOk,
  },
]

// Back-compat singleton (PR-1 wired this name into other handlers).
export const demoTradingAccount: TradingAccount = demoTradingAccounts[0]
export const demoUTASummary: UTASummary = demoUTASummaries[0]

// ==================== Per-UTA account info ====================

export const demoAccountByUTA: Record<string, AccountInfo> = {
  [DEMO_UTA_PAPER]: {
    baseCurrency: 'USD',
    netLiquidation: '52840.13',
    totalCashValue: '8120.55',
    unrealizedPnL: '1924.58',
    realizedPnL: '380.00',
    buyingPower: '16241.10',
  },
  [DEMO_UTA_IBKR]: {
    baseCurrency: 'USD',
    netLiquidation: '247310.40',
    totalCashValue: '142880.00',
    unrealizedPnL: '-1430.50',
    realizedPnL: '12120.30',
    buyingPower: '285760.00',
    initMarginReq: '12450.00',
    maintMarginReq: '8200.00',
  },
  [DEMO_UTA_CRYPTO]: {
    baseCurrency: 'USDT',
    netLiquidation: '15032.18',
    totalCashValue: '3104.20',
    unrealizedPnL: '482.66',
    realizedPnL: '-128.40',
  },
}

// Back-compat singleton.
export const demoAccountInfo: AccountInfo = demoAccountByUTA[DEMO_UTA_PAPER]

// ==================== Positions ====================

function pos(o: {
  symbol: string
  secType?: string
  currency?: string
  side?: 'long' | 'short'
  qty: string
  avgCost: string
  marketPrice: string
}): Position {
  const qty = Number(o.qty)
  const avgCost = Number(o.avgCost)
  const px = Number(o.marketPrice)
  const mv = qty * px
  const unreal = qty * (px - avgCost)
  return {
    contract: {
      symbol: o.symbol,
      secType: o.secType ?? 'STK',
      currency: o.currency ?? 'USD',
      exchange: 'SMART',
    },
    currency: o.currency ?? 'USD',
    side: o.side ?? 'long',
    quantity: o.qty,
    avgCost: o.avgCost,
    marketPrice: o.marketPrice,
    marketValue: mv.toFixed(2),
    unrealizedPnL: unreal.toFixed(2),
    realizedPnL: '0.00',
  }
}

export const demoPositionsByUTA: Record<string, Position[]> = {
  [DEMO_UTA_PAPER]: [
    pos({ symbol: 'AAPL', qty: '120', avgCost: '178.40', marketPrice: '191.25' }),
    pos({ symbol: 'NVDA', qty: '35', avgCost: '612.10', marketPrice: '630.80' }),
    pos({ symbol: 'GOOG', qty: '40', avgCost: '162.00', marketPrice: '158.30' }),
    pos({ symbol: 'AMD', qty: '80', avgCost: '142.50', marketPrice: '144.10' }),
  ],
  [DEMO_UTA_IBKR]: [
    pos({ symbol: 'SPY', qty: '500', avgCost: '512.80', marketPrice: '516.20' }),
    pos({ symbol: 'QQQ', qty: '200', avgCost: '438.00', marketPrice: '441.55' }),
    pos({ symbol: 'AAPL', secType: 'OPT', qty: '20', avgCost: '8.40', marketPrice: '7.10' }),
    pos({ symbol: 'TLT', qty: '300', avgCost: '92.50', marketPrice: '90.80' }),
  ],
  [DEMO_UTA_CRYPTO]: [
    pos({ symbol: 'BTC/USDT', secType: 'CRYPTO', currency: 'USDT', qty: '0.18', avgCost: '64200.00', marketPrice: '66480.00' }),
    pos({ symbol: 'ETH/USDT', secType: 'CRYPTO', currency: 'USDT', qty: '1.5', avgCost: '3340.00', marketPrice: '3402.00' }),
  ],
}

// ==================== Equity curves ====================

// Reproducible-pseudo-random walk so the chart looks plausibly alive without
// being random-on-each-load (visitors would see different numbers each refresh).
function seededRandom(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

function generateCurve(startEquity: number, days: number, vol: number, drift: number, seed: number): EquityCurvePoint[] {
  const rand = seededRandom(seed)
  const dayMs = 86_400_000
  const now = Date.now()
  const points: EquityCurvePoint[] = []
  let equity = startEquity
  for (let i = days - 1; i >= 0; i--) {
    const r = (rand() - 0.5) * 2
    equity = equity * (1 + drift + r * vol)
    points.push({
      timestamp: new Date(now - i * dayMs).toISOString(),
      equity: equity.toFixed(2),
      accounts: {},
    })
  }
  return points
}

const PAPER_CURVE = generateCurve(50_000, 30, 0.012, 0.0008, 0x11a2b3)
const IBKR_CURVE = generateCurve(240_000, 30, 0.008, 0.0004, 0x29ef41)
const CRYPTO_CURVE = generateCurve(14_500, 30, 0.025, 0.0012, 0x53bd99)

export const demoEquityCurve: EquityCurvePoint[] = (() => {
  // Combined view: sum each day across UTAs.
  const out: EquityCurvePoint[] = []
  for (let i = 0; i < PAPER_CURVE.length; i++) {
    const total =
      Number(PAPER_CURVE[i].equity) + Number(IBKR_CURVE[i].equity) + Number(CRYPTO_CURVE[i].equity)
    out.push({
      timestamp: PAPER_CURVE[i].timestamp,
      equity: total.toFixed(2),
      accounts: {
        [DEMO_UTA_PAPER]: PAPER_CURVE[i].equity,
        [DEMO_UTA_IBKR]: IBKR_CURVE[i].equity,
        [DEMO_UTA_CRYPTO]: CRYPTO_CURVE[i].equity,
      },
    })
  }
  return out
})()

export const demoEquityCurveByUTA: Record<string, EquityCurvePoint[]> = {
  [DEMO_UTA_PAPER]: PAPER_CURVE,
  [DEMO_UTA_IBKR]: IBKR_CURVE,
  [DEMO_UTA_CRYPTO]: CRYPTO_CURVE,
}

// ==================== Snapshots ====================

export const demoSnapshotsByUTA: Record<string, UTASnapshotSummary[]> = Object.fromEntries(
  demoTradingAccounts.map((a) => [
    a.id,
    demoEquityCurveByUTA[a.id]!.slice(-5).map((p) => ({
      accountId: a.id,
      timestamp: p.timestamp,
      trigger: 'daily',
      account: {
        baseCurrency: demoAccountByUTA[a.id]!.baseCurrency,
        netLiquidation: p.equity,
        totalCashValue: demoAccountByUTA[a.id]!.totalCashValue,
        unrealizedPnL: demoAccountByUTA[a.id]!.unrealizedPnL,
        realizedPnL: demoAccountByUTA[a.id]!.realizedPnL,
      },
      positions: (demoPositionsByUTA[a.id] ?? []).map((p) => ({
        aliceId: p.contract.symbol ?? 'unknown',
        currency: p.currency,
        side: p.side,
        quantity: p.quantity,
        avgCost: p.avgCost,
        marketPrice: p.marketPrice,
        marketValue: p.marketValue,
        unrealizedPnL: p.unrealizedPnL,
        realizedPnL: p.realizedPnL,
      })),
      openOrders: [],
      health: 'healthy',
    })),
  ]),
)

// ==================== Order / Trade history ====================

const hoursAgo = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString()

function stk(symbol: string, exchange = 'SMART'): HistoryContract {
  return { symbol, secType: 'STK', currency: 'USD', exchange }
}

function spot(localSymbol: string): HistoryContract {
  return { symbol: localSymbol, localSymbol, secType: 'CRYPTO', currency: 'USDT', exchange: 'binance' }
}

// IBKR-superset showcase: an AAPL July-2026 300 call. Exercises the full
// option field set (expiry / strike / right / multiplier) in the demo.
const AAPL_300C: HistoryContract = {
  symbol: 'AAPL',
  localSymbol: 'AAPL  260717C00300000',
  secType: 'OPT',
  currency: 'USD',
  exchange: 'SMART',
  expiry: '20260717',
  strike: '300',
  right: 'C',
  multiplier: '100',
}

export const demoOrderHistoryByUTA: Record<string, OrderHistoryEntry[]> = {
  [DEMO_UTA_PAPER]: [
    {
      orderId: '90412', timestamp: hoursAgo(1), contract: stk('AMD'), side: 'BUY',
      orderType: 'LMT', quantity: '40', limitPrice: '140.00', status: 'submitted',
      source: 'alice', commitHash: 'f31c9a2', message: 'Add AMD ahead of earnings',
    },
    {
      orderId: '90398', timestamp: hoursAgo(3), resolvedAt: hoursAgo(2.8), contract: stk('AAPL'), side: 'BUY',
      orderType: 'LMT', quantity: '20', limitPrice: '188.00', status: 'filled',
      filledQty: '20', avgFillPrice: '187.92',
      source: 'alice', commitHash: 'c8d04e1', message: 'Add AAPL on pullback',
    },
    {
      orderId: '90371', timestamp: hoursAgo(7), resolvedAt: hoursAgo(7), contract: stk('NVDA'), side: 'SELL',
      orderType: 'MKT', quantity: '10', status: 'filled',
      filledQty: '10', avgFillPrice: '631.40',
      source: 'alice', commitHash: 'a17b2f9', message: 'Trim NVDA into strength',
    },
    {
      orderId: '90244', timestamp: hoursAgo(28), resolvedAt: hoursAgo(25), contract: stk('GOOG'), side: 'BUY',
      orderType: 'LMT', quantity: '15', limitPrice: '150.00', status: 'cancelled',
      source: 'alice', commitHash: '4e9d70c', message: 'Bid GOOG at support',
    },
  ],
  [DEMO_UTA_IBKR]: [
    {
      orderId: '7734', timestamp: hoursAgo(2), contract: stk('QQQ'), side: 'SELL',
      orderType: 'LMT', quantity: '50', limitPrice: '445.00', status: 'submitted',
      source: 'alice', commitHash: '2b8fe55', message: 'Take profit on half the QQQ position',
    },
    {
      orderId: '7729', timestamp: hoursAgo(4), resolvedAt: hoursAgo(3.9), contract: AAPL_300C, side: 'BUY',
      orderType: 'LMT', quantity: '5', limitPrice: '8.20', status: 'filled',
      filledQty: '5', avgFillPrice: '8.15',
      source: 'alice', commitHash: '9d2a64b', message: 'Buy AAPL Jul26 300C — long-dated upside',
    },
    {
      timestamp: hoursAgo(6), resolvedAt: hoursAgo(6), contract: stk('TLT'), side: 'BUY',
      orderType: 'MKT', quantity: '500', status: 'rejected',
      source: 'alice', commitHash: 'e07c318', message: 'Add duration',
      error: 'Insufficient buying power for order size',
    },
    {
      orderId: '7698', timestamp: hoursAgo(31), resolvedAt: hoursAgo(31), contract: stk('SPY'), side: 'BUY',
      orderType: 'LMT', quantity: '100', limitPrice: '512.50', status: 'filled',
      filledQty: '100', avgFillPrice: '512.48',
      source: 'alice', commitHash: '6fa1d92', message: 'Scale into SPY core',
    },
  ],
  [DEMO_UTA_CRYPTO]: [
    {
      orderId: 'ord-88121', timestamp: hoursAgo(5), resolvedAt: hoursAgo(4.9), contract: spot('ETH/USDT'), side: 'BUY',
      orderType: 'LMT', quantity: '0.5', limitPrice: '3350', status: 'filled',
      filledQty: '0.5', avgFillPrice: '3348.2',
      source: 'alice', commitHash: 'b44c0d7', message: 'Add ETH on dip',
    },
    {
      orderId: 'ord-87903', timestamp: hoursAgo(12), resolvedAt: hoursAgo(12), contract: spot('BTC/USDT'), side: 'SELL',
      orderType: 'MKT', quantity: '0.02', status: 'filled',
      filledQty: '0.02', avgFillPrice: '66120',
      source: 'external', commitHash: '0c5e8a1', message: '[observed] external order',
    },
    {
      orderId: 'ord-87410', timestamp: hoursAgo(40), resolvedAt: hoursAgo(36), contract: spot('ETH/USDT'), side: 'SELL',
      orderType: 'LMT', quantity: '1.0', limitPrice: '3600', status: 'cancelled',
      source: 'alice', commitHash: '5d91f3e', message: 'Offer ETH at resistance',
    },
  ],
}

export const demoTradeHistoryByUTA: Record<string, TradeHistoryEntry[]> = {
  [DEMO_UTA_PAPER]: [
    {
      timestamp: hoursAgo(2.8), orderId: '90398', contract: stk('AAPL'), side: 'BUY',
      quantity: '20', price: '187.92', value: '3758.40', source: 'order', commitHash: 'c8d04e1',
    },
    {
      timestamp: hoursAgo(7), orderId: '90371', contract: stk('NVDA'), side: 'SELL',
      quantity: '10', price: '631.40', value: '6314.00', source: 'order', commitHash: 'a17b2f9',
    },
  ],
  [DEMO_UTA_IBKR]: [
    {
      timestamp: hoursAgo(3.9), orderId: '7729', contract: AAPL_300C, side: 'BUY',
      quantity: '5', price: '8.15', value: '4075.00', source: 'order', commitHash: '9d2a64b',
    },
    {
      timestamp: hoursAgo(31), orderId: '7698', contract: stk('SPY'), side: 'BUY',
      quantity: '100', price: '512.48', value: '51248.00', source: 'order', commitHash: '6fa1d92',
    },
  ],
  [DEMO_UTA_CRYPTO]: [
    {
      timestamp: hoursAgo(4.9), orderId: 'ord-88121', contract: spot('ETH/USDT'), side: 'BUY',
      quantity: '0.5', price: '3348.2', value: '1674.10', source: 'order', commitHash: 'b44c0d7',
    },
    {
      timestamp: hoursAgo(12), orderId: 'ord-87903', contract: spot('BTC/USDT'), side: 'SELL',
      quantity: '0.02', price: '66120', value: '1322.40', source: 'external', commitHash: '0c5e8a1',
    },
    {
      timestamp: hoursAgo(18), contract: spot('BTC/USDT'), side: 'BUY',
      quantity: '0.0005', price: '66480', value: '33.24', source: 'reconcile', commitHash: '7ae20c4',
    },
  ],
}

// ==================== UTA configs ====================

export const demoUTAConfigs: UTAConfig[] = [
  { id: DEMO_UTA_PAPER, label: 'Alpaca Paper', presetId: 'alpaca-paper', enabled: true, guards: [], presetConfig: {} },
  { id: DEMO_UTA_IBKR, label: 'IBKR Demo', presetId: 'ibkr', enabled: true, guards: [], presetConfig: {} },
  { id: DEMO_UTA_CRYPTO, label: 'Binance Spot', presetId: 'ccxt', enabled: true, guards: [], presetConfig: {} },
]
export const demoUTAConfig: UTAConfig = demoUTAConfigs[0]
