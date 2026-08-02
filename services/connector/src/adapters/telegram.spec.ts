import type { Agent as NodeHttpAgent } from 'node:http'
import type nodeFetch from 'node-fetch'
import type { Response } from 'node-fetch'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry, type ConnectorAdapterContext } from '../core/adapter.js'
import type { ConnectorProxyTransport } from '../core/proxy.js'

const telegramMocks = vi.hoisted(() => ({
  construct: vi.fn(),
  autoRetry: vi.fn(() => Symbol('retry-transformer')),
  use: vi.fn(),
  command: vi.fn(),
  setMyCommands: vi.fn(),
  init: vi.fn(),
  start: vi.fn(),
  stop: vi.fn(),
}))

vi.mock('@grammyjs/auto-retry', () => ({ autoRetry: telegramMocks.autoRetry }))
vi.mock('grammy', () => ({
  Bot: class {
    readonly api = {
      config: { use: telegramMocks.use },
      setMyCommands: telegramMocks.setMyCommands,
    }
    readonly command = telegramMocks.command
    readonly init = telegramMocks.init
    readonly start = telegramMocks.start
    readonly stop = telegramMocks.stop

    constructor(token: string, config: unknown) {
      telegramMocks.construct(token, config)
    }
  },
  InputFile: class {},
}))

import { createTelegramFetch, TelegramConnectorAdapter } from './telegram.js'

describe('TelegramConnectorAdapter proxy startup', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    telegramMocks.setMyCommands.mockResolvedValue(true)
    telegramMocks.init.mockResolvedValue(undefined)
    telegramMocks.start.mockResolvedValue(undefined)
    telegramMocks.stop.mockResolvedValue(undefined)
  })

  it('passes the shared Node agent into grammY and bounds retries', async () => {
    const nodeAgent = {} as NodeHttpAgent
    const proxy: ConnectorProxyTransport = {
      active: true,
      nodeAgent,
      close: async () => undefined,
    }
    const adapter = new TelegramConnectorAdapter(proxy)

    await adapter.start({ enabled: true, settings: { botToken: 'test-token' } }, context())

    expect(telegramMocks.construct).toHaveBeenCalledWith('test-token', {
      client: {
        timeoutSeconds: 45,
        baseFetchConfig: { agent: nodeAgent },
        fetch: expect.any(Function),
      },
    })
    expect(telegramMocks.autoRetry).toHaveBeenCalledWith({
      maxRetryAttempts: 2,
      maxDelaySeconds: 10,
    })
    const commandSignal = telegramMocks.setMyCommands.mock.calls[0]?.[2]
    expect(commandSignal).toBeInstanceOf(AbortSignal)
    expect(telegramMocks.init).toHaveBeenCalledWith(commandSignal)
  })

  it('mirrors grammY shim cancellation into a native AbortSignal', async () => {
    const sourceController = new AbortController()
    let receivedSignal: AbortSignal | undefined
    let finish: ((response: Response) => void) | undefined
    const fetchImplementation = vi.fn((_url, init) => {
      receivedSignal = init?.signal
      return new Promise<Response>((resolve) => { finish = resolve })
    }) as unknown as typeof nodeFetch
    const fetch = createTelegramFetch(fetchImplementation)

    const request = fetch('https://api.telegram.org', { signal: sourceController.signal })
    sourceController.abort()

    expect(receivedSignal).not.toBe(sourceController.signal)
    expect(receivedSignal?.aborted).toBe(true)
    finish?.({} as Response)
    await request
  })
})

function context(): ConnectorAdapterContext {
  return {
    commands: new CommandRegistry('telegram'),
    updateSettings: vi.fn(),
    getServiceStatus: () => 'healthy',
    sendTest: vi.fn(),
  }
}
