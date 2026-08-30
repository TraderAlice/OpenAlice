import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InboxNotification } from '@traderalice/connector-protocol'
import { CommandRegistry } from '../core/adapter.js'
import { formatInboxNotification } from './shared.js'
import { TelegramConnectorAdapter, withTimeout } from './telegram.js'

const startMock = vi.fn()
const stopMock = vi.fn()
const getMe = vi.fn(async () => ({ id: 1, is_bot: true, first_name: 'OpenAlice', username: 'openalice_bot' }))
const setMyCommands = vi.fn(async () => undefined)
const sendRichMessage = vi.fn(async () => undefined)
const sendMessageDraft = vi.fn(async () => true)
const sendRichMessageDraft = vi.fn(async () => true)
const sendChatAction = vi.fn(async () => true)
const sendMessage = vi.fn(async () => undefined)
const sendDocument = vi.fn(async () => undefined)

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>()
  return {
    ...actual,
    Bot: class {
      api = {
        config: { use() {} },
        getMe,
        setMyCommands,
        sendRichMessage,
        sendMessageDraft,
        sendRichMessageDraft,
        sendChatAction,
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
    enqueueArtifactRequest: async () => 'art-test',
    enqueueUtaRequest: async () => 'uta-test',
  }
}

async function startUntilReady(
  adapter: TelegramConnectorAdapter,
  settings: Record<string, string>,
): Promise<void> {
  await adapter.start({ enabled: true, settings }, context())
  await vi.waitFor(() => {
    expect(['healthy', 'awaiting_link']).toContain(adapter.health().status)
  })
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
    getMe.mockReset()
    getMe.mockResolvedValue({ id: 1, is_bot: true, first_name: 'OpenAlice', username: 'openalice_bot' })
    setMyCommands.mockReset()
    setMyCommands.mockResolvedValue(undefined)
    sendRichMessage.mockReset()
    sendMessageDraft.mockReset()
    sendMessageDraft.mockResolvedValue(true)
    sendRichMessageDraft.mockReset()
    sendRichMessageDraft.mockResolvedValue(true)
    sendChatAction.mockReset()
    sendChatAction.mockResolvedValue(true)
    sendMessage.mockReset()
    sendDocument.mockReset()
    stopMock.mockResolvedValue(undefined)
    sendRichMessage.mockResolvedValue(undefined)
    sendMessage.mockResolvedValue(undefined)
    sendDocument.mockResolvedValue(undefined)
  })

  it('returns from start while still connecting, then becomes awaiting_link', async () => {
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })

    const started = adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    expect(adapter.health().status).toBe('starting')
    await started
    await vi.waitFor(() => {
      expect(adapter.health().status).toBe('awaiting_link')
    })
    await adapter.stop()
  })

  it('does not let a hung command menu block polling or start()', async () => {
    setMyCommands.mockImplementation(() => new Promise(() => undefined))
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })

    await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    await vi.waitFor(() => {
      expect(adapter.health().status).toBe('awaiting_link')
    })
    expect(startMock).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('still starts polling when the command menu cannot be published', async () => {
    setMyCommands.mockRejectedValue(new Error("Call to 'setMyCommands' failed! (404: Not Found)"))
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })

    await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    await vi.waitFor(() => {
      expect(adapter.health().status).toBe('awaiting_link')
    })
    expect(startMock).toHaveBeenCalledOnce()
    await adapter.stop()
  })

  it('marks a linked bot healthy only after polling is ready', async () => {
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })

    await adapter.start({
      enabled: true,
      settings: { botToken: 'token', ownerUserId: '42', chatId: '42' },
    }, context())
    await vi.waitFor(() => {
      expect(adapter.health()).toMatchObject({ status: 'healthy', owner: '42' })
    })
    await adapter.stop()
  })

  it('abandons a hung session and reconnects without failing start()', async () => {
    let attempts = 0
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      attempts += 1
      if (attempts >= 2) queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 20, reconnectDelayMs: 5 })

    await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    expect(adapter.health().status).toBe('starting')
    await vi.waitFor(() => {
      expect(adapter.health().status).toBe('awaiting_link')
      expect(attempts).toBeGreaterThanOrEqual(2)
    })
    await adapter.stop()
  })

  it('reconnects after polling drops', async () => {
    let attempts = 0
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      attempts += 1
      queueMicrotask(() => options.onStart?.())
      if (attempts === 1) return Promise.reject(new Error('Network request for \'getUpdates\' failed!'))
      return new Promise(() => undefined)
    })
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 5 })

    await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    await vi.waitFor(() => {
      expect(attempts).toBeGreaterThanOrEqual(2)
      expect(adapter.health().status).toBe('awaiting_link')
    })
    await adapter.stop()
  })

  it('abandons a polling promise that stayed pending across host sleep', async () => {
    vi.useFakeTimers()
    try {
      let attempts = 0
      startMock.mockImplementation((options: { onStart?: () => void }) => {
        attempts += 1
        queueMicrotask(() => options.onStart?.())
        return new Promise(() => undefined)
      })
      const adapter = new TelegramConnectorAdapter({
        attemptTimeoutMs: 200,
        reconnectDelayMs: 5,
        resumeCheckIntervalMs: 10,
        resumeGapMs: 25,
      })

      await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
      await vi.advanceTimersByTimeAsync(0)
      expect(attempts).toBe(1)

      vi.setSystemTime(Date.now() + 100)
      await vi.advanceTimersByTimeAsync(20)

      expect(attempts).toBeGreaterThanOrEqual(2)
      await adapter.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops a pending reconnect', async () => {
    startMock.mockImplementation(() => new Promise(() => undefined))
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 20, reconnectDelayMs: 50 })

    await adapter.start({ enabled: true, settings: { botToken: 'token' } }, context())
    await vi.waitFor(() => {
      expect(startMock).toHaveBeenCalled()
    })
    await adapter.stop()
    const afterStop = startMock.mock.calls.length
    await new Promise((resolve) => setTimeout(resolve, 80))
    expect(startMock.mock.calls.length).toBe(afterStop)
    expect(adapter.health().status).toBe('stopped')
  })

  it('reports validation failures instead of remaining stuck in starting', async () => {
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 20 })

    await expect(adapter.start(
      { enabled: true, settings: {} },
      context(),
    )).rejects.toThrow('Telegram setting botToken is required')
    expect(adapter.health()).toMatchObject({
      status: 'degraded',
      lastError: 'Telegram setting botToken is required',
    })
    expect(startMock).not.toHaveBeenCalled()
  })
})

describe('Telegram rich outbound text', () => {
  beforeEach(() => {
    startMock.mockReset()
    stopMock.mockReset()
    getMe.mockReset()
    getMe.mockResolvedValue({ id: 1, is_bot: true, first_name: 'OpenAlice', username: 'openalice_bot' })
    sendRichMessage.mockReset()
    sendMessageDraft.mockReset()
    sendMessageDraft.mockResolvedValue(true)
    sendRichMessageDraft.mockReset()
    sendRichMessageDraft.mockResolvedValue(true)
    sendChatAction.mockReset()
    sendChatAction.mockResolvedValue(true)
    sendMessage.mockReset()
    sendDocument.mockReset()
    startMock.mockImplementation((options: { onStart?: () => void }) => {
      queueMicrotask(() => options.onStart?.())
      return new Promise(() => undefined)
    })
    stopMock.mockResolvedValue(undefined)
    sendRichMessage.mockResolvedValue(undefined)
    sendMessage.mockResolvedValue(undefined)
    sendDocument.mockResolvedValue(undefined)
  })

  it('projects owner comments as rich GFM', async () => {
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
    await startUntilReady(adapter, { botToken: 'token', ownerUserId: '42', chatId: '99' })
    const markdown = '**hello**\n\n- one\n- two'

    await adapter.sendOwnerText(markdown)

    expect(sendRichMessage).toHaveBeenCalledWith('99', { markdown })
    expect(sendMessage).not.toHaveBeenCalled()
    await adapter.stop()
  })

  it('shows a native draft before model text, updates it, then persists the final reply', async () => {
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
    await startUntilReady(adapter, { botToken: 'token', ownerUserId: '42', chatId: '99' })

    await adapter.sendOwnerChat({
      id: 'accepted-1', adapterId: 'telegram', conversationId: 'comment-1', phase: 'accepted',
    })
    await adapter.sendOwnerChat({
      id: 'progress-1', adapterId: 'telegram', conversationId: 'comment-1', phase: 'progress',
      text: 'Checking the market.',
    })
    await adapter.sendOwnerChat({
      id: 'final-1', adapterId: 'telegram', conversationId: 'comment-1', phase: 'final',
      text: 'The market is quiet.',
    })
    await adapter.sendOwnerChat({
      id: 'late-progress', adapterId: 'telegram', conversationId: 'comment-1', phase: 'progress',
      text: 'Late transport update.',
    })

    const draftId = expect.any(Number)
    expect(sendMessageDraft).toHaveBeenCalledWith(99, draftId, '')
    expect(sendRichMessageDraft).toHaveBeenCalledWith(99, draftId, { markdown: 'Checking the market.' })
    expect(sendRichMessageDraft).toHaveBeenCalledTimes(1)
    expect(sendRichMessage).toHaveBeenCalledWith('99', { markdown: 'The market is quiet.' })
    await adapter.stop()
  })

  it('falls back to Telegram typing when live drafts are unavailable', async () => {
    sendMessageDraft.mockRejectedValueOnce(new Error('method unavailable'))
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
    await startUntilReady(adapter, { botToken: 'token', ownerUserId: '42', chatId: '99' })

    await adapter.sendOwnerChat({
      id: 'accepted-1', adapterId: 'telegram', conversationId: 'comment-1', phase: 'accepted',
    })

    expect(sendChatAction).toHaveBeenCalledWith(99, 'typing')
    await adapter.stop()
  })

  it('refreshes an active draft before its TTL and stops after the final reply', async () => {
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
    await startUntilReady(adapter, { botToken: 'token', ownerUserId: '42', chatId: '99' })
    vi.useFakeTimers()
    try {
      await adapter.sendOwnerChat({
        id: 'accepted-1', adapterId: 'telegram', conversationId: 'comment-1', phase: 'accepted',
      })
      expect(sendMessageDraft).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sendMessageDraft).toHaveBeenCalledTimes(2)

      await adapter.sendOwnerChat({
        id: 'final-1', adapterId: 'telegram', conversationId: 'comment-1', phase: 'final', text: 'Done.',
      })
      await vi.advanceTimersByTimeAsync(20_000)
      expect(sendMessageDraft).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
      await adapter.stop()
    }
  })

  it('sends Inbox notifications as rich GFM', async () => {
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
    await startUntilReady(adapter, { botToken: 'token', ownerUserId: '42', chatId: '99' })
    const attachment = Buffer.from('# Close scan\n')
    const notification: InboxNotification = {
      id: 'inbox-1',
      createdAt: '2026-07-13T00:00:00.000Z',
      workspaceId: 'ws-1',
      workspaceLabel: 'Research *desk*',
      title: 'Close [scan]',
      body: 'Three **findings**.',
      provenance: { resumeId: 'resume-calm-river-12ab' },
      href: 'https://openalice.example/inbox',
      attachments: [{
        filename: 'close.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: attachment.byteLength,
        contentSha256: createHash('sha256').update(attachment).digest('hex'),
        contentBase64: attachment.toString('base64'),
      }],
    }

    await adapter.deliver(notification)

    expect(sendRichMessage).toHaveBeenCalledWith('99', {
      markdown: formatInboxNotification(notification),
    })
    expect(sendMessage).not.toHaveBeenCalled()
    expect(sendDocument).not.toHaveBeenCalled()
    await adapter.stop()
  })

  it('sends a requested file without repeating the Inbox summary', async () => {
    const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
    await startUntilReady(adapter, { botToken: 'token', ownerUserId: '42', chatId: '99' })
    const content = Buffer.from('# Close scan\n')

    await adapter.deliverArtifact({
      requestId: 'art-1',
      connectorId: 'telegram',
      entryId: 'entry-1',
      docIndex: 0,
      attachment: {
        filename: 'close.md',
        mediaType: 'text/markdown; charset=utf-8',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      },
    })

    expect(sendDocument).toHaveBeenCalledOnce()
    expect(sendDocument).toHaveBeenCalledWith(
      '99',
      expect.any(Object),
      { caption: 'Current file: close.md' },
    )
    expect(sendRichMessage).not.toHaveBeenCalled()
    expect(sendMessage).not.toHaveBeenCalled()
    await adapter.stop()
  })
})
