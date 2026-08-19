import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../core/adapter.js'
import type { ConnectorAdapterContext } from '../core/adapter.js'
import type { ConnectorProxyTransport } from '../core/proxy.js'
import {
  FeishuConnectorAdapter,
  feishuFileType,
  feishuPostContent,
  isFeishuAppId,
  isFeishuP2pChat,
  parseFeishuCommand,
  parseFeishuMessageText,
  resolveFeishuDomain,
} from './feishu.js'

const startMock = vi.fn()
const closeMock = vi.fn()
const messageCreate = vi.fn(async () => ({ code: 0 }))
const fileCreate = vi.fn(async () => ({ file_key: 'file_abc' }))
const wsCtor = vi.fn()
const clientCtor = vi.fn()
let receiveHandler: ((data: unknown) => Promise<void> | void) | undefined

vi.mock('@larksuiteoapi/node-sdk', () => ({
  Domain: { Feishu: 0, Lark: 1 },
  AppType: { SelfBuild: 0, ISV: 1 },
  LoggerLevel: { warn: 2, info: 3 },
  Client: class {
    im = { message: { create: messageCreate }, file: { create: fileCreate } }
    constructor(params: unknown) {
      clientCtor(params)
    }
  },
  WSClient: class {
    constructor(params: { onReady?: () => void; onError?: (error: unknown) => void }) {
      wsCtor(params)
      this.params = params
    }
    params: { onReady?: () => void; onError?: (error: unknown) => void }
    start() {
      return startMock()
    }
    close() {
      return closeMock()
    }
  },
  EventDispatcher: class {
    register(handles: { 'im.message.receive_v1'?: (data: unknown) => Promise<void> | void }) {
      receiveHandler = handles['im.message.receive_v1']
      return this
    }
  },
}))

const APP_ID = 'cli_a1b2c3d4e5f67890'
const APP_SECRET = 'feishu-app-secret-value-32chars!!'

function context(overrides: Partial<ConnectorAdapterContext> = {}): ConnectorAdapterContext {
  return {
    commands: new CommandRegistry('feishu'),
    updateSettings: async () => undefined,
    getServiceStatus: () => 'healthy',
    sendTest: async () => 'probe',
    forwardOwnerText: async () => undefined,
    enqueueArtifactRequest: () => 'art-test',
    enqueueUtaRequest: () => 'uta-test',
    ...overrides,
  }
}

function p2pEvent(text: string, options: { openId?: string; chatId?: string; chatType?: string } = {}) {
  return {
    sender: { sender_id: { open_id: options.openId ?? 'ou_owner' }, sender_type: 'user' },
    message: {
      chat_id: options.chatId ?? 'oc_chat',
      chat_type: options.chatType ?? 'p2p',
      message_type: 'text',
      content: JSON.stringify({ text }),
    },
  }
}

describe('Feishu helpers', () => {
  it('accepts Feishu vs Lark domains without guessing mixed consoles', () => {
    expect(resolveFeishuDomain(undefined)).toBe('feishu')
    expect(resolveFeishuDomain('Feishu')).toBe('feishu')
    expect(resolveFeishuDomain('lark')).toBe('lark')
    expect(resolveFeishuDomain('https://open.larksuite.com')).toBe('lark')
    expect(isFeishuAppId(APP_ID)).toBe(true)
    expect(isFeishuAppId('not-an-app-id')).toBe(false)
  })

  it('only treats p2p chats as the owner desk', () => {
    expect(isFeishuP2pChat('p2p')).toBe(true)
    expect(isFeishuP2pChat('group')).toBe(false)
  })

  it('parses text, post markdown, and slash commands', () => {
    expect(parseFeishuMessageText('{"text":"/link"}')).toBe('/link')
    expect(parseFeishuMessageText({ zh_cn: { content: [[{ tag: 'md', text: 'Hello' }]] } }, 'post')).toBe('Hello')
    expect(parseFeishuCommand('/link')).toBe('link')
    expect(parseFeishuCommand('@bot /status please')).toBe('status')
    expect(parseFeishuCommand('just chatting')).toBeUndefined()
    expect(feishuFileType('brief.pdf')).toBe('pdf')
    expect(feishuFileType('notes.md')).toBe('stream')
    expect(JSON.parse(feishuPostContent('**hi**'))).toMatchObject({
      zh_cn: { content: [[{ tag: 'md', text: '**hi**' }]] },
    })
  })
})

describe('Feishu long connection', () => {
  beforeEach(() => {
    startMock.mockReset()
    closeMock.mockReset()
    messageCreate.mockReset()
    fileCreate.mockReset()
    wsCtor.mockReset()
    clientCtor.mockReset()
    receiveHandler = undefined
    messageCreate.mockResolvedValue({ code: 0 })
    fileCreate.mockResolvedValue({ file_key: 'file_abc' })
    startMock.mockImplementation(async () => {
      const params = wsCtor.mock.calls.at(-1)?.[0] as { onReady?: () => void }
      params?.onReady?.()
    })
  })

  it('rejects a malformed App ID before opening a socket', async () => {
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 200 })
    await expect(adapter.start({
      enabled: true,
      settings: { appId: 'bad', appSecret: APP_SECRET },
    }, context())).rejects.toThrow(/App ID/)
    expect(startMock).not.toHaveBeenCalled()
  })

  it('does not claim awaiting_link until the long connection is ready', async () => {
    let release!: () => void
    startMock.mockImplementation(() => new Promise<void>((resolve) => {
      release = () => {
        const params = wsCtor.mock.calls.at(-1)?.[0] as { onReady?: () => void }
        params?.onReady?.()
        resolve()
      }
    }))
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 500 })
    const started = adapter.start({
      enabled: true,
      settings: { appId: APP_ID, appSecret: APP_SECRET },
    }, context())
    await vi.waitFor(() => expect(startMock).toHaveBeenCalled())
    expect(adapter.health().status).toBe('starting')
    release()
    await started
    expect(adapter.health().status).toBe('awaiting_link')
  })

  it('marks a linked app healthy only after the socket is ready', async () => {
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 200 })
    await adapter.start({
      enabled: true,
      settings: { appId: APP_ID, appSecret: APP_SECRET, ownerUserId: 'ou_owner', chatId: 'oc_chat' },
    }, context())
    expect(adapter.health().status).toBe('healthy')
    expect(clientCtor.mock.calls[0]?.[0]).toMatchObject({ appId: APP_ID, appSecret: APP_SECRET })
  })

  it('passes the shared proxy agent into both HTTP and WebSocket clients', async () => {
    const nodeFetchAgent = vi.fn((_url: URL) => ({ proxy: true }))
    const proxy = {
      active: true,
      nodeFetchAgent,
      close: async () => undefined,
    } as unknown as ConnectorProxyTransport
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 200, proxy })
    await adapter.start({
      enabled: true,
      settings: { appId: APP_ID, appSecret: APP_SECRET, domain: 'lark' },
    }, context())
    expect(nodeFetchAgent).toHaveBeenCalled()
    expect(nodeFetchAgent.mock.calls.map(([url]) => (url as URL).hostname)).toEqual([
      'open.larksuite.com',
      'open.larksuite.com',
      'open.larksuite.com',
    ])
    expect(wsCtor.mock.calls[0]?.[0]).toMatchObject({ agent: { proxy: true } })
    expect(clientCtor.mock.calls[0]?.[0].httpInstance).toBeTruthy()
    expect(clientCtor.mock.calls[0]?.[0].domain).toBe(1)
  })
})

describe('Feishu owner chat', () => {
  beforeEach(() => {
    startMock.mockReset()
    closeMock.mockReset()
    messageCreate.mockReset()
    fileCreate.mockReset()
    wsCtor.mockReset()
    clientCtor.mockReset()
    receiveHandler = undefined
    messageCreate.mockResolvedValue({ code: 0 })
    fileCreate.mockResolvedValue({ file_key: 'file_abc' })
    startMock.mockImplementation(async () => {
      const params = wsCtor.mock.calls.at(-1)?.[0] as { onReady?: () => void }
      params?.onReady?.()
    })
  })

  it('learns owner identity from /link in a private chat', async () => {
    const updateSettings = vi.fn(async () => undefined)
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 200 })
    await adapter.start({
      enabled: true,
      settings: { appId: APP_ID, appSecret: APP_SECRET },
    }, context({ updateSettings }))
    await receiveHandler?.(p2pEvent('/link'))
    expect(updateSettings).toHaveBeenCalledWith({ ownerUserId: 'ou_owner', chatId: 'oc_chat' })
    expect(adapter.health().status).toBe('healthy')
    expect(messageCreate).toHaveBeenCalled()
  })

  it('ignores group chats and non-owner text after link', async () => {
    const forwardOwnerText = vi.fn(async () => undefined)
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 200 })
    await adapter.start({
      enabled: true,
      settings: { appId: APP_ID, appSecret: APP_SECRET, ownerUserId: 'ou_owner', chatId: 'oc_chat' },
    }, context({ forwardOwnerText }))
    await receiveHandler?.(p2pEvent('hello group', { chatType: 'group' }))
    await receiveHandler?.(p2pEvent('hello stranger', { openId: 'ou_other' }))
    expect(forwardOwnerText).not.toHaveBeenCalled()
    await receiveHandler?.(p2pEvent('desk please'))
    expect(forwardOwnerText).toHaveBeenCalledWith({
      text: 'desk please',
      userId: 'ou_owner',
      chatId: 'oc_chat',
    })
  })

  it('sends owner-chat markdown and inbox files after link', async () => {
    const adapter = new FeishuConnectorAdapter({ startupTimeoutMs: 200 })
    await adapter.start({
      enabled: true,
      settings: { appId: APP_ID, appSecret: APP_SECRET, ownerUserId: 'ou_owner', chatId: 'oc_chat' },
    }, context())
    await adapter.sendOwnerText('**hello**')
    expect(messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ msg_type: 'post' }),
    }))
    const { createHash } = await import('node:crypto')
    const content = Buffer.from('# Report\n')
    await adapter.deliver({
      id: 'inbox-1',
      createdAt: new Date().toISOString(),
      workspaceId: 'ws-1',
      title: 'Close',
      body: 'Done',
      attachments: [{
        filename: 'close.md',
        mediaType: 'text/markdown',
        sizeBytes: content.byteLength,
        contentSha256: createHash('sha256').update(content).digest('hex'),
        contentBase64: content.toString('base64'),
      }],
    })
    expect(fileCreate).toHaveBeenCalled()
    expect(messageCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ msg_type: 'file' }),
    }))
  })
})
