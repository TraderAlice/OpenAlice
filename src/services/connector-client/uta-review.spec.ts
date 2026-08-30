import { describe, expect, it, vi } from 'vitest'
import type { ConnectorUtaPresentation, ConnectorUtaRequest } from '@traderalice/connector-protocol'
import { compactUtaOperation, processConnectorUtaRequests } from './uta-review.js'
import type { UTAManagerSDK } from '../uta-client/index.js'
import type { TradingModePolicy } from '../trading-mode.js'

const PRO = { mode: 'pro', source: 'config', envLocked: false, hasUTAConfig: true } satisfies TradingModePolicy
const LITE = { mode: 'lite', source: 'env', envLocked: true, hasUTAConfig: false } satisfies TradingModePolicy
const READONLY = { mode: 'readonly', source: 'config', envLocked: false, hasUTAConfig: true } satisfies TradingModePolicy

function account(over: {
  id?: string
  label?: string
  tier?: 'trading' | 'data'
  status?: { staged: unknown[]; pendingMessage: string | null; pendingHash: string | null }
  push?: (expectedPendingHash?: string) => Promise<{ hash: string; submitted: unknown[]; rejected: unknown[] }>
  reject?: (reason?: string, expectedPendingHash?: string) => Promise<{ hash: string }>
} = {}) {
  const id = over.id ?? 'alpaca-paper'
  return {
    id,
    label: over.label ?? id,
    health: { tier: over.tier ?? 'trading' },
    status: async () => over.status ?? {
      staged: [{
        action: 'placeOrder',
        contract: { symbol: 'AAPL' },
        order: { action: 'BUY', orderType: 'MKT', totalQuantity: '10' },
      }],
      pendingMessage: 'long AAPL',
      pendingHash: 'abc12345',
    },
    push: over.push ?? (async () => ({ hash: 'pushhash', submitted: [{ action: 'placeOrder' }], rejected: [] })),
    reject: over.reject ?? (async () => ({ hash: 'rejhash' })),
  }
}

function manager(accounts: ReturnType<typeof account>[]): UTAManagerSDK {
  return {
    listUTAs: async () => accounts.map((uta) => ({
      id: uta.id,
      label: uta.label,
      asVendor: true,
      capabilities: { supportedSecTypes: [], supportedOrderTypes: [] },
      health: {
        status: 'healthy',
        reach: 'connected',
        tier: uta.health.tier,
        consecutiveFailures: 0,
        recovering: false,
        connecting: false,
        disabled: false,
      },
    })),
    get: async (id: string) => accounts.find((uta) => uta.id === id),
  } as unknown as UTAManagerSDK
}

function request(over: Partial<ConnectorUtaRequest> = {}): ConnectorUtaRequest {
  return {
    requestId: 'uta-1',
    connectorId: 'telegram',
    createdAt: new Date().toISOString(),
    action: 'review',
    ...over,
  }
}

describe('compactUtaOperation', () => {
  it('summarizes a placeOrder without UNSET sentinels', () => {
    expect(compactUtaOperation({
      action: 'placeOrder',
      contract: { symbol: 'AAPL' },
      order: { action: 'BUY', orderType: 'MKT', totalQuantity: '10', lmtPrice: '1.7976931348623157e+308' },
    })).toEqual({
      action: 'placeOrder',
      symbol: 'AAPL',
      side: 'BUY',
      orderType: 'MKT',
      quantity: '10',
      summary: 'BUY AAPL MKT × 10',
    })
  })
})

describe('processConnectorUtaRequests', () => {
  it('acks a presented claim and releases it when no terminal response reaches the connector', async () => {
    const ackUtaActions = vi.fn(async () => undefined)
    const releaseUtaActions = vi.fn(async () => undefined)
    const base = {
      isEnabled: async () => true,
      drainUtaActions: async () => [],
      claimUtaActions: async () => ({ claimId: 'claim-uta', items: [request()] }),
      ackUtaActions,
      releaseUtaActions,
      warn: vi.fn(),
      utaManager: { listUTAs: vi.fn() } as unknown as UTAManagerSDK,
      tradingModePolicy: () => LITE,
    }

    await processConnectorUtaRequests({
      ...base,
      presentUta: async () => undefined,
      failUta: async () => undefined,
    })
    expect(ackUtaActions).toHaveBeenCalledWith('claim-uta', ['uta-1'])
    expect(releaseUtaActions).not.toHaveBeenCalled()

    ackUtaActions.mockClear()
    await processConnectorUtaRequests({
      ...base,
      presentUta: async () => { throw new Error('connector offline') },
      failUta: async () => { throw new Error('connector offline') },
    })
    expect(releaseUtaActions).toHaveBeenCalledWith('claim-uta', ['uta-1'])
    expect(ackUtaActions).not.toHaveBeenCalled()
  })

  it('returns lite mode without touching accounts', async () => {
    const presentUta = vi.fn(async (_presentation: ConnectorUtaPresentation) => undefined)
    const listUTAs = vi.fn()
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request()],
      presentUta,
      failUta: async () => undefined,
      warn: vi.fn(),
      utaManager: { listUTAs } as unknown as UTAManagerSDK,
      tradingModePolicy: () => LITE,
    })
    expect(listUTAs).not.toHaveBeenCalled()
    expect(presentUta).toHaveBeenCalledWith(expect.objectContaining({
      review: expect.objectContaining({
        unavailable: expect.stringContaining('Lite mode'),
        accounts: [],
      }),
    }))
  })

  it('omits data-tier accounts and compact-summarizes pending ops', async () => {
    const presentUta = vi.fn(async (_presentation: ConnectorUtaPresentation) => undefined)
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request()],
      presentUta,
      failUta: async () => undefined,
      warn: vi.fn(),
      utaManager: manager([
        account(),
        account({ id: 'binance-readonly', tier: 'data' }),
      ]),
      tradingModePolicy: () => PRO,
    })
    const presented = presentUta.mock.calls[0]?.[0]
    expect(presented?.review.accounts.map((row: { id: string }) => row.id)).toEqual(['alpaca-paper'])
    expect(presented?.review.accounts[0]?.operations[0]?.summary).toBe('BUY AAPL MKT × 10')
  })

  it('pushes a matching pending commit', async () => {
    const push = vi.fn(async (_expected?: string) => ({ hash: 'pushhash', submitted: [{}], rejected: [] }))
    const presentUta = vi.fn(async (_presentation: ConnectorUtaPresentation) => undefined)
    const uta = account({ push })
    let pushed = false
    uta.status = async () => pushed
      ? { staged: [], pendingMessage: null, pendingHash: null }
      : {
        staged: [{ action: 'placeOrder', contract: { symbol: 'AAPL' }, order: { action: 'BUY', orderType: 'MKT', totalQuantity: '10' } }],
        pendingMessage: 'long AAPL',
        pendingHash: 'abc12345',
      }
    uta.push = async (expected?: string) => {
      pushed = true
      return push(expected)
    }
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'push',
        utaId: 'alpaca-paper',
        pendingHash: 'abc12345',
      })],
      presentUta,
      failUta: async () => undefined,
      warn: vi.fn(),
      utaManager: manager([uta]),
      tradingModePolicy: () => PRO,
    })
    expect(push).toHaveBeenCalledWith('abc12345')
    expect(presentUta.mock.calls[0]?.[0]?.result).toMatchObject({
      kind: 'pushed',
      message: expect.stringContaining('Pushed alpaca-paper'),
    })
  })

  it('rejects in readonly mode and refuses push', async () => {
    const push = vi.fn(async () => ({ hash: 'x', submitted: [], rejected: [] }))
    const reject = vi.fn(async () => ({ hash: 'rejhash' }))
    const failUta = vi.fn(async () => undefined)
    const presentUta = vi.fn(async (_presentation: ConnectorUtaPresentation) => undefined)
    const uta = account({ push, reject })
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'push',
        utaId: 'alpaca-paper',
        pendingHash: 'abc12345',
      })],
      presentUta,
      failUta,
      warn: vi.fn(),
      utaManager: manager([uta]),
      tradingModePolicy: () => READONLY,
    })
    expect(push).not.toHaveBeenCalled()
    expect(failUta).toHaveBeenCalledWith(expect.objectContaining({ reason: 'readonly' }))

    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'reject',
        utaId: 'alpaca-paper',
        pendingHash: 'abc12345',
      })],
      presentUta,
      failUta,
      warn: vi.fn(),
      utaManager: manager([uta]),
      tradingModePolicy: () => READONLY,
    })
    expect(reject).toHaveBeenCalledOnce()
    expect(presentUta.mock.calls.at(-1)?.[0]?.result).toMatchObject({ kind: 'rejected' })
  })

  it('does not execute after the request has expired', async () => {
    const push = vi.fn()
    const failUta = vi.fn(async () => undefined)
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'push',
        utaId: 'alpaca-paper',
        createdAt: '2026-08-14T15:00:00.000Z',
      })],
      presentUta: async () => undefined,
      failUta,
      warn: vi.fn(),
      utaManager: manager([account({ push })]),
      tradingModePolicy: () => PRO,
      now: () => Date.parse('2026-08-14T15:02:00.000Z'),
    })
    expect(push).not.toHaveBeenCalled()
    expect(failUta).toHaveBeenCalledWith(expect.objectContaining({ reason: 'expired' }))
  })

  it('does not push when the reviewed hash is missing', async () => {
    const push = vi.fn()
    const failUta = vi.fn(async () => undefined)
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'push',
        utaId: 'alpaca-paper',
      })],
      presentUta: async () => undefined,
      failUta,
      warn: vi.fn(),
      utaManager: manager([account({ push })]),
      tradingModePolicy: () => PRO,
    })
    expect(push).not.toHaveBeenCalled()
    expect(failUta).toHaveBeenCalledWith(expect.objectContaining({ reason: 'conflict' }))
  })

  it('does not approve a commit larger than the Telegram presentation', async () => {
    const push = vi.fn()
    const presentUta = vi.fn(async (_presentation: ConnectorUtaPresentation) => undefined)
    const uta = account({
      push,
      status: {
        staged: Array.from({ length: 9 }, (_, index) => ({
          action: 'placeOrder',
          contract: { symbol: `S${index}` },
          order: { action: 'BUY', orderType: 'MKT', totalQuantity: '1' },
        })),
        pendingMessage: 'basket',
        pendingHash: 'abc12345',
      },
    })
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'push',
        utaId: 'alpaca-paper',
        pendingHash: 'abc12345',
      })],
      presentUta,
      failUta: async () => undefined,
      warn: vi.fn(),
      utaManager: manager([uta]),
      tradingModePolicy: () => PRO,
    })
    expect(push).not.toHaveBeenCalled()
    expect(presentUta.mock.calls[0]?.[0]?.result).toMatchObject({
      kind: 'error',
      message: expect.stringContaining('Trading as Git'),
    })
  })

  it('turns a UTA hash conflict into a no-write failure for push and reject', async () => {
    const conflict = Object.assign(new Error('Pending commit changed'), { code: 'PENDING_HASH_CONFLICT' })
    const push = vi.fn(async () => { throw conflict })
    const reject = vi.fn(async () => { throw conflict })
    const failUta = vi.fn(async () => undefined)
    const uta = account({ push, reject })
    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'push',
        utaId: 'alpaca-paper',
        pendingHash: 'stalehash',
      })],
      presentUta: async () => undefined,
      failUta,
      warn: vi.fn(),
      utaManager: manager([uta]),
      tradingModePolicy: () => PRO,
    })
    expect(push).toHaveBeenCalledWith('stalehash')
    expect(failUta).toHaveBeenCalledWith(expect.objectContaining({ reason: 'conflict' }))

    await processConnectorUtaRequests({
      isEnabled: async () => true,
      drainUtaActions: async () => [request({
        action: 'reject',
        utaId: 'alpaca-paper',
        pendingHash: 'stalehash',
      })],
      presentUta: async () => undefined,
      failUta,
      warn: vi.fn(),
      utaManager: manager([uta]),
      tradingModePolicy: () => PRO,
    })
    expect(reject).toHaveBeenCalled()
    expect(failUta).toHaveBeenLastCalledWith(expect.objectContaining({ reason: 'conflict' }))
  })
})
