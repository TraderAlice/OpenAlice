import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Decimal from 'decimal.js'
import { Contract, Order } from '@traderalice/ibkr'
import { afterEach, describe, expect, it } from 'vitest'
import type { Operation } from '../git/types.js'
import { ApprovalGateError } from './errors.js'
import { evaluateApprovalGate } from './gate.js'
import { canonicalApprovalPayload, type ApprovalTicket } from './tickets.js'

let tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => rm(dir, { recursive: true, force: true })))
  tempDirs = []
})

function makeContract(symbol = 'AAPL') {
  const contract = new Contract()
  contract.symbol = symbol
  contract.aliceId = `ibkr-tws-b9646326|${symbol}`
  return contract
}

function makeOrder(overrides: {
  action?: 'BUY' | 'SELL'
  orderType?: string
  cashQty?: unknown
  totalQuantity?: unknown
  lmtPrice?: unknown
} = {}) {
  const order = new Order()
  order.action = overrides.action ?? 'BUY'
  order.orderType = overrides.orderType ?? 'LMT'
  if ('cashQty' in overrides) order.cashQty = overrides.cashQty as Decimal
  if ('totalQuantity' in overrides) order.totalQuantity = overrides.totalQuantity as Decimal
  if ('lmtPrice' in overrides) order.lmtPrice = overrides.lmtPrice as Decimal
  return order
}

function placeOrder(overrides: {
  symbol?: string
  action?: 'BUY' | 'SELL'
  cashQty?: unknown
  totalQuantity?: unknown
  lmtPrice?: unknown
  tpsl?: Extract<Operation, { action: 'placeOrder' }>['tpsl']
} = {}): Operation {
  const order = makeOrder({
    action: overrides.action,
    cashQty: overrides.cashQty as Decimal,
    totalQuantity: overrides.totalQuantity as Decimal,
    lmtPrice: overrides.lmtPrice as Decimal,
  })
  return { action: 'placeOrder', contract: makeContract(overrides.symbol ?? 'AAPL'), order, tpsl: overrides.tpsl as never }
}

function signedTicket(overrides: Partial<Omit<ApprovalTicket, 'signature'>> = {}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  const payload: Omit<ApprovalTicket, 'signature'> = {
    ticket_id: 'ticket-1',
    account_id: 'ibkr-tws-b9646326',
    account_role: 'paper',
    allowed_symbols: ['AAPL'],
    allowed_actions: ['BUY', 'cancelOrder', 'closePosition'],
    max_notional_usd: '1000',
    require_exit_plan: true,
    exit_plan: 'Cancel open paper order or close any AAPL fill.',
    run_id: 'run-1',
    expires_at: '2026-06-10T21:01:59.746Z',
    ...overrides,
  }
  const signature = sign(null, Buffer.from(canonicalApprovalPayload(payload)), privateKey).toString('base64')
  const ticket = { ...payload, signature: `ed25519:${signature}` } as ApprovalTicket
  return {
    ticket,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  }
}

async function writeGateFiles(ticket: ApprovalTicket, publicKeyPem: string) {
  const dir = await mkdtemp(join(tmpdir(), 'approval-gate-'))
  tempDirs.push(dir)
  const ticketDirectory = join(dir, 'tickets')
  await import('node:fs/promises').then((fs) => fs.mkdir(ticketDirectory))
  await writeFile(join(ticketDirectory, 'ticket.json'), JSON.stringify(ticket, null, 2))
  const publicKeyPath = join(dir, 'ticket-signing.ed25519.public.pem')
  await writeFile(publicKeyPath, publicKeyPem)
  return { ticketDirectory, publicKeyPath }
}

async function evaluate(overrides: {
  ticket?: ApprovalTicket
  publicKeyPem?: string
  staged?: Operation[]
  pendingMessage?: string | null
  pendingHash?: string | null
  pendingOrders?: Array<{ orderId: string; symbol: string }>
  now?: Date
} = {}) {
  const generated = signedTicket()
  const files = await writeGateFiles(overrides.ticket ?? generated.ticket, overrides.publicKeyPem ?? generated.publicKeyPem)
  return evaluateApprovalGate({
    config: {
      enabled: true,
      ticketDirectory: files.ticketDirectory,
      publicKeyPath: files.publicKeyPath,
      allowedAccountRole: 'paper',
      requireTicket: true,
    },
    accountId: 'ibkr-tws-b9646326',
    pendingHash: 'pendingHash' in overrides ? overrides.pendingHash! : 'abc123',
    pendingMessage: 'pendingMessage' in overrides ? overrides.pendingMessage! : 'ticket-1 run-1 buy AAPL',
    staged: overrides.staged ?? [placeOrder({ totalQuantity: new Decimal(2), lmtPrice: new Decimal(150) })],
    pendingOrders: overrides.pendingOrders ?? [],
    now: overrides.now ?? new Date('2026-06-10T20:00:00.000Z'),
  })
}

describe('evaluateApprovalGate', () => {
  it('accepts a valid BUY placeOrder with totalQuantity * lmtPrice under cap', async () => {
    const audit = await evaluate()
    expect(audit?.ticketId).toBe('ticket-1')
    expect(audit?.pendingHash).toBe('abc123')
    expect(audit?.entries[0].notionalUsd).toBe('300')
  })

  it('accepts cashQty notional under cap', async () => {
    const audit = await evaluate({
      staged: [placeOrder({ cashQty: new Decimal(250) })],
    })
    expect(audit?.entries[0].notionalUsd).toBe('250')
  })

  it('normalizes Decimal, string, and number numeric fields', async () => {
    const audit = await evaluate({
      staged: [placeOrder({ totalQuantity: '2', lmtPrice: 150 })],
    })
    expect(audit?.entries[0].notionalUsd).toBe('300')
  })

  it('rejects missing pending hash', async () => {
    await expect(evaluate({ pendingHash: null })).rejects.toThrow(/pending hash/)
  })

  it('rejects missing pending message', async () => {
    await expect(evaluate({ pendingMessage: null })).rejects.toThrow(/pending message/)
  })

  it('rejects an empty staged operation list', async () => {
    await expect(evaluate({ staged: [] })).rejects.toThrow(/staged operation/)
  })

  it('rejects no matching ticket for an opted-in account that requires a ticket', async () => {
    const generated = signedTicket({ account_id: 'other-account' })
    await expect(evaluate({ ticket: generated.ticket, publicKeyPem: generated.publicKeyPem })).rejects.toThrow(/No approval ticket/)
  })

  it('rejects pending message without ticket id', async () => {
    await expect(evaluate({ pendingMessage: 'run-1 buy AAPL' })).rejects.toThrow(/ticket id/)
  })

  it('rejects pending message without run id when ticket has run_id', async () => {
    await expect(evaluate({ pendingMessage: 'ticket-1 buy AAPL' })).rejects.toThrow(/run id/)
  })

  it('rejects over-limit notional', async () => {
    await expect(evaluate({
      staged: [placeOrder({ totalQuantity: new Decimal(10), lmtPrice: new Decimal(150) })],
    })).rejects.toThrow(/notional/)
  })

  it('rejects unprovable notional', async () => {
    await expect(evaluate({ staged: [placeOrder()] })).rejects.toThrow(/notional/)
  })

  it('rejects missing required signed exit plan', async () => {
    const generated = signedTicket({ exit_plan: '' })
    await expect(evaluate({ ticket: generated.ticket, publicKeyPem: generated.publicKeyPem })).rejects.toThrow(/exit plan/)
  })

  it('accepts current pilot style with signed exit_plan and no staged tpsl', async () => {
    const audit = await evaluate({
      staged: [placeOrder({ totalQuantity: new Decimal(1), lmtPrice: new Decimal(150) })],
    })
    expect(audit?.exitPlanMode).toBe('ticket-exit-plan')
  })

  it('accepts BUY placeOrder even though allowed_actions does not include placeOrder', async () => {
    await expect(evaluate()).resolves.toMatchObject({ ticketId: 'ticket-1' })
  })

  it('rejects SELL placeOrder when ticket allows only BUY', async () => {
    await expect(evaluate({
      staged: [placeOrder({ action: 'SELL', totalQuantity: new Decimal(1), lmtPrice: new Decimal(150) })],
    })).rejects.toThrow(/SELL/)
  })

  it('rejects placeOrder for a non-ticket symbol', async () => {
    await expect(evaluate({
      staged: [placeOrder({ symbol: 'MSFT', totalQuantity: new Decimal(1), lmtPrice: new Decimal(150) })],
    })).rejects.toThrow(/symbol/)
  })

  it('rejects more than one initial placeOrder', async () => {
    await expect(evaluate({
      staged: [
        placeOrder({ totalQuantity: new Decimal(1), lmtPrice: new Decimal(150) }),
        placeOrder({ totalQuantity: new Decimal(1), lmtPrice: new Decimal(151) }),
      ],
    })).rejects.toThrow(/at most one/)
  })

  it('rejects cancelOrder when the order id cannot be resolved to a pending symbol', async () => {
    await expect(evaluate({ staged: [{ action: 'cancelOrder', orderId: 'ord-1' }] })).rejects.toThrow(/resolve/)
  })

  it('accepts cancelOrder when resolved pending symbol is allowed', async () => {
    const audit = await evaluate({
      staged: [{ action: 'cancelOrder', orderId: 'ord-1' }],
      pendingOrders: [{ orderId: 'ord-1', symbol: 'AAPL' }],
    })
    expect(audit?.actions).toEqual(['cancelOrder'])
  })

  it('rejects cancelOrder when resolved pending symbol is not allowed', async () => {
    await expect(evaluate({
      staged: [{ action: 'cancelOrder', orderId: 'ord-1' }],
      pendingOrders: [{ orderId: 'ord-1', symbol: 'MSFT' }],
    })).rejects.toThrow(/MSFT/)
  })

  it('accepts closePosition for an allowed symbol', async () => {
    const audit = await evaluate({ staged: [{ action: 'closePosition', contract: makeContract('AAPL') }] })
    expect(audit?.actions).toEqual(['closePosition'])
  })

  it('rejects unsupported modifyOrder', async () => {
    await expect(evaluate({ staged: [{ action: 'modifyOrder', orderId: 'ord-1', changes: {} }] })).rejects.toThrow(/unsupported/)
  })

  it('rejects unsupported syncOrders', async () => {
    await expect(evaluate({ staged: [{ action: 'syncOrders' }] })).rejects.toThrow(/unsupported/)
  })

  it('rejects unsupported reconcileBalance', async () => {
    await expect(evaluate({
      staged: [{ action: 'reconcileBalance', aliceId: 'mock-paper|AAPL', quantityDelta: '1', markPrice: '150' }],
    })).rejects.toThrow(/unsupported/)
  })

  it('throws ApprovalGateError for policy denials', async () => {
    await expect(evaluate({ pendingMessage: null })).rejects.toBeInstanceOf(ApprovalGateError)
  })

  it('accepts an IBKR pilot-shaped signed ticket before expires_at', async () => {
    const generated = signedTicket({
      ticket_id: 'hermes-ibkr-paper-pilot-ibkr-001',
      run_id: 'hermes-ibkr-paper-pilot-run-20260610T150159Z',
      account_id: 'ibkr-tws-b9646326',
      allowed_symbols: ['AAPL'],
      allowed_actions: ['BUY', 'cancelOrder', 'closePosition'],
      require_exit_plan: true,
      exit_plan: 'Cancel any open paper order or close any paper AAPL fill.',
      expires_at: '2026-06-10T21:01:59.746Z',
    })
    const fixture = await writeGateFiles(generated.ticket, generated.publicKeyPem)
    const audit = await evaluateApprovalGate({
      config: {
        enabled: true,
        ticketDirectory: fixture.ticketDirectory,
        publicKeyPath: fixture.publicKeyPath,
        allowedAccountRole: 'paper',
        requireTicket: true,
      },
      accountId: 'ibkr-tws-b9646326',
      pendingHash: 'pilot-hash',
      pendingMessage: 'hermes-ibkr-paper-pilot-ibkr-001 hermes-ibkr-paper-pilot-run-20260610T150159Z buy AAPL',
      staged: [placeOrder({ symbol: 'AAPL', action: 'BUY', totalQuantity: new Decimal(1), lmtPrice: new Decimal(150) })],
      pendingOrders: [],
      now: new Date('2026-06-10T20:00:00.000Z'),
    })

    expect(audit).toMatchObject({
      ticketId: 'hermes-ibkr-paper-pilot-ibkr-001',
      runId: 'hermes-ibkr-paper-pilot-run-20260610T150159Z',
      pendingHash: 'pilot-hash',
      exitPlanMode: 'ticket-exit-plan',
    })
  })
})
