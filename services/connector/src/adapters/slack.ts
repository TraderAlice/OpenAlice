import type { SocketModeClient } from '@slack/socket-mode'
import type { WebClient } from '@slack/web-api'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  InboxNotification,
} from '@traderalice/connector-protocol'
import { SLACK_CONNECTOR_DEFINITION } from '@traderalice/connector-protocol'
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
  classifyNetworkStartFailure,
  decodeInboxAttachments,
  formatInboxNotification,
} from './shared.js'

export class SlackConnectorAdapter implements ConnectorAdapter {
  readonly id = 'slack'
  private readonly tracker = new AdapterHealthTracker(this.id)
  private readonly startupTimeoutMs: number
  private web?: WebClient
  private socket?: SocketModeClient
  private ownerUserId?: string
  private readonly proxy: ConnectorProxyTransport

  classifyStartFailure = classifyNetworkStartFailure

  constructor(options: { startupTimeoutMs?: number; proxy?: ConnectorProxyTransport } = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15_000
    this.proxy = options.proxy ?? DIRECT_CONNECTOR_PROXY_TRANSPORT
  }

  async start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void> {
    try {
      const [{ WebClient }, { SocketModeClient }] = await Promise.all([
        import('@slack/web-api'),
        import('@slack/socket-mode'),
      ])
      const botToken = requiredString(config, 'botToken')
      const appToken = requiredString(config, 'appToken')
      this.ownerUserId = optionalString(config, 'ownerUserId')

      this.registerCommands(context)
      const web = new WebClient(botToken)
      const socket = new SocketModeClient({
        appToken,
        ...(this.proxy.dispatcher ? { dispatcher: this.proxy.dispatcher } : {}),
      })
      this.web = web
      this.socket = socket

      socket.on('slash_commands', async ({ ack, body }: SlackSlashCommandEvent) => {
        try {
          await ack()
        } catch {
          this.tracker.degraded(new Error('Slack slash command ack failed'))
          return
        }
        const channelId = body.channel_id
        if (!channelId) return
        if (!isSlackDirectMessage(channelId)) {
          await this.replyInChannel(channelId, 'Run this command in a direct message with the OpenAlice app.')
            .catch(() => undefined)
          return
        }
        const handled = await context.commands.execute({
          connectorId: this.id,
          command: slackCommandName(body.command),
          userId: String(body.user_id ?? ''),
          chatId: channelId,
          reply: async (message) => { await this.replyInChannel(channelId, message) },
        }).catch(async (error) => {
          this.tracker.degraded(error)
          await this.replyInChannel(channelId, 'Connector command failed. Check OpenAlice logs.')
            .catch(() => undefined)
          return true
        })
        if (!handled) {
          await this.replyInChannel(channelId, 'Unknown connector command.').catch(() => undefined)
        }
      })
      socket.on('error', (error: unknown) => this.tracker.degraded(error))

      await withTimeout(
        () => socket.start(),
        this.startupTimeoutMs,
        `Slack Socket Mode did not become ready within ${this.startupTimeoutMs}ms`,
      )
      if (this.ownerUserId) this.tracker.healthy(this.ownerUserId)
      else this.tracker.awaitingLink()
    } catch (error) {
      this.tracker.degraded(error)
      await this.socket?.disconnect().catch(() => undefined)
      this.socket = undefined
      this.web = undefined
      throw error
    }
  }

  async stop(): Promise<void> {
    await this.socket?.disconnect().catch(() => undefined)
    this.socket = undefined
    this.web = undefined
    this.tracker.stopped()
  }

  async deliver(notification: InboxNotification): Promise<void> {
    if (!this.web) throw new Error('Slack client is not ready')
    if (!this.ownerUserId) throw new Error('Slack owner is not linked')
    this.tracker.attempt()
    try {
      const channel = await this.openOwnerDm()
      await this.web.chat.postMessage({ channel, text: formatInboxNotification(notification) })
      for (const attachment of decodeInboxAttachments(notification)) {
        await this.web.filesUploadV2({
          channel_id: channel,
          file: attachment.content,
          filename: attachment.filename,
        })
      }
      this.tracker.success(this.ownerUserId)
    } catch (error) {
      this.tracker.degraded(error)
      throw error
    }
  }

  async deliverArtifact(): Promise<void> {
    throw new Error('Inbox file delivery is not implemented for Slack yet.')
  }

  async sendOwnerText(text: string): Promise<void> {
    if (!this.web) throw new Error('Slack client is not ready')
    if (!this.ownerUserId) throw new Error('Slack owner is not linked')
    this.tracker.attempt()
    try {
      await this.web.chat.postMessage({ channel: await this.openOwnerDm(), text })
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
      await reply('Slack is linked to this OpenAlice installation.')
    })
    context.commands.register('status', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply(`OpenAlice Connector Service: ${context.getServiceStatus()}. Slack: ${this.health().status}.`)
    })
    context.commands.register('test', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      const probeId = await context.sendTest(this.id)
      await reply(`Test notification sent. Probe: ${probeId}`)
    })
    context.commands.register('inbox', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply('Inbox browsing is not implemented for Slack yet. Open Inbox in OpenAlice.')
    })
    context.commands.register('settings', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply('Slack settings buttons are not implemented yet. Change Inbox push in OpenAlice → Settings → Connectors.')
    })
    context.commands.register('uta', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply('UTA review buttons are not implemented for Slack yet. Approve pending trades in OpenAlice → Trading as Git.')
    })
  }

  private async openOwnerDm(): Promise<string> {
    if (!this.web || !this.ownerUserId) throw new Error('Slack owner is not linked')
    const opened = await this.web.conversations.open({ users: this.ownerUserId })
    const channel = opened.channel && typeof opened.channel === 'object' && 'id' in opened.channel
      ? opened.channel.id
      : undefined
    if (typeof channel !== 'string' || !channel) throw new Error('Slack could not open the owner DM')
    return channel
  }

  private async replyInChannel(channelId: string, text: string): Promise<void> {
    if (!this.web) throw new Error('Slack client is not ready')
    await this.web.chat.postMessage({ channel: channelId, text })
  }

  private isOwner(userId: string): boolean {
    return Boolean(this.ownerUserId && this.ownerUserId === userId)
  }
}

export function slackConnectorRegistration(
  proxy: ConnectorProxyTransport = DIRECT_CONNECTOR_PROXY_TRANSPORT,
): ConnectorAdapterRegistration {
  return { definition: SLACK_CONNECTOR_DEFINITION, create: () => new SlackConnectorAdapter({ proxy }) }
}

export function isSlackDirectMessage(channelId: string | undefined): boolean {
  return typeof channelId === 'string' && channelId.startsWith('D')
}

export function slackCommandName(command: string | undefined): string {
  return (command ?? '').replace(/^\//, '').trim().toLowerCase()
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

interface SlackSlashCommandEvent {
  ack: (response?: unknown) => Promise<void>
  body: {
    command?: string
    user_id?: string
    channel_id?: string
  }
}

function requiredString(config: ConnectorAdapterConfig, key: string): string {
  const value = config.settings[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Slack setting ${key} is required`)
  return value.trim()
}

function optionalString(config: ConnectorAdapterConfig, key: string): string | undefined {
  const value = config.settings[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
