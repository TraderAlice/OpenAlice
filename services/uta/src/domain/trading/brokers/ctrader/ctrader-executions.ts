/**
 * Recent execution events per order.
 *
 * A request settles on its FIRST reply (usually ORDER_ACCEPTED); the fill,
 * cancel or rejection follows as further events, sometimes in the same
 * tick. Events are kept briefly so a waiter registered just after the fact
 * still sees them.
 */

import { PayloadType, type CtraderEnvelope } from './ctrader-protocol.js'
import type { CtraderSession } from './ctrader-session.js'

export const ExecutionType = {
  ORDER_ACCEPTED: 2,
  ORDER_FILLED: 3,
  ORDER_REPLACED: 4,
  ORDER_CANCELLED: 5,
  ORDER_EXPIRED: 6,
  ORDER_REJECTED: 7,
  ORDER_CANCEL_REJECTED: 8,
  ORDER_PARTIAL_FILL: 11,
  /** Synthetic: a ProtoOAOrderErrorEvent for this order. */
  ORDER_ERROR: -1,
} as const

type Row = Record<string, unknown>

export interface ExecutionUpdate {
  executionType: number
  orderId: number
  order: Row | undefined
  position: Row | undefined
  deal: Row | undefined
  errorCode: string | undefined
  description: string | undefined
  receivedAt: number
}

const RETENTION_MS = 120_000

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function obj(value: unknown): Row | undefined {
  return value && typeof value === 'object' ? (value as Row) : undefined
}

/** Parse an EXECUTION_EVENT or ORDER_ERROR_EVENT envelope. */
export function parseExecution(message: CtraderEnvelope, receivedAt: number): ExecutionUpdate | null {
  const p = message.payload ?? {}
  if (message.payloadType === PayloadType.EXECUTION_EVENT) {
    const order = obj(p['order'])
    const deal = obj(p['deal'])
    const orderId = num(order?.['orderId']) ?? num(deal?.['orderId'])
    const executionType = num(p['executionType'])
    if (orderId === undefined || executionType === undefined) return null
    return {
      executionType,
      orderId,
      order,
      position: obj(p['position']),
      deal,
      errorCode: typeof p['errorCode'] === 'string' ? p['errorCode'] : undefined,
      description: undefined,
      receivedAt,
    }
  }
  if (message.payloadType === PayloadType.ORDER_ERROR_EVENT) {
    const orderId = num(p['orderId'])
    if (orderId === undefined) return null
    return {
      executionType: ExecutionType.ORDER_ERROR,
      orderId,
      order: undefined,
      position: undefined,
      deal: undefined,
      errorCode: typeof p['errorCode'] === 'string' ? p['errorCode'] : 'UNKNOWN_ERROR',
      description: typeof p['description'] === 'string' ? p['description'] : undefined,
      receivedAt,
    }
  }
  return null
}

interface Waiter {
  orderId: number
  types: ReadonlySet<number>
  resolve: (update: ExecutionUpdate | undefined) => void
  timer: ReturnType<typeof setTimeout>
}

export class CtraderExecutions {
  private readonly recent = new Map<number, ExecutionUpdate[]>()
  private readonly waiters = new Set<Waiter>()

  constructor(session: CtraderSession, private readonly clock: () => number = () => Date.now()) {
    session.onEvent((message) => {
      const update = parseExecution(message, this.clock())
      if (update) this.record(update)
    })
  }

  /** Record a reply that settled a request (it is also broadcast, so dedupe). */
  record(update: ExecutionUpdate): void {
    this.prune()
    const list = this.recent.get(update.orderId) ?? []
    const duplicate = list.some((u) => u.executionType === update.executionType
      && num(u.deal?.['dealId']) === num(update.deal?.['dealId'])
      && num(u.order?.['utcLastUpdateTimestamp']) === num(update.order?.['utcLastUpdateTimestamp']))
    if (!duplicate) list.push(update)
    this.recent.set(update.orderId, list)
    for (const waiter of [...this.waiters]) {
      if (waiter.orderId === update.orderId && waiter.types.has(update.executionType)) {
        this.settle(waiter, update)
      }
    }
  }

  /** The latest seen update of one of `types`, or wait up to `timeoutMs` for it. */
  waitFor(orderId: number, types: readonly number[], timeoutMs: number): Promise<ExecutionUpdate | undefined> {
    const wanted = new Set(types)
    const seen = (this.recent.get(orderId) ?? []).filter((u) => wanted.has(u.executionType))
    if (seen.length > 0) return Promise.resolve(seen[seen.length - 1])
    if (timeoutMs <= 0) return Promise.resolve(undefined)
    return new Promise((resolve) => {
      const waiter: Waiter = {
        orderId,
        types: wanted,
        resolve,
        timer: setTimeout(() => this.settle(waiter, undefined), timeoutMs),
      }
      this.waiters.add(waiter)
    })
  }

  private settle(waiter: Waiter, update: ExecutionUpdate | undefined): void {
    if (!this.waiters.delete(waiter)) return
    clearTimeout(waiter.timer)
    waiter.resolve(update)
  }

  private prune(): void {
    const cutoff = this.clock() - RETENTION_MS
    for (const [orderId, list] of this.recent) {
      const kept = list.filter((u) => u.receivedAt >= cutoff)
      if (kept.length === 0) this.recent.delete(orderId)
      else if (kept.length !== list.length) this.recent.set(orderId, kept)
    }
  }
}
