import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CommandRegistry } from '../core/adapter.js'
import {
  SlackConnectorAdapter,
  isSlackDirectMessage,
  slackCommandName,
  withTimeout,
} from './slack.js'

const startMock = vi.fn()
const disconnectMock = vi.fn()
const postMessage = vi.fn(async () => undefined)
const conversationsOpen = vi.fn(async () => ({ channel: { id: 'D123' } }))
const filesUploadV2 = vi.fn(async () => undefined)
const socketOn = vi.fn()

vi.mock('@slack/web-api', () => ({
  WebClient: class {
    chat = { postMessage }
    conversations = { open: conversationsOpen }
    filesUploadV2 = filesUploadV2
  },
}))

vi.mock('@slack/socket-mode', () => ({
  SocketModeClient: class {
    on = socketOn
    start() {
      return startMock()
    }
    disconnect() {
      return disconnectMock()
    }
  },
}))

function context() {
  return {
    commands: new CommandRegistry('slack'),
    updateSettings: async () => undefined,
    getServiceStatus: () => 'healthy',
    sendTest: async () => 'probe',
    forwardOwnerText: async () => undefined,
    enqueueArtifactRequest: async () => 'art-test',
    enqueueUtaRequest: async () => 'uta-test',
  }
}

describe('Slack channel helpers', () => {
  it('treats Slack IM channels as private owner chats', () => {
    expect(isSlackDirectMessage('D0123ABCD')).toBe(true)
    expect(isSlackDirectMessage('C0123CHAN')).toBe(false)
    expect(slackCommandName('/link')).toBe('link')
  })
})

describe('Slack Socket Mode readiness', () => {
  beforeEach(() => {
    startMock.mockReset()
    disconnectMock.mockReset()
    socketOn.mockReset()
    postMessage.mockReset()
    disconnectMock.mockResolvedValue(undefined)
  })

  it('does not claim awaiting_link until Socket Mode has started', async () => {
    startMock.mockResolvedValue({})
    const adapter = new SlackConnectorAdapter({ startupTimeoutMs: 200 })

    const started = adapter.start({
      enabled: true,
      settings: { botToken: 'xoxb-token', appToken: 'xapp-token' },
    }, context())
    expect(adapter.health().status).toBe('starting')
    await started

    expect(adapter.health().status).toBe('awaiting_link')
  })

  it('marks a linked app healthy only after Socket Mode is ready', async () => {
    startMock.mockResolvedValue({})
    const adapter = new SlackConnectorAdapter({ startupTimeoutMs: 200 })

    await adapter.start({
      enabled: true,
      settings: { botToken: 'xoxb-token', appToken: 'xapp-token', ownerUserId: 'U42' },
    }, context())

    expect(adapter.health()).toMatchObject({ status: 'healthy', owner: 'U42' })
  })

  it('stays degraded when Socket Mode never becomes ready', async () => {
    startMock.mockImplementation(() => new Promise(() => undefined))
    const adapter = new SlackConnectorAdapter({ startupTimeoutMs: 20 })

    await expect(adapter.start(
      { enabled: true, settings: { botToken: 'xoxb-token', appToken: 'xapp-token' } },
      context(),
    )).rejects.toThrow('Slack Socket Mode did not become ready within 20ms')
    expect(adapter.health().status).toBe('degraded')
    expect(disconnectMock).toHaveBeenCalled()
  })
})

describe('Slack startup timeout', () => {
  it('rejects an external startup operation that does not settle in time', async () => {
    await expect(withTimeout(
      () => new Promise<void>(() => undefined),
      10,
      'Slack Socket Mode did not become ready within 10 seconds',
    )).rejects.toThrow('Slack Socket Mode did not become ready within 10 seconds')
  })
})
