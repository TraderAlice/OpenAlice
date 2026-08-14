import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../core/adapter.js'
import { TelegramConnectorAdapter, withTimeout } from './telegram.js'

const startMock = vi.fn()
const stopMock = vi.fn()
const setMyCommands = vi.fn(async () => undefined)

vi.mock('grammy', () => ({
  Bot: class {
    api = {
      config: { use() {} },
      setMyCommands,
    }
    command() {}
    on() {}
    start(options: { onStart?: () => void }) {
      return startMock(options)
    }
    stop() {
      return stopMock()
    }
  },
  InputFile: class {},
}))

vi.mock('@grammyjs/auto-retry', () => ({
  autoRetry: () => () => undefined,
}))

function context() {
  return {
    commands: new CommandRegistry('telegram'),
    updateSettings: async () => undefined,
    getServiceStatus: () => 'healthy',
    sendTest: async () => 'probe',
    forwardOwnerText: async () => undefined,
  }
}

describe('Telegram startup timeout', () => {
  it('rejects an external startup operation that does not settle in time', async () => {
    await expect(withTimeout(
      () => new Promise<void>(() => undefined),
      10,
      'Telegram polling did not become ready within 10 seconds',
    )).rejects.toThrow('Telegram polling did not become ready within 10 seconds')
  })

  it('returns a successful startup result before the timeout', async () => {
    await expect(withTimeout(async () => 'ready', 100, 'timed out')).resolves.toBe('ready')
  })
})

describe('Telegram polling readiness', () => {
  beforeEach(() => {
    startMock.mockReset()
    stopMock.mockReset()
    setMyCommands.mockClear()
    stopMock.mockResolvedValue(undefined)
  })

  it('does not claim awaiting_link until long polling has started', async () => {
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 200 })

    const started = adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    expect(adapter.health().status).toBe('starting')
    await started

    expect(adapter.health().status).toBe('awaiting_link')
    expect(setMyCommands).toHaveBeenCalledOnce()
  })

  it('still starts polling when the command menu cannot be published', async () => {
    setMyCommands.mockRejectedValueOnce(new Error("Call to 'setMyCommands' failed! (404: Not Found)"))
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 200 })

    await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())

    expect(adapter.health().status).toBe('awaiting_link')
    expect(startMock).toHaveBeenCalledOnce()
  })

  it('marks a linked bot healthy only after polling is ready', async () => {
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 200 })

    await adapter.start({
      enabled: true,
      settings: { botToken: 'token', ownerUserId: '42', chatId: '42' },
    }, context())

    expect(adapter.health()).toMatchObject({ status: 'healthy', owner: '42' })
  })

  it('stays degraded when polling never becomes ready', async () => {
    startMock.mockImplementation(() => new Promise(() => undefined))
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 20 })

    await expect(adapter.start(
      { enabled: true, settings: { botToken: 'token' } },
      context(),
    )).rejects.toThrow('Telegram polling did not become ready within 20ms')
    expect(adapter.health().status).toBe('degraded')
    expect(stopMock).toHaveBeenCalled()
  })

  it('reports validation failures instead of remaining stuck in starting', async () => {
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 20 })

    await expect(adapter.start(
      { enabled: true, settings: {} },
      context(),
    )).rejects.toThrow('Telegram setting botToken is required')
    expect(adapter.health()).toMatchObject({
      status: 'degraded',
      lastError: 'Telegram setting botToken is required',
    })
  })
})
