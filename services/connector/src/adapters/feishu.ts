import axios, { type AxiosInstance } from 'axios'
import type {
  ConnectorAdapterConfig,
  ConnectorAdapterHealth,
  ConnectorArtifactDelivery,
  InboxNotification,
} from '@traderalice/connector-protocol'
import { FEISHU_CONNECTOR_DEFINITION } from '@traderalice/connector-protocol'
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
  formatAdapterError,
  formatInboxNotification,
  formatPlainInboxNotification,
} from './shared.js'

const FEISHU_APP_ID = /^cli_[0-9a-fA-F]{16}$/
const COMMANDS = new Set(FEISHU_CONNECTOR_DEFINITION.commands.map((command) => command.name))

export type FeishuOpenDomain = 'feishu' | 'lark'

export function resolveFeishuDomain(value: unknown): FeishuOpenDomain {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : ''
  if (raw === 'lark' || raw.includes('larksuite') || raw.includes('larkoffice')) return 'lark'
  return 'feishu'
}

export function isFeishuAppId(value: string): boolean {
  return FEISHU_APP_ID.test(value)
}

export function isFeishuP2pChat(chatType: string | undefined): boolean {
  return chatType === 'p2p'
}

export function parseFeishuMessageText(content: unknown, messageType?: string): string {
  const parsed = typeof content === 'string'
    ? safeJson(content)
    : content && typeof content === 'object' ? content : undefined
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return ''
  const record = parsed as Record<string, unknown>
  if (typeof record.text === 'string') return record.text
  if (messageType === 'post' || record.title !== undefined || record.content !== undefined) {
    return flattenFeishuPost(record)
  }
  return ''
}

export function parseFeishuCommand(text: string): string | undefined {
  const stripped = text.replace(/@[^\s]+/g, ' ').replace(/\s+/g, ' ').trim()
  const match = /^\/([a-zA-Z0-9_-]+)\b/.exec(stripped)
  const name = match?.[1]?.toLowerCase()
  return name && COMMANDS.has(name) ? name : undefined
}

export function feishuFileType(filename: string): 'opus' | 'mp4' | 'pdf' | 'doc' | 'xls' | 'ppt' | 'stream' {
  const ext = filename.split('.').pop()?.toLowerCase()
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx') return 'doc'
  if (ext === 'xls' || ext === 'xlsx') return 'xls'
  if (ext === 'ppt' || ext === 'pptx') return 'ppt'
  if (ext === 'mp4') return 'mp4'
  if (ext === 'opus') return 'opus'
  return 'stream'
}

export function feishuPostContent(markdown: string): string {
  return JSON.stringify({
    zh_cn: {
      content: [[{ tag: 'md', text: markdown }]],
    },
  })
}

export function createFeishuAxios(
  proxy: ConnectorProxyTransport,
  domain: FeishuOpenDomain = 'feishu',
): AxiosInstance | undefined {
  if (!proxy.nodeFetchAgent) return undefined
  const hostname = domain === 'lark' ? 'open.larksuite.com' : 'open.feishu.cn'
  return axios.create({
    httpAgent: proxy.nodeFetchAgent(new URL(`http://${hostname}`)),
    httpsAgent: proxy.nodeFetchAgent(new URL(`https://${hostname}`)),
    proxy: false,
  })
}

interface FeishuReceiveEvent {
  sender?: {
    sender_id?: { open_id?: string; user_id?: string }
    sender_type?: string
  }
  message?: {
    chat_id?: string
    chat_type?: string
    message_type?: string
    content?: string
  }
}

interface FeishuImClient {
  im: {
    message: {
      create: (payload: {
        params: { receive_id_type: 'chat_id' | 'open_id' }
        data: { receive_id: string; msg_type: string; content: string }
      }) => Promise<{ code?: number; msg?: string } | null | undefined>
    }
    file: {
      create: (payload: {
        data: { file_type: ReturnType<typeof feishuFileType>; file_name: string; file: Buffer }
      }) => Promise<{ file_key?: string; data?: { file_key?: string } } | null | undefined>
    }
  }
}

interface FeishuWsClient {
  start: (params: { eventDispatcher: { register: (handles: Record<string, (data: unknown) => Promise<void> | void>) => unknown } }) => Promise<void>
  close: (params?: { force?: boolean }) => void
}

export class FeishuConnectorAdapter implements ConnectorAdapter {
  readonly id = 'feishu'
  private readonly tracker = new AdapterHealthTracker(this.id)
  private readonly startupTimeoutMs: number
  private readonly proxy: ConnectorProxyTransport
  private ownerUserId?: string
  private chatId?: string
  private sessionReady = false
  private client?: FeishuImClient
  private ws?: FeishuWsClient

  classifyStartFailure = classifyNetworkStartFailure

  constructor(options: { startupTimeoutMs?: number; proxy?: ConnectorProxyTransport } = {}) {
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15_000
    this.proxy = options.proxy ?? DIRECT_CONNECTOR_PROXY_TRANSPORT
  }

  async start(config: ConnectorAdapterConfig, context: ConnectorAdapterContext): Promise<void> {
    try {
      const appId = requiredString(config, 'appId')
      const appSecret = requiredString(config, 'appSecret')
      if (!isFeishuAppId(appId)) {
        throw new Error('Feishu App ID must look like cli_ followed by 16 hex characters')
      }
      this.ownerUserId = optionalString(config, 'ownerUserId')
      this.chatId = optionalString(config, 'chatId')
      const domain = resolveFeishuDomain(config.settings.domain)
      this.registerCommands(context)

      const lark = await import('@larksuiteoapi/node-sdk')
      const httpInstance = createFeishuAxios(this.proxy, domain) as ConstructorParameters<typeof lark.Client>[0]['httpInstance']
      const sdkDomain = domain === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu
      const client = new lark.Client({
        appId,
        appSecret,
        appType: lark.AppType.SelfBuild,
        domain: sdkDomain,
        ...(httpInstance ? { httpInstance } : {}),
      })
      this.client = client as unknown as FeishuImClient

      const dispatcher = new lark.EventDispatcher({}).register({
        'im.message.receive_v1': async (data: unknown) => {
          await this.handleReceive(data, context)
        },
      })

      let handshakeSettled = false
      const ready = new Promise<void>((resolve, reject) => {
        const ws = new lark.WSClient({
          appId,
          appSecret,
          domain: sdkDomain,
          loggerLevel: lark.LoggerLevel.warn,
          ...(httpInstance ? { httpInstance } : {}),
          ...(this.proxy.nodeFetchAgent
            ? { agent: this.proxy.nodeFetchAgent(new URL(domain === 'lark' ? 'https://open.larksuite.com' : 'https://open.feishu.cn')) }
            : {}),
          onReady: () => {
            if (handshakeSettled) {
              if (this.ownerUserId) this.tracker.healthy(this.ownerUserId)
              else this.tracker.awaitingLink()
              return
            }
            handshakeSettled = true
            resolve()
          },
          onError: (error: unknown) => {
            this.tracker.degraded(error)
            if (handshakeSettled) return
            handshakeSettled = true
            reject(error instanceof Error ? error : new Error(formatAdapterError(error)))
          },
        })
        this.ws = ws as unknown as FeishuWsClient
      })

      await this.ws!.start({ eventDispatcher: dispatcher })
      await withTimeout(
        () => ready,
        this.startupTimeoutMs,
        `Feishu long connection did not become ready within ${this.startupTimeoutMs}ms`,
      )
      this.sessionReady = true
      if (this.ownerUserId) this.tracker.healthy(this.ownerUserId)
      else this.tracker.awaitingLink()
    } catch (error) {
      this.tracker.degraded(error)
      this.ws?.close({ force: true })
      this.ws = undefined
      this.client = undefined
      this.sessionReady = false
      throw error
    }
  }

  async stop(): Promise<void> {
    this.sessionReady = false
    this.ws?.close({ force: true })
    this.ws = undefined
    this.client = undefined
    this.tracker.stopped()
  }

  async deliver(notification: InboxNotification): Promise<void> {
    this.assertReady()
    this.tracker.attempt()
    try {
      await this.sendMarkdown(formatInboxNotification(notification), formatPlainInboxNotification(notification))
      for (const attachment of decodeInboxAttachments(notification)) {
        await this.sendFile(attachment.filename, attachment.content)
      }
      this.tracker.success(this.ownerUserId)
    } catch (error) {
      this.tracker.degraded(error)
      throw error
    }
  }

  async deliverArtifact(): Promise<void> {
    throw new Error('Inbox file delivery is not implemented for Feishu yet.')
  }

  async sendOwnerText(text: string): Promise<void> {
    this.assertReady()
    this.tracker.attempt()
    try {
      await this.sendMarkdown(text, text)
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
      if (!chatId) throw new Error('Feishu private chat ID is missing')
      this.ownerUserId = userId
      this.chatId = chatId
      await context.updateSettings({ ownerUserId: userId, chatId })
      this.tracker.healthy(userId)
      await reply('Feishu is linked to this OpenAlice installation.')
    })
    context.commands.register('status', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply(`OpenAlice Connector Service: ${context.getServiceStatus()}. Feishu: ${this.health().status}.`)
    })
    context.commands.register('test', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      const probeId = await context.sendTest(this.id)
      await reply(`Test notification sent. Probe: ${probeId}`)
    })
    context.commands.register('inbox', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply('Inbox browsing is not implemented for Feishu yet. Open Inbox in OpenAlice.')
    })
    context.commands.register('settings', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply('Feishu settings buttons are not implemented yet. Change Inbox push in OpenAlice → Settings → Connectors.')
    })
    context.commands.register('uta', async ({ userId, reply }) => {
      if (!this.isOwner(userId)) return reply('This command is only available to the linked owner.')
      await reply('UTA review buttons are not implemented for Feishu yet. Approve pending trades in OpenAlice → Trading as Git.')
    })
  }

  private async handleReceive(data: unknown, context: ConnectorAdapterContext): Promise<void> {
    const event = unwrapReceiveEvent(data)
    const message = event.message
    const sender = event.sender
    if (!isFeishuP2pChat(message?.chat_type)) return
    if (sender?.sender_type && sender.sender_type !== 'user') return
    const userId = sender?.sender_id?.open_id?.trim()
    const chatId = message?.chat_id?.trim()
    if (!userId || !chatId) return
    const text = parseFeishuMessageText(message?.content, message?.message_type).trim()
    if (!text) return
    const command = parseFeishuCommand(text)
    if (command) {
      await context.commands.execute({
        connectorId: this.id,
        command,
        userId,
        chatId,
        reply: async (messageText) => { await this.replyToChat(chatId, messageText) },
      }).catch(async (error) => {
        this.tracker.degraded(error)
        await this.replyToChat(chatId, 'Connector command failed. Check OpenAlice logs.').catch(() => undefined)
      })
      return
    }
    if (!this.isOwner(userId)) return
    try {
      await context.forwardOwnerText({ text, userId, chatId })
    } catch (error) {
      this.tracker.degraded(error)
      await this.replyToChat(chatId, 'OpenAlice could not accept this message. Check Connector Settings and logs.')
        .catch(() => undefined)
    }
  }

  private async sendMarkdown(markdown: string, plain: string): Promise<void> {
    try {
      await this.createMessage('post', feishuPostContent(markdown))
    } catch {
      await this.createMessage('text', JSON.stringify({ text: plain }))
    }
  }

  private async sendFile(filename: string, content: Buffer): Promise<void> {
    if (!this.client) throw new Error('Feishu client is not ready')
    const uploaded = await this.client.im.file.create({
      data: {
        file_type: feishuFileType(filename),
        file_name: filename,
        file: content,
      },
    })
    const fileKey = uploaded?.file_key ?? uploaded?.data?.file_key
    if (!fileKey) throw new Error('Feishu file upload did not return a file_key')
    await this.createMessage('file', JSON.stringify({ file_key: fileKey }))
  }

  private async createMessage(msgType: string, content: string): Promise<void> {
    if (!this.client) throw new Error('Feishu client is not ready')
    const chatId = this.chatId
    const owner = this.ownerUserId
    if (!chatId && !owner) throw new Error('Feishu owner is not linked')
    const result = await this.client.im.message.create({
      params: { receive_id_type: chatId ? 'chat_id' : 'open_id' },
      data: {
        receive_id: chatId ?? owner ?? '',
        msg_type: msgType,
        content,
      },
    })
    assertFeishuOk(result, `Feishu ${msgType} send failed`)
  }

  private async replyToChat(chatId: string, text: string): Promise<void> {
    if (!this.client) throw new Error('Feishu client is not ready')
    const result = await this.client.im.message.create({
      params: { receive_id_type: 'chat_id' },
      data: {
        receive_id: chatId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      },
    })
    assertFeishuOk(result, 'Feishu reply failed')
  }

  private assertReady(): void {
    if (!this.client || !this.sessionReady) throw new Error('Feishu client is not ready')
    if (!this.ownerUserId) throw new Error('Feishu owner is not linked')
  }

  private isOwner(userId: string): boolean {
    return Boolean(this.ownerUserId && this.ownerUserId === userId)
  }
}

export function feishuConnectorRegistration(
  proxy: ConnectorProxyTransport = DIRECT_CONNECTOR_PROXY_TRANSPORT,
): ConnectorAdapterRegistration {
  return { definition: FEISHU_CONNECTOR_DEFINITION, create: () => new FeishuConnectorAdapter({ proxy }) }
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

function unwrapReceiveEvent(data: unknown): FeishuReceiveEvent {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
  const record = data as Record<string, unknown>
  if (record.message || record.sender) return record as FeishuReceiveEvent
  if (record.event && typeof record.event === 'object' && record.event !== null) {
    return record.event as FeishuReceiveEvent
  }
  return {}
}

function flattenFeishuPost(record: Record<string, unknown>): string {
  const locale = (record.zh_cn ?? record.en_us ?? record) as Record<string, unknown>
  const blocks = locale?.content
  if (!Array.isArray(blocks)) return typeof locale?.title === 'string' ? locale.title : ''
  const lines: string[] = []
  for (const row of blocks) {
    if (!Array.isArray(row)) continue
    const parts: string[] = []
    for (const item of row) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue
      const node = item as Record<string, unknown>
      if (typeof node.text === 'string') parts.push(node.text)
      else if (typeof node.content === 'string') parts.push(node.content)
    }
    if (parts.length > 0) lines.push(parts.join(''))
  }
  return lines.join('\n')
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function assertFeishuOk(result: { code?: number; msg?: string } | null | undefined, fallback: string): void {
  if (!result) return
  if (typeof result.code === 'number' && result.code !== 0) {
    throw new Error(result.msg?.trim() || `${fallback} (${result.code})`)
  }
}

function requiredString(config: ConnectorAdapterConfig, key: string): string {
  const value = config.settings[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Feishu setting ${key} is required`)
  return value.trim()
}

function optionalString(config: ConnectorAdapterConfig, key: string): string | undefined {
  const value = config.settings[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}
