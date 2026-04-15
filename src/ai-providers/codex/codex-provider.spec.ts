import { PassThrough } from 'node:stream'
import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

vi.mock('../../core/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/config.js')>('../../core/config.js')
  return {
    ...actual,
    readConnectorsConfig: vi.fn().mockResolvedValue({ mcp: { port: 4101 } }),
  }
})

import { spawn } from 'node:child_process'
import { CodexProvider } from './codex-provider.js'

const spawnMock = vi.mocked(spawn)

function makeChild(lines: string[], opts?: { exitCode?: number; stderr?: string }) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = new EventEmitter() as EventEmitter & {
    stdout: PassThrough
    stderr: PassThrough
  }

  child.stdout = stdout
  child.stderr = stderr

  queueMicrotask(() => {
    for (const line of lines) {
      stdout.write(line + '\n')
    }
    stdout.end()

    if (opts?.stderr) stderr.write(opts.stderr)
    stderr.end()

    child.emit('close', opts?.exitCode ?? 0)
  })

  return child as any
}

describe('CodexProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('asks through codex exec and returns the completed agent message', async () => {
    spawnMock.mockImplementation(() => makeChild([
      JSON.stringify({ type: 'thread.started', thread_id: 'thread_1' }),
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text: 'hello from codex' } }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ]))

    const provider = new CodexProvider(async () => ({}), async () => 'You are Alice.')
    const result = await provider.ask('Say hello.', {
      backend: 'codex',
      model: 'gpt-5.4',
      baseUrl: 'https://example.test/v1',
      loginMethod: 'api-key',
      apiKey: 'sk-test',
    })

    expect(result.text).toBe('hello from codex')

    const [, args, options] = spawnMock.mock.calls[0]
    expect(args).toContain('--model')
    expect(args).toContain('gpt-5.4')
    expect(args).toContain('-c')
    expect(args).toContain('mcp_servers.openalice.url="http://127.0.0.1:4101/mcp"')
    expect(args).toContain('openai_base_url="https://example.test/v1"')
    expect(options?.env?.OPENAI_API_KEY).toBe('sk-test')
    expect(options?.env?.OPENAI_BASE_URL).toBeUndefined()
  })

  it('streams delta events and finishes with a done event', async () => {
    spawnMock.mockImplementation(() => makeChild([
      JSON.stringify({ type: 'turn.started' }),
      JSON.stringify({ type: 'item.agent_message.delta', delta: 'Hel' }),
      JSON.stringify({ type: 'item/agentMessage/delta', delta: 'lo' }),
      JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }),
    ]))

    const provider = new CodexProvider(async () => ({}), async () => 'You are Alice.')
    const events = []

    for await (const event of provider.generate([], 'Say hello.')) {
      events.push(event)
    }

    expect(events).toEqual([
      { type: 'text', text: 'Hel' },
      { type: 'text', text: 'lo' },
      { type: 'done', result: { text: 'Hello', media: [] } },
    ])
  })
})
