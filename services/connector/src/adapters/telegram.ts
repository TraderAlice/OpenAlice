import { createHash } from 'node:crypto'
import { Bot, InlineKeyboard, InputFile, type Context } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  ConnectorArtifactDelivery,
  ConnectorUtaFailure,
  ConnectorUtaPresentation,
  InboxNotification,
  OwnerChatMessage,
} from '@traderalice/connector-protocol'
import { isInboxPushEnabled, TELEGRAM_CONNECTOR_DEFINITION } from '@traderalice/connector-protocol'
import { createInboxStore, type IInboxStore } from '@/core/inbox-store.js'
import type {
  ConnectorAdapter,
  ConnectorAdapterContext,
  ConnectorAdapterRegistration,
} from '../core/adapter.js'
import {
  DIRECT_CONNECTOR_PROXY_TRANSPORT,
  type ConnectorProxyTransport,
} from '../core/proxy.js'
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
import {
  formatTelegramUtaListPage,
  formatTelegramUtaLoadingPage,
  parseTelegramUtaControl,
  transitionTelegramUta,
  type TelegramUtaControl,
  type TelegramUtaSession,
} from './telegram-uta.js'
import { sendTelegramRichText } from './telegram-rich-text.js'

const TELEGRAM_DRAFT_HEARTBEAT_MS = 20_000
const TELEGRAM_TYPING_HEARTBEAT_MS = 4_000
const TELEGRAM_RESUME_CHECK_INTERVAL_MS = 15_000
const TELEGRAM_RESUME_GAP_MS = 45_000
const MAX_FINISHED_DRAFTS = 128

interface TelegramDraftSession {
  draftId: number
  markdown?: string
  typingFallback: boolean
  stopped: boolean
  pending: Promise<void>
  timer?: ReturnType<typeof setTimeout>
}

export class TelegramConnectorAdapter implements ConnectorAdapter {
  readonly id = 'telegram'
  private readonly tracker = new AdapterHealthTracker(this.id)
  private readonly attemptTimeoutMs: number
  private readonly reconnectDelayMs: number
  private readonly resumeCheckIntervalMs: number
  private readonly resumeGapMs: number
  private bot?: Bot
  private sessionReady = false
  private ownerUserId?: string
  private chatId?: string
  private inboxPush = true
  private inboxStore?: IInboxStore
  private readonly inboxSessions = new Map<string, TelegramInboxSession>()
  private readonly utaSessions = new Map<string, TelegramUtaSession>()
  private readonly utaPending = new Map<string, { chatId: number; messageId: number; session: TelegramUtaSession }>()
  private readonly drafts = new Map<string, TelegramDraftSession>()
  private readonly finishedDrafts = new Set<string>()
  private stopped = true
  private loop?: Promise<void>
  private abort?: AbortController
  private token?: string
  private adapterContext?: ConnectorAdapterContext
  private readonly proxy: ConnectorProxyTransport

  constructor(options: {
    attemptTimeoutMs?: number
    reconnectDelayMs?: number
    resumeCheckIntervalMs?: number
    resumeGapMs?: number
    startupTimeoutMs?: number
    inboxStore?: IInboxStore
    proxy?: ConnectorProxyTransport
  } = {}) {
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? options.startupTimeoutMs ?? DEFAULT_CONNECTION_ATTEMPT_TIMEOUT_MS
    this.reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_CONNECTION_RETRY_DELAY_MS
    this.resumeCheckIntervalMs = options.resumeCheckIntervalMs ?? TELEGRAM_RESUME_CHECK_INTERVAL_MS
    this.resumeGapMs = options.resumeGapMs ?? TELEGRAM_RESUME_GAP_MS
    this.inboxStore = options.inboxStore
    this.proxy = options.proxy ?? DIRECT_CONNECTOR_PROXY_TRANSPORT
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
      isSessionHealthy: () => {
        const status = this.tracker.get().status
        return status === 'healthy' || status === 'awaiting_link'
      },
      runSession: () => this.runSession(),
      disconnect: () => this.disconnectSession(),
      onFailure: (error) => {
        this.sessionReady = false
        this.tracker.degraded(error)
        console.warn('[connector] Telegram session failed:', formatAdapterError(error))
      },
      onAttempt: () => this.tracker.attempt(),
      onRetryScheduled: (delayMs, failures) => this.tracker.retryScheduled(delayMs, failures),
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
    this.stopAllDrafts()
    this.finishedDrafts.clear()
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

  async sendOwnerChat(message: OwnerChatMessage): Promise<void> {
    if (message.phase === 'accepted' || message.phase === 'progress') {
      this.tracker.attempt()
      try {
        if (message.phase === 'accepted') {
          await this.startDraft(message.conversationId)
        } else if (message.text) {
          await this.updateDraft(message.conversationId, message.text)
        }
        this.tracker.success(this.ownerUserId)
        return
      } catch (error) {
        this.tracker.degraded(error)
        throw error
      }
    }

    await this.finishDraft(message.conversationId)
    if (message.text) await this.sendOwnerText(message.text)
  }

  health(): ConnectorAdapterHealth {
    return this.tracker.get()
  }

  async presentUta(presentation: ConnectorUtaPresentation): Promise<void> {
    const pending = this.utaPending.get(presentation.requestId)
    const form = formatTelegramUtaListPage(presentation.review, presentation.result)
    const session: TelegramUtaSession = {
      accountIds: presentation.review.accounts.map((account) => account.id),
      review: presentation.review,
      result: presentation.result,
      view: { kind: 'list' },
    }
    if (!pending) {
      if (!this.chatId) throw new Error('Telegram private chat is not linked')
      await this.sendOwnerText(form.text)
      return
    }
    this.utaPending.delete(presentation.requestId)
    const sent = await this.editForm(pending.chatId, pending.messageId, form)
    if (sent) this.utaSessions.set(sessionKey(pending.chatId, sent), session)
  }

  async failUta(failure: ConnectorUtaFailure): Promise<void> {
    const pending = this.utaPending.get(failure.requestId)
    if (!pending) {
      await this.sendOwnerText(failure.message)
      return
    }
    this.utaPending.delete(failure.requestId)
    await this.editForm(pending.chatId, pending.messageId, {
      text: failure.message,
      actions: [],
    })
  }

  private async runSession(): Promise<void> {
    const token = this.token
    const context = this.adapterContext
    if (!token || !context) throw new Error('Telegram adapter is not armed')
    if (this.tracker.get().status === 'degraded') this.tracker.connecting('Reconnecting to Telegram.')
    const bot = new Bot(token, {
      client: this.proxy.nodeFetchAgent
        ? { baseFetchConfig: { agent: this.proxy.nodeFetchAgent } }
        : undefined,
    })
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
    await this.awaitPollingOrAbort(polling)
  }

  private async disconnectSession(): Promise<void> {
    this.sessionReady = false
    this.stopAllDrafts()
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
    bot.command('uta', async (ctx) => {
      if (ctx.chat.type !== 'private' || !ctx.from) return
      await this.presentUtaCommand(ctx, context).catch(async (error) => {
        this.tracker.degraded(error)
        await ctx.reply('Could not open UTA. Check OpenAlice logs.').catch(() => undefined)
      })
    })
    bot.on('callback_query:data', async (ctx) => {
      await this.handleControl(ctx, context).catch(async (error) => {
        this.tracker.degraded(error)
        await ctx.answerCallbackQuery({ text: 'That control failed.' }).catch(() => undefined)
      })
    })

    for (const command of TELEGRAM_CONNECTOR_DEFINITION.commands) {
      if (command.name === 'inbox' || command.name === 'settings' || command.name === 'uta') continue
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
          eventId: String(ctx.message.message_id),
        })
      } catch (error) {
        this.tracker.degraded(error)
        await ctx.reply('OpenAlice could not accept this message. Check Connector Settings and logs.')
          .catch(() => undefined)
      }
    })
  }

  private async awaitPollingOrAbort(polling: Promise<void>): Promise<void> {
    const signal = this.abort?.signal
    if (!signal || signal.aborted) return
    let onAbort: (() => void) | undefined
    const aborted = new Promise<void>((resolve) => {
      onAbort = resolve
      signal.addEventListener('abort', onAbort, { once: true })
    })
    const sessionAbort = new AbortController()
    const resumed = waitForResumeGap({
      signal: sessionAbort.signal,
      intervalMs: this.resumeCheckIntervalMs,
      gapMs: this.resumeGapMs,
    }).then((detected) => {
      if (detected) throw new Error('Host resumed after sleep; reconnecting Telegram polling')
    })
    try {
      await Promise.race([polling, aborted, resumed])
    } finally {
      sessionAbort.abort()
      if (onAbort) signal.removeEventListener('abort', onAbort)
    }
  }

  private async delay(ms: number): Promise<void> {
    const signal = this.abort?.signal
    if (signal?.aborted) return
    await new Promise<void>((resolve) => {
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', finish)
        resolve()
      }
      const timer = setTimeout(finish, ms)
      timer.unref?.()
      signal?.addEventListener('abort', finish, { once: true })
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

  private async presentUtaCommand(ctx: Context, context: ConnectorAdapterContext): Promise<void> {
    if (!this.isOwner(String(ctx.from?.id ?? ''))) {
      await ctx.reply('This command is only available to the linked owner.')
      return
    }
    const session: TelegramUtaSession = {
      accountIds: [],
      view: { kind: 'loading', reason: 'Asking OpenAlice for the current UTA review…' },
    }
    const form = formatTelegramUtaLoadingPage()
    const sent = await this.presentForm(ctx, form, 'reply')
    if (!sent || !ctx.chat) return
    try {
      const requestId = await context.enqueueUtaRequest({ action: 'review' })
      session.requestId = requestId
      this.utaSessions.set(sessionKey(ctx.chat.id, sent), session)
      this.utaPending.set(requestId, { chatId: ctx.chat.id, messageId: sent, session })
    } catch (error) {
      await this.editForm(ctx.chat.id, sent, {
        text: error instanceof Error ? error.message : 'Could not request the UTA review. Try again.',
        actions: [],
      })
    }
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
    const utaControl = parseTelegramUtaControl(data)
    if (utaControl) {
      await this.handleUtaControl(ctx, context, utaControl)
      return
    }
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
        await context.enqueueArtifactRequest({
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

  private async handleUtaControl(
    ctx: Context,
    context: ConnectorAdapterContext,
    control: TelegramUtaControl,
  ): Promise<void> {
    const messageId = ctx.callbackQuery?.message?.message_id
    const key = ctx.chat && messageId ? sessionKey(ctx.chat.id, messageId) : undefined
    const current = key ? this.utaSessions.get(key) : undefined
    const resolution = transitionTelegramUta(current, control, {
      isOwner: this.isOwner(String(ctx.from?.id ?? '')),
    })
    if (resolution.kind === 'forbidden') {
      await ctx.answerCallbackQuery({ text: 'Only the linked owner can use this.' })
      return
    }
    await ctx.answerCallbackQuery()
    if (resolution.kind === 'ignored') return
    if (resolution.kind === 'expired') {
      await ctx.editMessageText('This UTA page expired. Send /uta again.')
      return
    }
    if (resolution.kind === 'enqueue') {
      try {
        const requestId = await context.enqueueUtaRequest({
          action: resolution.action,
          ...(resolution.utaId ? { utaId: resolution.utaId } : {}),
          ...(resolution.pendingHash ? { pendingHash: resolution.pendingHash } : {}),
        })
        const next = { ...resolution.session, requestId }
        const sent = await this.presentForm(ctx, resolution.form, 'edit')
        if (sent && ctx.chat) {
          this.utaSessions.set(sessionKey(ctx.chat.id, sent), next)
          this.utaPending.set(requestId, { chatId: ctx.chat.id, messageId: sent, session: next })
        }
      } catch (error) {
        await ctx.editMessageText(
          error instanceof Error ? error.message : 'Could not send that UTA request. Try again.',
        )
      }
      return
    }
    const sent = await this.presentForm(ctx, resolution.form, 'edit')
    if (sent && ctx.chat) this.utaSessions.set(sessionKey(ctx.chat.id, sent), resolution.session)
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

  private async editForm(
    chatId: number,
    messageId: number,
    form: { text: string; actions: Array<Array<{ text: string; data: string }>> },
  ): Promise<number | undefined> {
    if (!this.bot) throw new Error('Telegram bot is not ready')
    const markup = toInlineKeyboard(form.actions)
    await this.bot.api.editMessageText(chatId, messageId, form.text, markup ? { reply_markup: markup } : {})
    return messageId
  }

  private resolveInboxStore(): IInboxStore {
    return this.inboxStore ??= createInboxStore()
  }

  private isOwner(userId: string): boolean {
    return Boolean(this.ownerUserId && this.ownerUserId === userId)
  }

  private async startDraft(conversationId: string): Promise<void> {
    if (this.finishedDrafts.has(conversationId)) return
    this.stopDraft(conversationId)
    const session: TelegramDraftSession = {
      draftId: telegramDraftId(conversationId),
      typingFallback: false,
      stopped: false,
      pending: Promise.resolve(),
    }
    this.drafts.set(conversationId, session)
    try {
      await this.queueDraftRefresh(conversationId, session)
    } finally {
      this.armDraftHeartbeat(conversationId, session)
    }
  }

  private async updateDraft(conversationId: string, markdown: string): Promise<void> {
    if (this.finishedDrafts.has(conversationId)) return
    let session = this.drafts.get(conversationId)
    if (!session) {
      session = {
        draftId: telegramDraftId(conversationId),
        typingFallback: false,
        stopped: false,
        pending: Promise.resolve(),
      }
      this.drafts.set(conversationId, session)
    }
    session.markdown = markdown
    try {
      await this.queueDraftRefresh(conversationId, session)
    } finally {
      this.armDraftHeartbeat(conversationId, session)
    }
  }

  private queueDraftRefresh(conversationId: string, session: TelegramDraftSession): Promise<void> {
    const next = session.pending.catch(() => undefined).then(async () => {
      if (session.stopped || this.drafts.get(conversationId) !== session) return
      await this.refreshDraft(session)
    })
    session.pending = next
    return next
  }

  private async refreshDraft(session: TelegramDraftSession): Promise<void> {
    if (!this.bot || !this.sessionReady) throw new Error('Telegram bot is not ready')
    const chatId = telegramNumericChatId(this.chatId)
    if (session.typingFallback) {
      await this.bot.api.sendChatAction(chatId, 'typing')
      return
    }
    try {
      if (session.markdown) {
        await this.bot.api.sendRichMessageDraft(chatId, session.draftId, { markdown: session.markdown })
      } else {
        await this.bot.api.sendMessageDraft(chatId, session.draftId, '')
      }
      return
    } catch (error) {
      if (session.markdown) {
        try {
          await this.bot.api.sendMessageDraft(
            chatId,
            session.draftId,
            truncateTelegramText(session.markdown, 4096),
          )
          return
        } catch {
          // Fall through to the universally supported activity indicator.
        }
      }
      console.warn('[connector] Telegram live draft fell back to typing:', formatAdapterError(error))
      session.typingFallback = true
      await this.bot.api.sendChatAction(chatId, 'typing')
    }
  }

  private async finishDraft(conversationId: string): Promise<void> {
    const session = this.drafts.get(conversationId)
    if (session) {
      this.stopDraft(conversationId)
      await session.pending.catch(() => undefined)
    }
    this.markDraftFinished(conversationId)
  }

  private stopDraft(conversationId: string): void {
    const session = this.drafts.get(conversationId)
    if (!session) return
    session.stopped = true
    if (session.timer) clearTimeout(session.timer)
    this.drafts.delete(conversationId)
  }

  private stopAllDrafts(): void {
    for (const conversationId of [...this.drafts.keys()]) this.stopDraft(conversationId)
  }

  private armDraftHeartbeat(conversationId: string, session: TelegramDraftSession): void {
    if (session.stopped || this.drafts.get(conversationId) !== session) return
    if (session.timer) clearTimeout(session.timer)
    const delay = session.typingFallback ? TELEGRAM_TYPING_HEARTBEAT_MS : TELEGRAM_DRAFT_HEARTBEAT_MS
    session.timer = setTimeout(() => {
      void this.queueDraftRefresh(conversationId, session).catch((error) => {
        this.tracker.degraded(error)
        console.warn('[connector] Telegram owner-chat activity refresh failed:', formatAdapterError(error))
      }).finally(() => this.armDraftHeartbeat(conversationId, session))
    }, delay)
    session.timer.unref?.()
  }

  private markDraftFinished(conversationId: string): void {
    if (this.finishedDrafts.size >= MAX_FINISHED_DRAFTS) {
      const oldest = this.finishedDrafts.values().next().value
      if (oldest !== undefined) this.finishedDrafts.delete(oldest)
    }
    this.finishedDrafts.add(conversationId)
  }
}

async function waitForResumeGap(options: {
  signal: AbortSignal
  intervalMs: number
  gapMs: number
  now?: () => number
}): Promise<boolean> {
  const now = options.now ?? Date.now
  let expectedAt = now() + options.intervalMs
  while (!options.signal.aborted) {
    await abortableDelay(options.intervalMs, options.signal)
    if (options.signal.aborted) return false
    const current = now()
    if (current - expectedAt >= options.gapMs) return true
    expectedAt = current + options.intervalMs
  }
  return false
}

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    const timer = setTimeout(finish, ms)
    timer.unref?.()
    signal.addEventListener('abort', finish, { once: true })
  })
}

export function telegramDraftId(conversationId: string): number {
  const value = createHash('sha256').update(conversationId).digest().readUInt32BE(0) & 0x7fff_ffff
  return value || 1
}

function telegramNumericChatId(chatId: string | undefined): number {
  if (!chatId) throw new Error('Telegram private chat is not linked')
  const numeric = Number(chatId)
  if (!Number.isSafeInteger(numeric)) throw new Error('Telegram private chat id is invalid')
  return numeric
}

export function telegramConnectorRegistration(
  proxy: ConnectorProxyTransport = DIRECT_CONNECTOR_PROXY_TRANSPORT,
): ConnectorAdapterRegistration {
  return { definition: TELEGRAM_CONNECTOR_DEFINITION, create: () => new TelegramConnectorAdapter({ proxy }) }
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
