/**
 * UTA health tracking + auto-recovery — TDD tests.
 *
 * Covers the full lifecycle: initial connect, runtime disconnect,
 * auto-recovery, and health state transitions.
 *
 * All tests use fake timers to control recovery scheduling.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { UnifiedTradingAccount } from '../UnifiedTradingAccount.js'
import { MockBroker } from '../brokers/mock/index.js'
import '../contract-ext.js'

/** Let _connect() (fire-and-forget from constructor) complete via microtask flush. */
async function flush() { await vi.advanceTimersByTimeAsync(0) }

function createUTA(broker?: MockBroker) {
  const b = broker ?? new MockBroker()
  const uta = new UnifiedTradingAccount(b)
  return { uta, broker: b }
}

describe('UTA health — initial connect', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('connects automatically and becomes healthy', async () => {
    const { uta } = createUTA()
    await flush()

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().lastSuccessAt).toBeInstanceOf(Date)
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('goes offline when broker.init() fails at startup', async () => {
    const broker = new MockBroker()
    broker.setFailMode(1) // init() throws
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)
    expect(uta.getHealthInfo().lastError).toContain('simulated init failure')
    await uta.close()
  })
})

describe('UTA health — auto-recovery from initial connect failure', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('recovers when broker comes back after first attempt', async () => {
    const broker = new MockBroker()
    broker.setFailMode(1) // _connect → init() fails
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')

    // failMode exhausted — recovery at 5s should succeed
    await vi.advanceTimersByTimeAsync(5_000)

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('retries with exponential backoff when broker stays down', async () => {
    const broker = new MockBroker()
    broker.setFailMode(100) // stays broken
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.health).toBe('offline')

    // 1st recovery at 5s — still fails
    await vi.advanceTimersByTimeAsync(5_000)
    expect(uta.health).toBe('offline')

    // 2nd recovery at 10s — still fails
    await vi.advanceTimersByTimeAsync(10_000)
    expect(uta.health).toBe('offline')

    // 3rd recovery at 20s — still fails
    await vi.advanceTimersByTimeAsync(20_000)
    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)

    await uta.close()
  })

  it('recovers on later attempt after earlier recoveries also fail', async () => {
    const broker = new MockBroker()
    // Each attempt calls broker.init() which consumes 1 fail if failing.
    // _connect: init fails (1), recovery #1 at 5s: init fails (2), recovery #2 at 10s+5s: init succeeds
    broker.setFailMode(2)
    const { uta } = createUTA(broker)
    await flush()
    expect(uta.health).toBe('offline')

    // 1st recovery at 5s — init still fails (consumes fail #2)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(uta.health).toBe('offline')

    // 2nd recovery at 5s + 10s = 15s — failMode exhausted, init + getAccount succeed
    await vi.advanceTimersByTimeAsync(10_000)
    expect(uta.health).toBe('healthy')
  })
})

describe('UTA health — runtime disconnect and recovery', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('healthy → degraded after 3 consecutive failures', async () => {
    const { uta, broker } = createUTA()
    await flush()
    expect(uta.health).toBe('healthy')

    broker.setFailMode(3)
    for (let i = 0; i < 3; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    expect(uta.health).toBe('degraded')
  })

  it('healthy → offline after 6 consecutive failures, triggers recovery', async () => {
    const { uta, broker } = createUTA()
    await flush()

    broker.setFailMode(100)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    expect(uta.health).toBe('offline')
    expect(uta.getHealthInfo().recovering).toBe(true)
    await uta.close()
  })

  it('recovers from runtime disconnect when broker comes back', async () => {
    const { uta, broker } = createUTA()
    await flush()

    // Go offline
    broker.setFailMode(6)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('offline')

    // failMode exhausted — recovery should succeed
    await vi.advanceTimersByTimeAsync(5_000)

    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().recovering).toBe(false)
  })

  it('any successful call resets to healthy', async () => {
    const { uta, broker } = createUTA()
    await flush()

    broker.setFailMode(4)
    for (let i = 0; i < 4; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }
    expect(uta.health).toBe('degraded')

    // failMode exhausted — next call succeeds
    await uta.getAccount()
    expect(uta.health).toBe('healthy')
    expect(uta.getHealthInfo().consecutiveFailures).toBe(0)
  })

  it('tracks failures across different broker methods', async () => {
    const { uta, broker } = createUTA()
    await flush()

    broker.setFailMode(2)
    await expect(uta.getAccount()).rejects.toThrow()
    await expect(uta.getPositions()).rejects.toThrow()
    expect(uta.getHealthInfo().consecutiveFailures).toBe(2)

    await uta.getMarketClock()
    expect(uta.health).toBe('healthy')
  })
})

describe('UTA health — offline behavior', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('broker calls fail fast when offline + recovering', async () => {
    const { uta, broker } = createUTA()
    await flush()

    broker.setFailMode(100)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    // Now offline — should fail fast without hitting broker
    await expect(uta.getAccount()).rejects.toThrow(/offline and reconnecting/)
    await uta.close()
  })

  it('push() throws when offline', async () => {
    const { uta, broker } = createUTA()
    await flush()

    broker.setFailMode(100)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    uta.commit('buy AAPL')
    await expect(uta.push()).rejects.toThrow(/offline/)
    await uta.close()
  })

  it('staging and commit still work when offline (pure in-memory)', async () => {
    const { uta, broker } = createUTA()
    await flush()

    broker.setFailMode(100)
    for (let i = 0; i < 6; i++) {
      await expect(uta.getAccount()).rejects.toThrow()
    }

    // Staging is a local operation — should work even when offline
    const result = uta.stagePlaceOrder({ aliceId: 'mock-paper|AAPL', action: 'BUY', orderType: 'MKT', totalQuantity: '10' })
    expect(result.staged).toBe(true)

    const commit = uta.commit('buy while offline')
    expect(commit.prepared).toBe(true)

    await uta.close()
  })
})

describe('UTA health — close() cleanup', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('cancels recovery timer on close', async () => {
    const broker = new MockBroker()
    broker.setFailMode(100)
    const { uta } = createUTA(broker)
    await flush()

    expect(uta.getHealthInfo().recovering).toBe(true)
    await uta.close()
    expect(uta.getHealthInfo().recovering).toBe(false)
  })
})
