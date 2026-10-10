/**
 * Live bid/ask cache fed by cTrader spot subscriptions.
 *
 * Spot events may carry only the side that changed, so sides are merged.
 * Subscriptions are remembered and replayed after every re-authentication
 * (a new connection starts with none).
 */

import { PayloadType, type CtraderEnvelope } from './ctrader-protocol.js'
import { CtraderApiError } from './ctrader-transport.js'
import type { CtraderSession } from './ctrader-session.js'

export interface SpotPrice {
  /** 1/100000-scaled integers, as on the wire. */
  bid: number | undefined
  ask: number | undefined
  timestamp: Date
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

export class CtraderSpots {
  private readonly prices = new Map<number, SpotPrice>()
  private readonly wanted = new Set<number>()
  private readonly active = new Set<number>()
  private readonly waiters = new Map<number, Set<() => void>>()

  constructor(private readonly session: CtraderSession, private readonly now: () => Date = () => new Date()) {
    session.onEvent((message) => this.handleEvent(message))
    session.onReady(() => {
      this.active.clear()
      if (this.wanted.size > 0) void this.subscribe([...this.wanted]).catch(() => {})
    })
  }

  latest(symbolId: number): SpotPrice | undefined {
    return this.prices.get(symbolId)
  }

  /**
   * Subscribe if needed and wait until both sides are known, up to
   * `timeoutMs`. Resolves with whatever is known at the deadline (possibly
   * nothing when the market is closed and no tick arrives).
   */
  async get(symbolId: number, timeoutMs: number): Promise<SpotPrice | undefined> {
    const known = this.prices.get(symbolId)
    if (known?.bid !== undefined && known.ask !== undefined && this.active.has(symbolId)) return known
    await this.subscribe([symbolId])
    const ready = this.prices.get(symbolId)
    if (ready?.bid !== undefined && ready.ask !== undefined) return ready
    await new Promise<void>((resolve) => {
      const set = this.waiters.get(symbolId) ?? new Set()
      const done = () => {
        clearTimeout(timer)
        set.delete(done)
        resolve()
      }
      const timer = setTimeout(done, timeoutMs)
      set.add(done)
      this.waiters.set(symbolId, set)
    })
    return this.prices.get(symbolId)
  }

  async subscribe(symbolIds: number[]): Promise<void> {
    for (const id of symbolIds) this.wanted.add(id)
    const fresh = [...new Set(symbolIds)].filter((id) => !this.active.has(id))
    if (fresh.length === 0) return
    try {
      await this.session.accountRequest(
        PayloadType.SUBSCRIBE_SPOTS_REQ,
        { symbolId: fresh, subscribeToSpotTimestamp: true },
        { expect: PayloadType.SUBSCRIBE_SPOTS_RES },
      )
    } catch (err) {
      if (!(err instanceof CtraderApiError && err.errorCode === 'ALREADY_SUBSCRIBED')) throw err
    }
    for (const id of fresh) this.active.add(id)
  }

  private handleEvent(message: CtraderEnvelope): void {
    if (message.payloadType !== PayloadType.SPOT_EVENT) return
    const p = message.payload ?? {}
    const symbolId = num(p['symbolId'])
    if (symbolId === undefined) return
    const previous = this.prices.get(symbolId)
    const ts = num(p['timestamp'])
    const next: SpotPrice = {
      bid: num(p['bid']) ?? previous?.bid,
      ask: num(p['ask']) ?? previous?.ask,
      timestamp: ts !== undefined ? new Date(ts) : this.now(),
    }
    this.prices.set(symbolId, next)
    if (next.bid !== undefined && next.ask !== undefined) {
      const waiters = this.waiters.get(symbolId)
      if (waiters) for (const done of [...waiters]) done()
    }
  }
}
