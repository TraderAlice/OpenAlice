import { beforeEach, describe, expect, it, vi } from 'vitest'

const { sockets } = vi.hoisted(() => ({
  sockets: [] as FakeWebSocket[],
}))

type Listener = (event: { data?: string | ArrayBuffer }) => void

class FakeWebSocket {
  listeners = new Map<string, Listener[]>()
  sent: string[] = []

  constructor(
    readonly url: string,
    readonly opts: unknown,
  ) {
    sockets.push(this)
  }

  addEventListener(type: string, listener: Listener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  send(message: string): void {
    this.sent.push(message)
  }

  close(): void {}

  dispatch(type: string, event: { data?: string | ArrayBuffer } = {}): void {
    for (const listener of this.listeners.get(type) ?? []) listener(event)
  }
}

vi.mock('undici', () => ({
  WebSocket: FakeWebSocket,
}))

function frame(payload: unknown): string {
  const message = typeof payload === 'string' ? payload : JSON.stringify(payload)
  return `~m~${message.length}~m~${message}`
}

async function waitForSocketCount(count: number): Promise<void> {
  for (let i = 0; i < 20; i++) {
    if (sockets.length >= count) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Expected ${count} sockets, saw ${sockets.length}`)
}

describe('fetchTradingViewBars', () => {
  beforeEach(() => {
    sockets.length = 0
  })

  it('retries a transient close before any bars are returned', async () => {
    const { fetchTradingViewBars } = await import('./websocket.js')

    const promise = fetchTradingViewBars({
      symbol: 'NASDAQ:AAPL',
      interval: '1',
      range: 1,
      retryDelayMs: 0,
    })

    sockets[0].dispatch('close')
    await waitForSocketCount(2)
    sockets[1].dispatch('message', {
      data: frame({
        m: 'timescale_update',
        p: [null, {
          $prices: {
            s: [{ v: [1_704_067_200, 100, 102, 99, 101, 1234.56] }],
          },
        }],
      }),
    })

    await expect(promise).resolves.toEqual([
      { time: 1_704_067_200, open: 100, high: 102, low: 99, close: 101, volume: 1234.56 },
    ])
    expect(sockets).toHaveLength(2)
  })

  it('does not retry provider symbol errors', async () => {
    const { fetchTradingViewBars } = await import('./websocket.js')

    const promise = fetchTradingViewBars({
      symbol: 'NASDAQ:UNKNOWN',
      interval: '1',
      range: 1,
      retryDelayMs: 0,
    })

    sockets[0].dispatch('message', {
      data: frame({ m: 'symbol_error', p: [null, null, 'not found'] }),
    })

    await expect(promise).rejects.toThrow('TradingView symbol error for NASDAQ:UNKNOWN: not found')
    expect(sockets).toHaveLength(1)
  })
})
