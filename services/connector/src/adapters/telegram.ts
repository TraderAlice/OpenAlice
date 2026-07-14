import { Bot, InputFile } from 'grammy'
import { autoRetry } from '@grammyjs/auto-retry'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  InboxNotification,
} from '@traderalice/connector-protocol'
import { TELEGRAM_CONNECTOR_DEFINITION } from '@traderalice/connector-protocol'
import type {
  ConnectorAdapter,
  ConnectorAdapterContext,
  ConnectorAdapterRegistration,
} from '../core/adapter.js'
import {
  AdapterHealthTracker,
  decodeInboxAttachments,
  formatPlainInboxNotification,
} from './shared.js'

export class TelegramConnectorAdapter implements ConnectorAdapter {
  readonly id = 'telegram'
  private readonly tracker = new AdapterHealthTracker(this.id)
  private bot?: Bot
  private ownerUserId?: string
  private chatId?: string

  async start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void> {
    const token = requiredString(config, 'botToken')
    this.ownerUserId = optionalString(config, 'ownerUserId')
    this.chatId = optionalString(config, 'chatId')
    const bot = new Bot(token)
    bot.api.config.use(autoRetry())
    this.bot = bot

    for (const command of TELEGRAM_CONNECTOR_DEFINITION.commands) {
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
    await bot.api.setMyCommands(TELEGRAM_CONNECTOR_DEFINITION.commands.map(({ name, description }) => ({
      command: name,
      description,
    })))
    await bot.init()
    if (this.ownerUserId && this.chatId) this.tracker.healthy(this.ownerUserId)
    else this.tracker.awaitingLink()
    void bot.start({ drop_pending_updates: true }).catch((error) => {
      this.tracker.degraded(error)
      console.warn('[connector] Telegram polling stopped:', error instanceof Error ? error.message : error)
    })
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
      await this.bot.api.sendMessage(this.chatId, formatPlainInboxNotification(notification))
      for (const attachment of decodeInboxAttachments(notification)) {
        await this.bot.api.sendDocument(
          this.chatId,
          new InputFile(attachment.content, attachment.filename),
        )
      }
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

  private isOwner(userId: string): boolean {
    return Boolean(this.ownerUserId && this.ownerUserId === userId)
  }
}

export function telegramConnectorRegistration(): ConnectorAdapterRegistration {
  return { definition: TELEGRAM_CONNECTOR_DEFINITION, create: () => new TelegramConnectorAdapter() }
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
