/**
 * Regression tests for the /link owner-binding fix.
 *
 * Before: when the connector had no configured owner, the first person to
 * message /link became owner (first-come takeover; whoever finds the bot
 * first wins).
 * After: /link only binds a chat for a caller that matches the owner
 * configured in Connector settings. An unconfigured bot refuses to bind.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../core/adapter.js'
import { TelegramConnectorAdapter } from './telegram.js'

const startMock = vi.fn()
const getMe = vi.fn(async () => ({ id: 1, is_bot: true, first_name: 'OpenAlice', username: 'openalice_bot' }))
const setMyCommands = vi.fn(async () => undefined)

vi.mock('grammy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('grammy')>()
  return {
    ...actual,
    Bot: class {
      api = { config: { use() {} }, getMe, setMyCommands }
      command() {}
      on() {}
      start(options: { onStart?: () => void }) { return startMock(options) }
      stop() { return Promise.resolve() }
    },
    InputFile: class {},
  }
})
vi.mock('@grammyjs/auto-retry', () => ({ autoRetry: () => () => undefined }))

function freshContext(updates: Array<Record<string, unknown>>) {
  return {
    commands: new CommandRegistry('telegram'),
    updateSettings: async (patch: Record<string, string | number | boolean>) => { updates.push(patch) },
    getServiceStatus: () => 'healthy',
    sendTest: async () => 'probe',
    forwardOwnerText: async () => undefined,
    enqueueArtifactRequest: async () => 'art',
    enqueueUtaRequest: async () => 'uta',
  } as unknown as Parameters<TelegramConnectorAdapter['start']>[1]
}

async function startAdapter(settings: Record<string, string>) {
  startMock.mockImplementation((options: { onStart?: () => void }) => {
    queueMicrotask(() => options.onStart?.())
    return new Promise(() => undefined)
  })
  const updates: Array<Record<string, unknown>> = []
  const ctx = freshContext(updates)
  const adapter = new TelegramConnectorAdapter({ attemptTimeoutMs: 200, reconnectDelayMs: 20 })
  await adapter.start({ enabled: true, settings }, ctx)
  return { adapter, ctx, updates }
}

async function runLink(ctx: ReturnType<typeof freshContext>, userId: string, chatId: string): Promise<string> {
  let replyText = ''
  const handled = await ctx.commands.execute({
    connectorId: 'telegram', command: 'link', userId, chatId,
    reply: async (text: string) => { replyText = text },
  })
  expect(handled).toBe(true)
  return replyText
}

describe('/link owner binding guard', () => {
  beforeEach(() => {
    startMock.mockReset()
    getMe.mockReset(); getMe.mockResolvedValue({ id: 1, is_bot: true, first_name: 'OpenAlice', username: 'openalice_bot' })
    setMyCommands.mockReset(); setMyCommands.mockResolvedValue(undefined)
  })

  it('refuses to bind an owner when none is configured (no first-come takeover)', async () => {
    const { adapter, ctx, updates } = await startAdapter({ botToken: 'token' })
    const replyText = await runLink(ctx, 'stranger-1', '111')
    expect(replyText).toMatch(/owner account to be configured/i)
    expect(updates.length).toBe(0) // nothing persisted
    expect(adapter.health().owner).toBeUndefined()
    await adapter.stop()
  })

  it('binds the chat only for the configured owner', async () => {
    const { adapter, ctx, updates } = await startAdapter({ botToken: 'token', ownerUserId: '42' })
    const replyText = await runLink(ctx, '42', '99')
    expect(replyText).toMatch(/linked to this OpenAlice/i)
    expect(updates).toContainEqual(expect.objectContaining({ ownerUserId: '42', chatId: '99' }))
    expect(adapter.health().owner).toBe('42')
    await adapter.stop()
  })

  it('still rejects a caller that is not the configured owner', async () => {
    const { adapter, ctx, updates } = await startAdapter({ botToken: 'token', ownerUserId: '42' })
    const replyText = await runLink(ctx, 'stranger-1', '111')
    expect(replyText).toMatch(/already linked/i)
    expect(updates.length).toBe(0)
    await adapter.stop()
  })
})
