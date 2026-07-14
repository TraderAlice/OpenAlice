import type { Client } from 'discord.js'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  InboxNotification,
} from '@traderalice/connector-protocol'
import { DISCORD_CONNECTOR_DEFINITION } from '@traderalice/connector-protocol'
import type {
  ConnectorAdapter,
  ConnectorAdapterContext,
  ConnectorAdapterRegistration,
} from '../core/adapter.js'
import {
  AdapterHealthTracker,
  decodeInboxAttachments,
  formatInboxNotification,
} from './shared.js'

export class DiscordConnectorAdapter implements ConnectorAdapter {
  readonly id = 'discord'
  private readonly tracker = new AdapterHealthTracker(this.id)
  private client?: Client
  private ownerUserId?: string

  async start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void> {
    const discord = await import('discord.js')
    const {
      Client,
      Events,
      GatewayIntentBits,
      Partials,
    } = discord
    const applicationId = requiredString(config, 'applicationId')
    const botToken = requiredString(config, 'botToken')
    this.ownerUserId = optionalString(config, 'ownerUserId')

    this.registerCommands(context)
    await this.publishSlashCommands(applicationId, botToken, discord)

    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
      partials: [Partials.Channel],
    })
    this.client = client
    client.on(Events.InteractionCreate, async (interaction) => {
      if (!interaction.isChatInputCommand()) return
      const handled = await context.commands.execute({
        connectorId: this.id,
        command: interaction.commandName,
        userId: interaction.user.id,
        chatId: interaction.channelId,
        reply: async (message) => {
          await interaction.reply({ content: message, ephemeral: false })
        },
      }).catch(async (error) => {
        this.tracker.degraded(error)
        if (!interaction.replied) await interaction.reply('Connector command failed. Check OpenAlice logs.').catch(() => undefined)
        return true
      })
      if (!handled && !interaction.replied) await interaction.reply('Unknown connector command.').catch(() => undefined)
    })
    client.on(Events.Error, (error) => this.tracker.degraded(error))

    const ready = new Promise<void>((resolveReady) => {
      client.once(Events.ClientReady, () => resolveReady())
    })
    await client.login(botToken)
    await Promise.race([
      ready,
      new Promise<never>((_resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Discord gateway did not become ready within 15 seconds')), 15_000)
        timer.unref?.()
      }),
    ])
    if (this.ownerUserId) this.tracker.healthy(this.ownerUserId)
    else this.tracker.awaitingLink()
  }

  async stop(): Promise<void> {
    this.client?.destroy()
    this.client = undefined
    this.tracker.stopped()
  }

  async deliver(notification: InboxNotification): Promise<void> {
    if (!this.client?.isReady()) throw new Error('Discord client is not ready')
    if (!this.ownerUserId) throw new Error('Discord owner is not linked')
    this.tracker.attempt()
    try {
      const user = await this.client.users.fetch(this.ownerUserId)
      const attachments = decodeInboxAttachments(notification)
      await user.send({
        content: formatInboxNotification(notification),
        ...(attachments.length > 0 ? {
          files: attachments.map((attachment) => ({
            attachment: attachment.content,
            name: attachment.filename,
          })),
        } : {}),
      })
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
    context.commands.register('link', async ({ userId, reply }) => {
      if (this.ownerUserId && this.ownerUserId !== userId) {
        await reply('This connector is already linked to another account.')
        return
      }
      this.ownerUserId = userId
      await context.updateSettings({ ownerUserId: userId })
      this.tracker.healthy(userId)
      await reply('Discord is linked to this OpenAlice installation.')
    })
    context.commands.register('status', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply(`OpenAlice Connector Service: ${context.getServiceStatus()}. Discord: ${this.health().status}.`)
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

  private async publishSlashCommands(
    applicationId: string,
    token: string,
    discord: typeof import('discord.js'),
  ): Promise<void> {
    const {
      ApplicationIntegrationType,
      InteractionContextType,
      REST,
      Routes,
      SlashCommandBuilder,
    } = discord
    const body = DISCORD_CONNECTOR_DEFINITION.commands.map(({ name, description }) => ({
      ...new SlashCommandBuilder().setName(name).setDescription(description).toJSON(),
      integration_types: [ApplicationIntegrationType.UserInstall],
      contexts: [InteractionContextType.BotDM],
    }))
    await new REST({ version: '10' }).setToken(token).put(Routes.applicationCommands(applicationId), { body })
  }
}

export function discordConnectorRegistration(): ConnectorAdapterRegistration {
  return { definition: DISCORD_CONNECTOR_DEFINITION, create: () => new DiscordConnectorAdapter() }
}

function requiredString(config: ConnectorAdapterConfig, key: string): string {
  const value = config.settings[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Discord setting ${key} is required`)
  return value.trim()
}

function optionalString(config: ConnectorAdapterConfig, key: string): string | undefined {
  const value = config.settings[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
