import { describe, it, expect, vi, beforeEach } from 'vitest'
import Decimal from 'decimal.js'
import { Contract, Order, UNSET_DOUBLE, UNSET_DECIMAL } from '@traderalice/ibkr'
import { MaxPositionSizeGuard } from './max-position-size.js'
import { CooldownGuard } from './cooldown.js'
import { SymbolWhitelistGuard } from './symbol-whitelist.js'
import { createGuardPipeline } from './guard-pipeline.js'
import { resolveGuards, registerGuard } from './registry.js'
import type { GuardContext, OperationGuard } from './types.js'
import type { Operation } from '../git/types.js'
import type { AccountInfo, Position } from '../brokers/types.js'
import { MockBroker, makeContract, makePosition } from '../__test__/mock-broker.js'
import '../contract-ext.js'

// ==================== Helpers ====================

function makePlaceOrderOp(overrides: {
  symbol?: string
  action?: 'BUY' | 'SELL'
  orderType?: string
  cashQty?: number
  totalQuantity?: Decimal
} = {}): Operation {
  const contract = makeContract({ symbol: overrides.symbol ?? 'AAPL' })
  const order = new Order()
  order.action = overrides.action ?? 'BUY'
  order.orderType = overrides.orderType ?? 'MKT'
  order.totalQuantity = overrides.totalQuantity ?? new Decimal(10)
  if (overrides.cashQty != null) {
    order.cashQty = overrides.cashQty
  }
  return { action: 'placeOrder', contract, order }
}

function makeContext(overrides: {
  operation?: Operation
  positions?: Position[]
  account?: Partial<AccountInfo>
} = {}): GuardContext {
  return {
    operation: overrides.operation ?? makePlaceOrderOp(),
    positions: overrides.positions ?? [],
    account: {
      netLiquidation: 100_000,
      totalCashValue: 100_000,
      unrealizedPnL: 0,
      realizedPnL: 0,
      ...overrides.account,
    },
  }
}

// ==================== MaxPositionSizeGuard ====================

describe('MaxPositionSizeGuard', () => {
  it('allows order within limit', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 20_000 }),
      account: { netLiquidation: 100_000 },
    })

    expect(guard.check(ctx)).toBeNull()
  })

  it('rejects order exceeding limit', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 30_000 }),
      account: { netLiquidation: 100_000 },
    })

    const result = guard.check(ctx)
    expect(result).not.toBeNull()
    expect(result).toContain('30.0%')
    expect(result).toContain('limit: 25%')
  })

  it('considers existing position value', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 25 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 10_000 }),
      positions: [makePosition({ contract: makeContract({ symbol: 'AAPL' }), marketValue: 20_000 })],
      account: { netLiquidation: 100_000 },
    })

    const result = guard.check(ctx)
    expect(result).not.toBeNull()
    // 20k existing + 10k new = 30k = 30%
    expect(result).toContain('30.0%')
  })

  it('uses default 25% if no option provided', () => {
    const guard = new MaxPositionSizeGuard({})
    const ctx = makeContext({
      operation: makePlaceOrderOp({ cashQty: 26_000 }),
      account: { netLiquidation: 100_000 },
    })
    expect(guard.check(ctx)).not.toBeNull()
  })

  it('skips non-placeOrder operations', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 1 })
    const contract = makeContract({ symbol: 'AAPL' })
    const ctx = makeContext({
      operation: { action: 'closePosition', contract },
    })
    expect(guard.check(ctx)).toBeNull()
  })

  it('allows when addedValue cannot be estimated (qty-based, no existing position)', () => {
    const guard = new MaxPositionSizeGuard({ maxPercentOfEquity: 1 })
    const ctx = makeContext({
      operation: makePlaceOrderOp({ symbol: 'NEW_STOCK', totalQuantity: new Decimal(100) }),
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== CooldownGuard ====================

describe('CooldownGuard', () => {
  it('allows first trade', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })
    const ctx = makeContext()
    expect(guard.check(ctx)).toBeNull()
  })

  it('rejects rapid repeat trade for same symbol', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })
    const ctx = makeContext()

    guard.check(ctx) // first — allowed
    const result = guard.check(ctx) // second — rejected
    expect(result).not.toBeNull()
    expect(result).toContain('Cooldown active')
    expect(result).toContain('AAPL')
  })

  it('allows trade for different symbol', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })

    guard.check(makeContext({
      operation: makePlaceOrderOp({ symbol: 'AAPL' }),
    }))

    const result = guard.check(makeContext({
      operation: makePlaceOrderOp({ symbol: 'GOOG' }),
    }))
    expect(result).toBeNull()
  })

  it('skips non-placeOrder operations', () => {
    const guard = new CooldownGuard({ minIntervalMs: 60_000 })
    const contract = makeContract({ symbol: 'AAPL' })
    const ctx = makeContext({
      operation: { action: 'closePosition', contract },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== SymbolWhitelistGuard ====================

describe('SymbolWhitelistGuard', () => {
  it('allows whitelisted symbols', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL', 'GOOG'] })
    const ctx = makeContext()
    expect(guard.check(ctx)).toBeNull()
  })

  it('rejects non-whitelisted symbols', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['GOOG'] })
    const ctx = makeContext()
    expect(guard.check(ctx)).toContain('not in the allowed list')
  })

  it('throws on construction without symbols', () => {
    expect(() => new SymbolWhitelistGuard({})).toThrow('non-empty "symbols"')
    expect(() => new SymbolWhitelistGuard({ symbols: [] })).toThrow('non-empty "symbols"')
  })

  it('allows operations without a symbol param', () => {
    const guard = new SymbolWhitelistGuard({ symbols: ['AAPL'] })
    const ctx = makeContext({
      operation: { action: 'cancelOrder', orderId: '123' },
    })
    expect(guard.check(ctx)).toBeNull()
  })
})

// ==================== Guard Pipeline ====================

describe('createGuardPipeline', () => {
  it('returns dispatcher directly when no guards', () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const pipeline = createGuardPipeline(dispatcher, account, [])

    // Should be the same function reference
    expect(pipeline).toBe(dispatcher)
  })

  it('passes through when all guards allow', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const allowGuard: OperationGuard = { name: 'allow-all', check: () => null }

    const pipeline = createGuardPipeline(dispatcher, account, [allowGuard])
    const op: Operation = makePlaceOrderOp()
    const result = await pipeline(op)

    expect(dispatcher).toHaveBeenCalledWith(op)
    expect(result).toEqual({ success: true })
  })

  it('blocks when a guard rejects', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const denyGuard: OperationGuard = { name: 'deny-all', check: () => 'Denied!' }

    const pipeline = createGuardPipeline(dispatcher, account, [denyGuard])
    const op: Operation = makePlaceOrderOp()
    const result = await pipeline(op) as Record<string, unknown>

    expect(dispatcher).not.toHaveBeenCalled()
    expect(result.success).toBe(false)
    expect(result.error).toContain('[guard:deny-all]')
    expect(result.error).toContain('Denied!')
  })

  it('stops at first rejecting guard', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    const guardA: OperationGuard = { name: 'A', check: vi.fn().mockReturnValue(null) }
    const guardB: OperationGuard = { name: 'B', check: vi.fn().mockReturnValue('Blocked by B') }
    const guardC: OperationGuard = { name: 'C', check: vi.fn().mockReturnValue(null) }

    const pipeline = createGuardPipeline(dispatcher, account, [guardA, guardB, guardC])
    const op: Operation = makePlaceOrderOp()
    await pipeline(op)

    expect(guardA.check).toHaveBeenCalled()
    expect(guardB.check).toHaveBeenCalled()
    expect(guardC.check).not.toHaveBeenCalled()
  })

  it('fetches positions and account info for guard context', async () => {
    const dispatcher = vi.fn().mockResolvedValue({ success: true })
    const account = new MockBroker()
    account.setPositions([makePosition()])

    let capturedCtx: GuardContext | undefined
    const spyGuard: OperationGuard = {
      name: 'spy',
      check: (ctx) => { capturedCtx = ctx; return null },
    }

    const pipeline = createGuardPipeline(dispatcher, account, [spyGuard])
    await pipeline(makePlaceOrderOp())

    expect(capturedCtx).toBeDefined()
    expect(capturedCtx!.positions).toHaveLength(1)
    expect(capturedCtx!.account.netLiquidation).toBe(105_000)
  })
})

// ==================== Registry ====================

describe('resolveGuards', () => {
  it('resolves builtin guard types', () => {
    const guards = resolveGuards([
      { type: 'max-position-size', options: { maxPercentOfEquity: 25 } },
      { type: 'symbol-whitelist', options: { symbols: ['AAPL'] } },
    ])
    expect(guards).toHaveLength(2)
    expect(guards[0].name).toBe('max-position-size')
    expect(guards[1].name).toBe('symbol-whitelist')
  })

  it('skips unknown guard types with a warning', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const guards = resolveGuards([{ type: 'nonexistent' }])
    expect(guards).toHaveLength(0)
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('nonexistent'))
    warnSpy.mockRestore()
  })

  it('returns empty for empty config', () => {
    expect(resolveGuards([])).toEqual([])
  })
})

describe('registerGuard', () => {
  it('registers a custom guard type', () => {
    registerGuard({
      type: 'test-custom',
      create: () => ({ name: 'test-custom', check: () => null }),
    })

    const guards = resolveGuards([{ type: 'test-custom' }])
    expect(guards).toHaveLength(1)
    expect(guards[0].name).toBe('test-custom')
  })
})
