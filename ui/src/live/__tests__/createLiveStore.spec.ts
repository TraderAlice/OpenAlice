import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLiveStore, type Apply } from '../createLiveStore'

beforeEach(() => {
  // jsdom carries state between tests — reset visibility just in case.
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => 'visible',
  })
})

describe('createLiveStore — lifecycle', () => {
  it('does not open the live source until the first subscriber arrives', () => {
    const subscribe = vi.fn(() => () => {})
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe,
    })
    expect(subscribe).not.toHaveBeenCalled()

    const unsub = live.subscribe(() => {})
    expect(subscribe).toHaveBeenCalledTimes(1)
    unsub()
  })

  it('keeps a single connection across multiple concurrent subscribers', () => {
    const subscribe = vi.fn(() => () => {})
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe,
    })

    const u1 = live.subscribe(() => {})
    const u2 = live.subscribe(() => {})
    const u3 = live.subscribe(() => {})

    expect(subscribe).toHaveBeenCalledTimes(1)
    u1(); u2(); u3()
  })

  it('disposes the live source when the last subscriber leaves', () => {
    const dispose = vi.fn()
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe: () => dispose,
    })

    const u1 = live.subscribe(() => {})
    const u2 = live.subscribe(() => {})
    expect(dispose).not.toHaveBeenCalled()
    u1()
    expect(dispose).not.toHaveBeenCalled()
    u2()
    expect(dispose).toHaveBeenCalledTimes(1)
  })

  it('reopens the live source on a fresh subscription after teardown', () => {
    let opens = 0
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe: () => {
        opens++
        return () => {}
      },
    })

    live.subscribe(() => {})()  // open then close
    live.subscribe(() => {})()  // open again
    expect(opens).toBe(2)
  })
})

describe('createLiveStore — apply', () => {
  it('whole-state apply replaces the value', () => {
    let captured: Apply<{ n: number }> | null = null
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe: ({ apply }) => {
        captured = apply
        return () => {}
      },
    })

    const unsub = live.subscribe(() => {})
    captured!({ n: 42 })
    expect(live.getState()).toEqual({ n: 42 })
    unsub()
  })

  it('functional apply receives previous state and returns next', () => {
    let captured: Apply<{ count: number }> | null = null
    const live = createLiveStore<{ count: number }>({
      name: 't',
      initialState: { count: 1 },
      subscribe: ({ apply }) => {
        captured = apply
        return () => {}
      },
    })

    const unsub = live.subscribe(() => {})
    captured!((prev) => ({ count: prev.count + 1 }))
    captured!((prev) => ({ count: prev.count + 1 }))
    expect(live.getState().count).toBe(3)
    unsub()
  })

  it('apply notifies imperative subscribers', () => {
    let captured: Apply<{ n: number }> | null = null
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe: ({ apply }) => {
        captured = apply
        return () => {}
      },
    })
    const listener = vi.fn()
    const unsub = live.subscribe(listener)
    captured!({ n: 1 })
    captured!({ n: 2 })
    expect(listener).toHaveBeenCalledTimes(2)
    unsub()
  })
})

describe('createLiveStore — reconnect', () => {
  it('reconnect tears down and re-opens while there are subscribers', () => {
    let opens = 0
    let closes = 0
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe: () => {
        opens++
        return () => { closes++ }
      },
    })

    const unsub = live.subscribe(() => {})
    expect(opens).toBe(1)
    live.reconnect()
    expect(closes).toBe(1)
    expect(opens).toBe(2)
    unsub()
  })

  it('reconnect is a no-op when no one is subscribed', () => {
    let opens = 0
    const live = createLiveStore<{ n: number }>({
      name: 't',
      initialState: { n: 0 },
      subscribe: () => {
        opens++
        return () => {}
      },
    })
    live.reconnect()
    expect(opens).toBe(0)
  })
})
