import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxNotification } from '@traderalice/connector-protocol'
import { CommandRegistry } from '../core/adapter.js'
import { formatInboxNotification } from './shared.js'
import { TelegramConnectorAdapter, withTimeout } from './telegram.js'

const startMock = vi.fn()
const stopMock = vi.fn()
const setMyCommands = vi.fn(async () => undefined)
const sendRichMessage = vi.fn(async () => undefined)
const sendMessage = vi.fn(async () => undefined)
const sendDocument = vi.fn(async () => undefined)

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>()
  return {
    ...actual,
    Bot: class {
      api = {
        config: { use() {} },
        setMyCommands,
        sendRichMessage,
        sendMessage,
        sendDocument,
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
  }
})

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
    sendRichMessage.mockReset()
    sendMessage.mockReset()
    sendDocument.mockReset()
    stopMock.mockResolvedValue(undefined)
    sendRichMessage.mockResolvedValue(undefined)
    sendMessage.mockResolvedValue(undefined)
    sendDocument.mockResolvedValue(undefined)
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

describe('Telegram rich outbound text', () => {
  beforeEach(() => {
    startMock.mockReset()
    stopMock.mockReset()
    sendRichMessage.mockReset()
    sendMessage.mockReset()
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    sendRichMessage.mockResolvedValue(undefined)
    sendMessage.mockResolvedValue(undefined)
  })

  it('projects owner comments as rich GFM', async () => {
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 200 })
    await adapter.start({
      enabled: true,
      settings: { botToken: 'token', ownerUserId: '42', chatId: '99' },
    }, context())
    const markdown = '**hello**\n\n- one\n- two'

    await adapter.sendOwnerText(markdown)

    expect(sendRichMessage).toHaveBeenCalledWith('99', { markdown })
    expect(sendMessage).not.toHaveBeenCalled()
  })

  it('sends Inbox notifications as rich GFM', async () => {
    const adapter = new TelegramConnectorAdapter({ startupTimeoutMs: 200 })
    await adapter.start({
      enabled: true,
      settings: { botToken: 'token', ownerUserId: '42', chatId: '99' },
    }, context())
    const notification: InboxNotification = {
      id: 'inbox-1',
      createdAt: '2026-07-13T00:00:00.000Z',
      workspaceId: 'ws-1',
      workspaceLabel: 'Research *desk*',
      title: 'Close [scan]',
      body: 'Three **findings**.',
      provenance: { resumeId: 'resume-calm-river-12ab' },
      href: 'https://openalice.example/inbox',
    }

    await adapter.deliver(notification)

    expect(sendRichMessage).toHaveBeenCalledWith('99', {
      markdown: formatInboxNotification(notification),
    })
    expect(sendMessage).not.toHaveBeenCalled()
  })
})
