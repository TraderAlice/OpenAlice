import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  ConnectorArtifactDelivery,
  InboxNotification,
} from '@traderalice/connector-protocol'
import { isInboxPushEnabled, TELEGRAM_CONNECTOR_DEFINITION } from '@traderalice/connector-protocol'
import { createInboxStore, type IInboxStore } from '@/core/inbox-store.js'
import type {
  ConnectorAdapter,
  ConnectorAdapterContext,
  ConnectorAdapterRegistration,
} from '../core/adapter.js'
import {
  AdapterHealthTracker,
  DEFAULT_CONNECTION_ATTEMPT_TIMEOUT_MS,
  DEFAULT_CONNECTION_RETRY_DELAY_MS,
  decodeConnectorAttachment,
  formatAdapterError,
  formatInboxNotification,
  formatPlainInboxNotification,
  superviseLongConnection,
} from './shared.js'
import { formatTelegramInboxMarkdownV2 } from './telegram-markdown-v2.js'
import {
  TELEGRAM_INBOX_PAGE_SIZE,
  advanceInboxSession,
  formatTelegramInboxPage,
  formatTelegramSettingsPage,
  parseTelegramControl,
  truncateTelegramText,
  transitionTelegramInbox,
  type TelegramInboxSession,
} from './telegram-controls.js'
import { sendTelegramRichText } from './telegram-rich-text.js'

export class TelegramConnectorAdapter implements ConnectorAdapter {
  readonly id = 'telegram'
  private readonly tracker = new AdapterHealthTracker(this.id)
  private readonly attemptTimeoutMs: number
  private readonly reconnectDelayMs: number
  private bot?: Bot
  private sessionReady = false
  private ownerUserId?: string
  private chatId?: string
  private inboxPush = true
  private inboxStore?: IInboxStore
  private readonly inboxSessions = new Map<string, TelegramInboxSession>()
  private stopped = true
  private loop?: Promise<void>
  private abort?: AbortController
  private token?: string
  private adapterContext?: ConnectorAdapterContext

  constructor(options: {
    attemptTimeoutMs?: number
    reconnectDelayMs?: number
    startupTimeoutMs?: number
    inboxStore?: IInboxStore
  } = {}) {
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? options.startupTimeoutMs ?? DEFAULT_CONNECTION_ATTEMPT_TIMEOUT_MS
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_CONNECTION_RETRY_DELAY_MS
    this.inboxStore = options.inboxStore
  }

  async start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void> {
    let token: string
    try {
      token = requiredString(config, 'botToken')
    } catch (error) {
      this.tracker.degraded(error)
      throw error
    }
    this.ownerUserId = optionalString(config, 'ownerUserId')
    this.chatId = optionalString(config, 'chatId')
    this.inboxPush = isInboxPushEnabled(config.settings)
    this.token = token
    this.adapterContext = context
    this.registerCommands(context)
    this.stopped = false
    this.abort = new AbortController()
    this.tracker.connecting('Connecting to Telegram.')
    this.loop = superviseLongConnection({
      label: 'telegram',
      isStopped: () => this.stopped,
      runSession: () => this.runSession(),
      disconnect: () => this.disconnectSession(),
      onFailure: (error) => {
        this.sessionReady = false
        this.tracker.degraded(error)
        console.warn('[connector] Telegram session failed:', formatAdapterError(error))
      },
      delay: (ms) => this.delay(ms),
      reconnectDelayMs: this.reconnectDelayMs,
    }).catch((error) => {
      if (!this.stopped) {
        this.tracker.degraded(error)
        console.warn('[connector] Telegram supervisor stopped:', formatAdapterError(error))
      }
    })
  }

  async stop(): Promise<void> {
    this.stopped = true
    this.abort?.abort()
    await this.disconnectSession()
    await this.loop?.catch(() => undefined)
    this.loop = undefined
    this.tracker.stopped()
  }

  async deliver(notification: InboxNotification): Promise<void> {
    if (!this.bot || !this.sessionReady) throw new Error('Telegram bot is not ready')
    if (!this.chatId) throw new Error('Telegram private chat is not linked')
    this.tracker.attempt()
    try {
      await sendTelegramRichText(
        this.bot.api,
        this.chatId,
        formatInboxNotification(notification),
        formatPlainInboxNotification(notification),
        formatTelegramInboxMarkdownV2(notification),
      )
      this.tracker.success(this.ownerUserId)
    } catch (error) {
      this.tracker.degraded(error)
      throw error
    }
  }

  async deliverArtifact(delivery: ConnectorArtifactDelivery): Promise<void> {
    if (!this.bot || !this.sessionReady) throw new Error('Telegram bot is not ready')
    if (!this.chatId) throw new Error('Telegram private chat is not linked')
    this.tracker.attempt()
    try {
      const file = decodeConnectorAttachment(delivery.attachment)
      await this.bot.api.sendDocument(
        this.chatId,
        new InputFile(file.content, file.filename),
        { caption: truncateTelegramText(`Current file: ${file.filename}`, 200) },
      )
      this.tracker.success(this.ownerUserId)
    } catch (error) {
      this.tracker.degraded(error)
      throw error
    }
  }

  async sendOwnerText(text: string): Promise<void> {
    if (!this.bot || !this.sessionReady) throw new Error('Telegram bot is not ready')
    if (!this.chatId) throw new Error('Telegram private chat is not linked')
    this.tracker.attempt()
    try {
      await sendTelegramRichText(this.bot.api, this.chatId, text)
      this.tracker.success(this.ownerUserId)
    } catch (error) {
      this.tracker.degraded(error)
      throw error
    }
  }

  health(): ConnectorAdapterHealth {
    return this.tracker.get()
  }

  private async runSession(): Promise<void> {
    const token = this.token
    const context = this.adapterContext
    if (!token || !context) throw new Error('Telegram adapter is not armed')
    if (this.tracker.get().status === 'degraded') this.tracker.connecting('Reconnecting to Telegram.')
    const bot = new Bot(token)
    this.bot = bot
    this.sessionReady = false
    this.attachBot(bot, context)

    let ready = false
    let resolveReady!: () => void
    const becameReady = new Promise<void>((resolve) => { resolveReady = resolve })
    const polling = bot.start({
      drop_pending_updates: true,
      onStart: () => {
        ready = true
        resolveReady()
        this.sessionReady = true
        if (this.ownerUserId && this.chatId) this.tracker.healthy(this.ownerUserId)
        else this.tracker.awaitingLink()
        // Menu publish is convenience only. Never put it on the session
        // critical path: a hang or 400 must not delay getUpdates.
        void withTimeout(
          () => publishTelegramCommands(bot),
          this.attemptTimeoutMs,
          `Telegram command menu publish exceeded ${this.attemptTimeoutMs}ms`,
        ).catch((error) => {
          console.warn('[connector] Telegram command menu was not published:', formatAdapterError(error))
        })
        bot.api.config.use(autoRetry())
      },
    })

    let attemptTimer: ReturnType<typeof setTimeout> | undefined
    const attemptExpired = new Promise<never>((_resolve, reject) => {
      attemptTimer = setTimeout(() => {
        reject(new Error(`Telegram polling session did not become ready within ${this.attemptTimeoutMs}ms`))
      }, this.attemptTimeoutMs)
      attemptTimer.unref?.()
    })
    try {
      await Promise.race([
        becameReady,
        polling.then(() => {
          if (!ready) throw new Error('Telegram polling ended before it became ready')
        }),
        attemptExpired,
      ])
    } catch (error) {
      await Promise.resolve(bot.stop()).catch(() => undefined)
      throw error
    } finally {
      if (attemptTimer) clearTimeout(attemptTimer)
    }
    await Promise.race([polling, this.whenAborted()])
  }

  private async disconnectSession(): Promise<void> {
    this.sessionReady = false
    const bot = this.bot
    this.bot = undefined
    await Promise.resolve(bot?.stop()).catch(() => undefined)
  }

  private attachBot(bot: Bot, context: ConnectorAdapterContext): void {
    bot.command('inbox', async (ctx) => {
      if (ctx.chat.type !== 'private' || !ctx.from) return
      await this.presentInbox(ctx, context, { stack: [], scope: 'unread' }).catch(async (error) => {
        this.tracker.degraded(error)
        await ctx.reply('Could not load Inbox. Check OpenAlice logs.').catch(() => undefined)
      })
    })
    bot.command('settings', async (ctx) => {
      if (ctx.chat.type !== 'private' || !ctx.from) return
      await this.presentSettings(ctx, context).catch(async (error) => {
        this.tracker.degraded(error)
        await ctx.reply('Could not open settings. Check OpenAlice logs.').catch(() => undefined)
      })
    })
    bot.on('callback_query:data', async (ctx) => {
      await this.handleControl(ctx, context).catch(async (error) => {
        this.tracker.degraded(error)
        await ctx.answerCallbackQuery({ text: 'That control failed.' }).catch(() => undefined)
      })
    })

    for (const command of TELEGRAM_CONNECTOR_DEFINITION.commands) {
      if (command.name === 'inbox' || command.name === 'settings') continue
      bot.command(command.name, async (ctx) => {
        if (ctx.chat.type !== 'private' || !ctx.from) return
        const handled = await context.commands.execute({
          connectorId: this.id,
          command: command.name,
          userId: String(ctx.from.id),
          chatId: String(ctx.chat.id),
          reply: async (message) => { await ctx.reply(message) },
        }).catch(async (error) => {
          this.tracker.degraded(error)
          await ctx.reply('Connector command failed. Check OpenAlice logs.').catch(() => undefined)
          return true
        })
        if (!handled) await ctx.reply('Unknown connector command.')
      })
    }
    bot.on('message:text', async (ctx) => {
      if (ctx.chat.type !== 'private' || !ctx.from) return
      const text = ctx.message.text.trim()
      if (!text || text.startsWith('/')) return
      if (!this.isOwner(String(ctx.from.id))) return
      try {
        await context.forwardOwnerText({
          text,
          userId: String(ctx.from.id),
          chatId: String(ctx.chat.id),
        })
      } catch (error) {
        this.tracker.degraded(error)
        await ctx.reply('OpenAlice could not accept this message. Check Connector Settings and logs.')
          .catch(() => undefined)
      }
    })
  }

  private whenAborted(): Promise<void> {
    const signal = this.abort?.signal
    if (!signal || signal.aborted) return Promise.resolve()
    return new Promise((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true })
    })
  }

  private async delay(ms: number): Promise<void> {
    const signal = this.abort?.signal
    if (signal?.aborted) return
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms)
      timer.unref?.()
      const onAbort = () => {
        clearTimeout(timer)
        resolve()
      }
      signal?.addEventListener('abort', onAbort, { once: true })
    })
  }

  private registerCommands(context: ConnectorAdapterContext): void {
    context.commands.register('link', async ({ userId, chatId, reply }) => {
      if (this.ownerUserId && this.ownerUserId !== userId) {
        await reply('This connector is already linked to another account.')
        return
      }
      if (!chatId) throw new Error('Telegram private chat ID is missing')
      this.ownerUserId = userId
      this.chatId = chatId
      await context.updateSettings({ ownerUserId: userId, chatId })
      this.tracker.healthy(userId)
      await reply('Telegram is linked to this OpenAlice installation.')
    })
    context.commands.register('status', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply(`OpenAlice Connector Service: ${context.getServiceStatus()}. Telegram: ${this.health().status}.`)
    })
    context.commands.register('test', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      const probeId = await context.sendTest(this.id)
      await reply(`Test notification sent. Probe: ${probeId}`)
    })
  }

  private async presentInbox(
    ctx: Context,
    _context: ConnectorAdapterContext,
    session: TelegramInboxSession,
    mode: 'reply' | 'edit' = 'reply',
  ): Promise<void> {
    if (!this.isOwner(String(ctx.from?.id ?? ''))) {
      if (mode === 'edit') await ctx.answerCallbackQuery({ text: 'Only the linked owner can use this.' })
      else await ctx.reply('This command is only available to the linked owner.')
      return
    }
    const scope = session.scope ?? 'unread'
    const page = await this.resolveInboxStore().read({
      ...(scope === 'unread' ? { unread: true } : {}),
      limit: TELEGRAM_INBOX_PAGE_SIZE,
      ...(session.before ? { before: session.before } : {}),
    })
    const nextSession: TelegramInboxSession = {
      stack: session.stack,
      scope,
      ...(session.before ? { before: session.before } : {}),
      entryIds: page.entries.map((entry) => entry.id),
    }
    const form = formatTelegramInboxPage({
      entries: page.entries,
      hasMore: page.hasMore,
      canGoNewer: session.stack.length > 0,
      scope,
    })
    const sent = await this.presentForm(ctx, form, mode)
    if (sent && ctx.chat) this.inboxSessions.set(sessionKey(ctx.chat.id, sent), nextSession)
  }

  private async presentSettings(ctx: Context, _context: ConnectorAdapterContext, mode: 'reply' | 'edit' = 'reply'): Promise<void> {
    if (!this.isOwner(String(ctx.from?.id ?? ''))) {
      if (mode === 'edit') await ctx.answerCallbackQuery({ text: 'Only the linked owner can use this.' })
      else await ctx.reply('This command is only available to the linked owner.')
      return
    }
    await this.presentForm(ctx, formatTelegramSettingsPage(this.inboxPush), mode)
  }

  private async handleControl(ctx: Context, context: ConnectorAdapterContext): Promise<void> {
    const data = ctx.callbackQuery?.data
    if (!data) return
    const control = parseTelegramControl(data)
    if (!control) {
      await ctx.answerCallbackQuery()
      return
    }
    const messageId = ctx.callbackQuery?.message?.message_id
    const key = ctx.chat && messageId ? sessionKey(ctx.chat.id, messageId) : undefined
    const current = key ? this.inboxSessions.get(key) : undefined
    const resolution = await transitionTelegramInbox(current, control, {
      isOwner: this.isOwner(String(ctx.from?.id ?? '')),
      getEntry: (id) => this.resolveInboxStore().get(id),
    })
    if (resolution.kind === 'forbidden') {
      await ctx.answerCallbackQuery({ text: 'Only the linked owner can use this.' })
      return
    }
    await ctx.answerCallbackQuery()
    if (resolution.kind === 'ignored') return
    if (resolution.kind === 'settings') {
      this.inboxPush = resolution.inboxPush
      await context.updateSettings({ inboxPush: resolution.inboxPush })
      await this.presentSettings(ctx, context, 'edit')
      return
    }
    if (resolution.kind === 'expired') {
      await ctx.editMessageText('This Inbox page expired. Send /inbox again.')
      return
    }
    if (resolution.kind === 'error') {
      await ctx.editMessageText(resolution.text)
      return
    }
    if (resolution.kind === 'page') {
      const scope = resolution.session.scope ?? 'unread'
      const page = await this.resolveInboxStore().read({
        ...(scope === 'unread' ? { unread: true } : {}),
        limit: TELEGRAM_INBOX_PAGE_SIZE,
        ...(resolution.session.before ? { before: resolution.session.before } : {}),
      })
      const next = advanceInboxSession(resolution.session, resolution.direction, page.entries.at(-1)?.id)
      await this.presentInbox(ctx, context, next, 'edit')
      return
    }
    if (resolution.kind === 'reload-inbox') {
      await this.presentInbox(ctx, context, resolution.session, 'edit')
      return
    }
    if (resolution.kind === 'request-artifact') {
      try {
        context.enqueueArtifactRequest({
          entryId: resolution.entryId,
          docIndex: resolution.docIndex,
        })
      } catch (error) {
        await ctx.editMessageText(
          error instanceof Error ? error.message : 'Could not request that file. Try again.',
        )
        return
      }
      const sent = await this.presentForm(ctx, resolution.form, 'edit')
      if (sent && ctx.chat) this.inboxSessions.set(sessionKey(ctx.chat.id, sent), resolution.session)
      return
    }
    const sent = await this.presentForm(ctx, resolution.form, 'edit')
    if (sent && ctx.chat) this.inboxSessions.set(sessionKey(ctx.chat.id, sent), resolution.session)
  }

  private async presentForm(
    ctx: Context,
    form: { text: string; actions: Array<Array<{ text: string; data: string }>> },
    mode: 'reply' | 'edit',
  ): Promise<number | undefined> {
    const markup = toInlineKeyboard(form.actions)
    if (mode === 'edit') {
      await ctx.editMessageText(form.text, markup ? { reply_markup: markup } : {})
      return ctx.callbackQuery?.message?.message_id
    }
    const sent = await ctx.reply(form.text, markup ? { reply_markup: markup } : {})
    return sent.message_id
  }

  private resolveInboxStore(): IInboxStore {
    return this.inboxStore ??= createInboxStore()
  }

  private isOwner(userId: string): boolean {
    return Boolean(this.ownerUserId && this.ownerUserId === userId)
  }
}

export function telegramConnectorRegistration(): ConnectorAdapterRegistration {
  return { definition: TELEGRAM_CONNECTOR_DEFINITION, create: () => new TelegramConnectorAdapter() }
}

async function publishTelegramCommands(bot: Bot): Promise<void> {
  await bot.api.setMyCommands(TELEGRAM_CONNECTOR_DEFINITION.commands.map(({ name, description }) => ({
    command: name,
    description,
  })))
}

export async function withTimeout<T>(operation: () => Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs)
        timer.unref?.()
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function toInlineKeyboard(
  actions: Array<Array<{ text: string; data: string }>>,
): InlineKeyboard | undefined {
  if (actions.length === 0) return undefined
  const keyboard = new InlineKeyboard()
  for (const [index, row] of actions.entries()) {
    if (index > 0) keyboard.row()
    for (const button of row) keyboard.text(button.text, button.data)
  }
  return keyboard
}

function sessionKey(chatId: number, messageId: number): string {
  return `${chatId}:${messageId}`
}

function requiredString(config: ConnectorAdapterConfig, key: string): string {
  const value = config.settings[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Telegram setting ${key} is required`)
  return value.trim()
}

function optionalString(config: ConnectorAdapterConfig, key: string): string | undefined {
  const value = config.settings[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
