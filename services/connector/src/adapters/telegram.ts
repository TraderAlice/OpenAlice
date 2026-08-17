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
  decodeConnectorAttachment,
  formatInboxNotification,
  formatPlainInboxNotification,
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
  private readonly startupTimeoutMs: number
  private bot?: Bot
  private ownerUserId?: string
  private chatId?: string
  private inboxPush = true
  private inboxStore?: IInboxStore
  private readonly inboxSessions = new Map<string, TelegramInboxSession>()

  constructor(options: { startupTimeoutMs?: number; inboxStore?: IInboxStore } = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15_000
    this.inboxStore = options.inboxStore
  }

  async start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void> {
    try {
      const token = requiredString(config, 'botToken')
      this.ownerUserId = optionalString(config, 'ownerUserId')
      this.chatId = optionalString(config, 'chatId')
      this.inboxPush = isInboxPushEnabled(config.settings)
      const bot = new Bot(token)
      this.bot = bot

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
      this.registerCommands(context)
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
      // The slash-command menu is convenience. A 404/transformer failure here
      // must not block long polling, owner chat, or Inbox delivery — users can
      // still type the commands directly.
      await publishTelegramCommands(bot).catch((error) => {
        console.warn('[connector] Telegram command menu was not published:', error instanceof Error ? error.message : error)
      })
      await withTimeout(
        () => waitForTelegramPolling(bot, (error) => this.tracker.degraded(error)),
        this.startupTimeoutMs,
        `Telegram polling did not become ready within ${this.startupTimeoutMs}ms`,
      )
      // Keep the optional startup menu call untransformed; install retries only
      // after polling is live for subsequent Telegram API traffic.
      bot.api.config.use(autoRetry())
      if (this.ownerUserId && this.chatId) this.tracker.healthy(this.ownerUserId)
      else this.tracker.awaitingLink()
    } catch (error) {
      this.tracker.degraded(error)
      await this.bot?.stop().catch(() => undefined)
      this.bot = undefined
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.bot?.stop().catch(() => undefined)
    this.bot = undefined
    this.tracker.stopped()
  }

  async deliver(notification: InboxNotification): Promise<void> {
    if (!this.bot) throw new Error('Telegram bot is not ready')
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
    if (!this.bot) throw new Error('Telegram bot is not ready')
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
    if (!this.bot) throw new Error('Telegram bot is not ready')
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

function waitForTelegramPolling(bot: Bot, onFailure: (error: unknown) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let ready = false
    void bot.start({
      drop_pending_updates: true,
      onStart: () => {
        ready = true
        resolve()
      },
    }).catch((error) => {
      console.warn('[connector] Telegram polling stopped:', error instanceof Error ? error.message : error)
      onFailure(error)
      if (!ready) reject(error)
    })
  })
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
