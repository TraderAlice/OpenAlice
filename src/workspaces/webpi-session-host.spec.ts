import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import type { Logger } from './logger.js'
import { WebPiSessionHost, type StartWebPiInput } from './webpi-session-host.js'

class FakeRpcProcess extends EventEmitter {
  readonly pid = 4242
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  private messages: unknown[] = []

  constructor() {
    super()
    this.stdin.setEncoding('utf8')
    let buffer = ''
    this.stdin.on('data', (chunk: string) => {
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line) this.command(JSON.parse(line) as Record<string, unknown>)
        nl = buffer.indexOf('\n')
      }
    })
    queueMicrotask(() => this.emit('spawn'))
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    queueMicrotask(() => this.emit('exit', 0, signal))
    return true
  }

  private command(command: Record<string, unknown>): void {
    const id = command['id']
    const type = command['type']
    if (type === 'get_state') {
      this.line({ type: 'response', id, command: type, success: true, data: {
        sessionId: 'native-pi', thinkingLevel: 'medium', isStreaming: false,
        isCompacting: false, steeringMode: 'all', followUpMode: 'one-at-a-time',
        autoCompactionEnabled: true, messageCount: this.messages.length, pendingMessageCount: 0,
      } })
      return
    }
    if (type === 'get_messages') {
      this.line({ type: 'response', id, command: type, success: true, data: { messages: this.messages } })
      return
    }
    if (type === 'prompt') {
      const user = { role: 'user', content: command['message'] }
      const partialA = { role: 'assistant', content: [{ type: 'text', text: 'hel' }] }
      const partialB = { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
      const assistant = partialB
      this.messages = [...this.messages, user, assistant]
      this.line({ type: 'response', id, command: type, success: true })
      this.line({ type: 'agent_start' })
      this.line({ type: 'message_update', message: partialA })
      this.line({ type: 'message_update', message: partialB })
      this.line({ type: 'message_end', message: assistant })
      this.line({ type: 'agent_settled' })
      return
    }
    if (type === 'abort') {
      this.line({ type: 'response', id, command: type, success: true })
    }
  }

  private line(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`)
  }
}

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
} as unknown as Logger

const input: StartWebPiInput = {
  recordId: 'pi-record',
  wsId: 'chat-ws',
  resumeId: 'resume-pi',
  command: ['pi', '--session-id', 'native-pi', '--mode', 'rpc'],
  cwd: '/tmp/workspace',
  env: {},
}

describe('WebPiSessionHost', () => {
  it('opens one RPC view and exposes Pi messages without accumulating update frames', async () => {
    const host = new WebPiSessionHost(logger, {}, () => new FakeRpcProcess() as never)
    const started = await host.start(input)
    expect(started.phase).toBe('idle')
    expect(started.messages).toEqual([])

    await host.prompt(input.recordId, 'hi')
    await new Promise((resolve) => setTimeout(resolve, 80))
    const snapshot = host.get(input.recordId)
    expect(snapshot?.phase).toBe('idle')
    expect(snapshot?.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ])
    expect(snapshot?.streamingMessage).toBeNull()
  })

  it('deduplicates repeated opens and stops intentionally', async () => {
    let spawns = 0
    const onExit = vi.fn()
    const host = new WebPiSessionHost(logger, { onExit }, () => {
      spawns += 1
      return new FakeRpcProcess() as never
    })
    await host.start(input)
    await host.start(input)
    expect(spawns).toBe(1)
    expect(await host.stop(input.recordId, 'switch to TUI')).toBe(true)
    expect(host.has(input.recordId)).toBe(false)
    expect(onExit).toHaveBeenCalledWith(input.recordId, expect.objectContaining({ intentional: true }))
  })
})

