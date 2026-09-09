import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'

import { describe, expect, it, vi } from 'vitest'

import type { Logger } from './logger.js'
import { WebSessionHost, type StartWebSessionInput, type WebSessionSnapshot } from './web-session-host.js'

type Json = Record<string, unknown>

/** Minimal stdio child: parses JSONL commands from stdin, answers on stdout. */
class FakeProcess extends EventEmitter {
  readonly pid = 4242
  readonly stdin = new PassThrough()
  readonly stdout = new PassThrough()
  readonly stderr = new PassThrough()
  readonly received: Json[] = []

  constructor(private readonly onCommand: (command: Json, self: FakeProcess) => void) {
    super()
    this.stdin.setEncoding('utf8')
    let buffer = ''
    this.stdin.on('data', (chunk: string) => {
      buffer += chunk
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        if (line) {
          const parsed = JSON.parse(line) as Json
          this.received.push(parsed)
          this.onCommand(parsed, this)
        }
        nl = buffer.indexOf('\n')
      }
    })
    queueMicrotask(() => this.emit('spawn'))
  }

  kill(signal: NodeJS.Signals = 'SIGTERM'): boolean {
    queueMicrotask(() => this.emit('exit', 0, signal))
    return true
  }

  line(value: unknown): void {
    this.stdout.write(`${JSON.stringify(value)}\n`)
  }
}

const logger = {
  child: () => logger,
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  event: vi.fn(),
} as unknown as Logger

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms))

function input(overrides: Partial<StartWebSessionInput>): StartWebSessionInput {
  return {
    recordId: 'record-1',
    wsId: 'chat-ws',
    resumeId: 'resume-1',
    agent: 'pi',
    wire: 'pi-rpc',
    command: ['pi', '--mode', 'rpc'],
    cwd: '/tmp/workspace',
    env: {},
    ...overrides,
  }
}

function texts(snapshot: WebSessionSnapshot | null): string[] {
  return (snapshot?.messages ?? []).map((message) => {
    if (message.role === 'user' || message.role === 'assistant') {
      return typeof message.content === 'string'
        ? `${message.role}:${message.content}`
        : `${message.role}:${message.content.map((part) => (part.type === 'text' ? part.text : part.type === 'toolCall' ? `[${part.name}]` : part.type)).join('|')}`
    }
    if (message.role === 'toolResult') return `toolResult:${message.toolName}:${message.isError ? 'error' : 'ok'}`
    if (message.role === 'notice') return `notice:${message.text}`
    return 'unknown'
  })
}

// ── pi-rpc ─────────────────────────────────────────────────────────────────

function piRpcProcess(state: Json = {}, options: { rejectPrompt?: string; omitSettled?: boolean; modelError?: string } = {}): FakeProcess {
  let messages: unknown[] = []
  const rpcState = { sessionId: 'native-pi', isStreaming: false, isCompacting: false, ...state }
  return new FakeProcess((command, self) => {
    const id = command['id']
    const type = command['type']
    if (type === 'get_state') self.line({ type: 'response', id, command: type, success: true, data: { ...rpcState, messageCount: messages.length } })
    if (type === 'get_messages') self.line({ type: 'response', id, command: type, success: true, data: { messages } })
    if (type === 'prompt' && options.rejectPrompt) {
      self.line({ type: 'response', id, command: type, success: false, error: options.rejectPrompt })
      return
    }
    if (type === 'prompt') {
      const user = { role: 'user', content: command['message'] }
      const assistant = options.modelError
        ? { role: 'assistant', content: [], stopReason: 'error', errorMessage: options.modelError }
        : { role: 'assistant', content: [{ type: 'text', text: 'hello' }] }
      messages = [...messages, user, assistant]
      self.line({ type: 'response', id, command: type, success: true })
      self.line({ type: 'agent_start' })
      self.line({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: 'hel' }] } })
      self.line({ type: 'message_end', message: assistant })
      self.line({ type: 'agent_end', messages, willRetry: false })
      if (!options.omitSettled) self.line({ type: 'agent_settled' })
    }
    if (type === 'abort') self.line({ type: 'response', id, command: type, success: true })
  })
}

describe('WebSessionHost with the pi-rpc transport', () => {
  it('projects Pi messages into the neutral model without accumulating update frames', async () => {
    const host = new WebSessionHost(logger, {}, () => piRpcProcess() as never)
    const started = await host.start(input({ nativeSessionId: 'native-pi' }))
    expect(started.phase).toBe('idle')
    expect(started.wire).toBe('pi-rpc')
    expect(started.messages).toEqual([])

    await host.prompt('record-1', 'hi')
    await settle(80)
    const snapshot = host.get('record-1')
    expect(snapshot?.phase).toBe('idle')
    expect(snapshot?.messages).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    ])
    expect(snapshot?.streamingMessage).toBeNull()
  })

  it('settles OMP without a Pi-specific agent_settled event', async () => {
    const host = new WebSessionHost(logger, {}, () => piRpcProcess({}, { omitSettled: true }) as never)
    await host.start(input({ agent: 'omp' }))
    await host.prompt('record-1', 'hi')
    await settle(80)
    expect(host.get('record-1')?.phase).toBe('idle')
    expect(host.get('record-1')?.streamingMessage).toBeNull()
    expect(texts(host.get('record-1'))).toEqual(['user:hi', 'assistant:hello'])
    await host.stopAll()
  })

  it('surfaces asynchronous model failures instead of an empty successful reply', async () => {
    const host = new WebSessionHost(logger, {}, () => piRpcProcess({}, { modelError: '401: invalid API key' }) as never)
    await host.start(input({}))
    await host.prompt('record-1', 'hi')
    await settle(80)
    expect(host.get('record-1')?.phase).toBe('idle')
    expect(host.get('record-1')?.error).toBe('401: invalid API key')
    await host.stopAll()
  })

  it('binds the runtime-minted session id for a fresh omp session', async () => {
    const onNativeSessionId = vi.fn()
    const host = new WebSessionHost(logger, { onNativeSessionId }, () => piRpcProcess({ sessionId: 'omp-777' }) as never)
    const started = await host.start(input({ agent: 'omp', command: ['omp', '--mode', 'rpc'] }))
    expect(started.nativeSessionId).toBe('omp-777')
    expect(onNativeSessionId).toHaveBeenCalledWith('record-1', 'omp-777')
  })

  it('deduplicates repeated opens and stops intentionally', async () => {
    let spawns = 0
    const onExit = vi.fn()
    const host = new WebSessionHost(logger, { onExit }, () => {
      spawns += 1
      return piRpcProcess() as never
    })
    await host.start(input({}))
    await host.start(input({}))
    expect(spawns).toBe(1)
    expect(await host.stop('record-1', 'switch to TUI')).toBe(true)
    expect(host.has('record-1')).toBe(false)
    expect(onExit).toHaveBeenCalledWith('record-1', expect.objectContaining({ intentional: true }))
  })

  it('follows Pi compaction events until the agent settles', async () => {
    const rpc = piRpcProcess({ isCompacting: true })
    const host = new WebSessionHost(logger, {}, () => rpc as never)
    expect((await host.start(input({}))).phase).toBe('compacting')
    rpc.line({ type: 'compaction_end', reason: 'threshold', willRetry: false })
    await settle(10)
    expect(host.get('record-1')?.phase).toBe('working')
    rpc.line({ type: 'agent_settled' })
    await settle(10)
    expect(host.get('record-1')?.phase).toBe('idle')
  })

  it('returns to idle with the reason when Pi rejects a prompt before the turn starts', async () => {
    const rpc = piRpcProcess({}, { rejectPrompt: 'No API key found for the selected model.' })
    const host = new WebSessionHost(logger, {}, () => rpc as never)
    await host.start(input({}))
    await expect(host.prompt('record-1', 'hi')).rejects.toThrow('No API key found')
    const snapshot = host.get('record-1')!
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.error).toBe('No API key found for the selected model.')
    expect(snapshot.messages).toEqual([])
  })

  it('marks the session failed when the process dies unexpectedly', async () => {
    const rpc = piRpcProcess()
    const onExit = vi.fn()
    const host = new WebSessionHost(logger, { onExit }, () => rpc as never)
    await host.start(input({}))
    rpc.emit('exit', 1, null)
    await settle(10)
    expect(host.has('record-1')).toBe(false)
    expect(onExit).toHaveBeenCalledWith('record-1', expect.objectContaining({ intentional: false, code: 1 }))
  })
})

// ── acp ────────────────────────────────────────────────────────────────────

function acpProcess(options: { loadSession?: boolean; failAuth?: boolean } = {}): FakeProcess {
  return new FakeProcess((command, self) => {
    const id = command['id']
    const method = command['method']
    const params = (command['params'] ?? {}) as Json
    if (method === 'initialize') {
      self.line({ jsonrpc: '2.0', id, result: { protocolVersion: 1, agentCapabilities: { loadSession: options.loadSession ?? true }, authMethods: [] } })
      return
    }
    if (method === 'session/new') {
      if (options.failAuth) {
        self.line({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Authentication required' } })
        return
      }
      self.line({ jsonrpc: '2.0', id, result: { sessionId: 'ses_new' } })
      return
    }
    if (method === 'session/load') {
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params['sessionId'], update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier ' } } } })
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params['sessionId'], update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'question' } } } })
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: params['sessionId'], update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'earlier answer' } } } })
      self.line({ jsonrpc: '2.0', id, result: {} })
      return
    }
    if (method === 'session/prompt') {
      const sessionId = params['sessionId']
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'summarize the readme' } } } })
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'let me look' } } } })
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Reading ' } } } })
      self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'tool_call', toolCallId: 'call_1', title: 'Read README.md', kind: 'read', status: 'pending', rawInput: { path: 'README.md' } } } })
      self.line({ jsonrpc: '2.0', id: 'srv-1', method: 'session/request_permission', params: {
        sessionId,
        toolCall: { toolCallId: 'call_1', title: 'Read README.md', kind: 'read', rawInput: { path: 'README.md' } },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      } })
      ;(self as FakeProcess & { promptId?: unknown }).promptId = id
      return
    }
    if ('result' in command && command['id'] === 'srv-1') {
      const outcome = ((command['result'] as Json)['outcome'] as Json)
      const promptId = (self as FakeProcess & { promptId?: unknown }).promptId
      if (outcome['outcome'] === 'selected' && outcome['optionId'] === 'allow-once') {
        self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_new', update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'completed', content: [{ type: 'content', content: { type: 'text', text: '# OpenAlice' } }] } } })
        self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_new', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'the README.' } } } })
        self.line({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } })
      } else {
        self.line({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'ses_new', update: { sessionUpdate: 'tool_call_update', toolCallId: 'call_1', status: 'failed' } } })
        self.line({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'end_turn' } })
      }
      return
    }
    if (method === 'session/cancel') {
      const promptId = (self as FakeProcess & { promptId?: unknown }).promptId
      self.line({ jsonrpc: '2.0', id: promptId, result: { stopReason: 'cancelled' } })
    }
  })
}

describe('WebSessionHost with the acp transport', () => {
  const acpInput = input({ agent: 'cursor', wire: 'acp', command: ['cursor-agent', 'acp'] })

  it('creates a session, streams a turn, and routes permission requests to the browser', async () => {
    const onNativeSessionId = vi.fn()
    const process = acpProcess()
    const host = new WebSessionHost(logger, { onNativeSessionId }, () => process as never)
    const started = await host.start(acpInput)
    expect(started.nativeSessionId).toBe('ses_new')
    expect(onNativeSessionId).toHaveBeenCalledWith('record-1', 'ses_new')
    expect(process.received[0]).toMatchObject({ method: 'initialize', params: { protocolVersion: 1 } })

    await host.prompt('record-1', 'summarize the readme')
    await settle()
    const waiting = host.get('record-1')!
    expect(waiting.phase).toBe('awaiting-input')
    expect(waiting.requests).toHaveLength(1)
    expect(waiting.requests[0]).toMatchObject({
      kind: 'permission',
      title: 'Read README.md',
      tool: { name: 'Read README.md', input: { path: 'README.md' } },
      options: [
        { id: 'allow-once', label: 'Allow once', tone: 'allow' },
        { id: 'reject-once', label: 'Reject', tone: 'deny' },
      ],
    })
    expect(waiting.streamingMessage).toMatchObject({ role: 'assistant' })

    await expect(host.respond('record-1', waiting.requests[0]!.id, 'nope')).rejects.toThrow(/not offered/)
    await host.respond('record-1', waiting.requests[0]!.id, 'allow-once')
    await settle()
    const done = host.get('record-1')!
    expect(done.phase).toBe('idle')
    expect(done.requests).toEqual([])
    expect(texts(done)).toEqual([
      'user:summarize the readme',
      'assistant:thinking|Reading |[Read README.md]',
      'toolResult:Read README.md:ok',
      'assistant:the README.',
    ])
    expect(process.received.find((c) => c['id'] === 'srv-1')).toMatchObject({ result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } })
  })

  it('refuses unsupported restore without creating or rebinding a native session', async () => {
    const process = acpProcess({ loadSession: false })
    const bind = vi.fn()
    const host = new WebSessionHost(logger, { onNativeSessionId: bind }, () => process as never)
    await expect(host.start({ ...acpInput, nativeSessionId: 'ses_old' })).rejects.toThrow(/terminal/)
    expect(process.received.some((frame) => frame['method'] === 'session/new')).toBe(false)
    expect(bind).not.toHaveBeenCalled()
    expect(host.has('record-1')).toBe(false)
  })

  it('still creates fresh sessions when ACP cannot load history', async () => {
    const host = new WebSessionHost(logger, {}, () => acpProcess({ loadSession: false }) as never)
    expect((await host.start(acpInput)).nativeSessionId).toBe('ses_new')
    await host.stopAll()
  })

  it('reloads a known session and replays its history', async () => {
    const host = new WebSessionHost(logger, {}, () => acpProcess() as never)
    const started = await host.start({ ...acpInput, nativeSessionId: 'ses_old' })
    expect(started.nativeSessionId).toBe('ses_old')
    expect(texts(started)).toEqual(['user:earlier question', 'assistant:earlier answer'])
  })

  it('cancels outstanding permission requests when the turn is aborted', async () => {
    const process = acpProcess()
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(acpInput)
    await host.prompt('record-1', 'go')
    await settle()
    expect(host.get('record-1')?.requests).toHaveLength(1)
    await host.abort('record-1')
    await settle()
    const snapshot = host.get('record-1')!
    expect(snapshot.requests).toEqual([])
    expect(snapshot.phase).toBe('idle')
    expect(process.received.find((c) => c['id'] === 'srv-1')).toMatchObject({ result: { outcome: { outcome: 'cancelled' } } })
  })

  it('explains authentication failures instead of a bare JSON-RPC error', async () => {
    const host = new WebSessionHost(logger, {}, () => acpProcess({ failAuth: true }) as never)
    await expect(host.start(acpInput)).rejects.toThrow(/cursor requires authentication/)
    expect(host.has('record-1')).toBe(false)
  })
})

// ── claude-stream-json ─────────────────────────────────────────────────────

function claudeProcess(): FakeProcess {
  return new FakeProcess((command, self) => {
    if (command['type'] === 'user') {
      self.line({ type: 'system', subtype: 'init', session_id: 'claude-sess', model: 'claude' })
      self.line({ type: 'stream_event', session_id: 'claude-sess', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Let me ' } } })
      self.line({ type: 'stream_event', session_id: 'claude-sess', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'check.' } } })
      self.line({ type: 'assistant', session_id: 'claude-sess', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }] } })
      self.line({ type: 'assistant', session_id: 'claude-sess', message: { id: 'msg_1', role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command: 'ls' } }] } })
      self.line({ type: 'control_request', request_id: 'req_1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } })
      return
    }
    if (command['type'] === 'control_response') {
      const response = command['response'] as Json
      const inner = response['response'] as Json
      if (inner['behavior'] === 'allow') {
        self.line({ type: 'user', session_id: 'claude-sess', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'README.md\nsrc', is_error: false }] } })
        self.line({ type: 'assistant', session_id: 'claude-sess', message: { id: 'msg_2', role: 'assistant', content: [{ type: 'text', text: 'Two entries.' }] } })
        self.line({ type: 'result', subtype: 'success', session_id: 'claude-sess', is_error: false, result: 'Two entries.' })
      } else {
        self.line({ type: 'user', session_id: 'claude-sess', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'denied', is_error: true }] } })
        self.line({ type: 'result', subtype: 'success', session_id: 'claude-sess', is_error: false, result: 'ok' })
      }
      return
    }
    if (command['type'] === 'control_request') {
      const request = command['request'] as Json
      if (request['subtype'] === 'interrupt') {
        self.line({ type: 'control_response', response: { subtype: 'success', request_id: command['request_id'] } })
        self.line({ type: 'result', subtype: 'error_during_execution', session_id: 'claude-sess', is_error: true, result: 'interrupted' })
      }
    }
  })
}

describe('WebSessionHost with the claude-stream-json transport', () => {
  const claudeInput = input({ agent: 'claude', wire: 'claude-stream-json', command: ['claude', '-p'] })

  it('streams deltas, asks for tool permission, and finishes on the result frame', async () => {
    const onNativeSessionId = vi.fn()
    const process = claudeProcess()
    const host = new WebSessionHost(logger, { onNativeSessionId }, () => process as never)
    const started = await host.start(claudeInput)
    expect(started.phase).toBe('idle')

    await host.prompt('record-1', 'list files')
    await settle()
    expect(onNativeSessionId).toHaveBeenCalledWith('record-1', 'claude-sess')
    expect(process.received[0]).toMatchObject({ type: 'user', message: { role: 'user', content: [{ type: 'text', text: 'list files' }] } })
    const waiting = host.get('record-1')!
    expect(waiting.phase).toBe('awaiting-input')
    expect(waiting.requests[0]).toMatchObject({ title: 'Bash', tool: { name: 'Bash', input: { command: 'ls' } } })
    expect(waiting.streamingMessage).toMatchObject({ role: 'assistant', content: [{ type: 'text', text: 'Let me check.' }, { type: 'toolCall', id: 'toolu_1', name: 'Bash' }] })

    await host.respond('record-1', waiting.requests[0]!.id, 'allow')
    await settle()
    const done = host.get('record-1')!
    expect(done.phase).toBe('idle')
    expect(texts(done)).toEqual(['user:list files', 'assistant:Let me check.|[Bash]', 'toolResult:Bash:ok', 'assistant:Two entries.'])
    expect(process.received.at(-1)).toMatchObject({ type: 'control_response', response: { request_id: 'req_1', response: { behavior: 'allow', updatedInput: { command: 'ls' } } } })
  })

  it('sends an interrupt control request on abort', async () => {
    const process = claudeProcess()
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(claudeInput)
    await host.prompt('record-1', 'list files')
    await settle()
    await host.abort('record-1')
    await settle()
    expect(process.received.some((c) => c['type'] === 'control_request' && (c['request'] as Json)['subtype'] === 'interrupt')).toBe(true)
    const snapshot = host.get('record-1')!
    expect(snapshot.phase).toBe('idle')
    expect(snapshot.requests).toEqual([])
    expect(snapshot.error).toBe('interrupted')
  })
})

// ── codex-app-server ───────────────────────────────────────────────────────

function codexProcess(options: { history?: boolean; permissions?: boolean } = {}): FakeProcess {
  return new FakeProcess((command, self) => {
    const id = command['id']
    const method = command['method']
    const params = (command['params'] ?? {}) as Json
    if (method === 'initialize') { self.line({ id, result: { userAgent: 'codex' } }); return }
    if (options.permissions) {
      if (method === 'thread/start') { self.line({ id, result: { thread: { id: 'thr_perm', turns: [] } } }); return }
      if (method === 'turn/start') {
        self.line({ id, result: { turn: { id: 'turn_p', status: 'inProgress', items: [] } } })
        self.line({ id: 'perm-1', method: 'item/permissions/requestApproval', params: {
          itemId: 'p1', threadId: 'thr_perm', turnId: 'turn_p', cwd: '/w', reason: 'needs to reach the registry',
          permissions: { network: { enabled: true } },
        } })
        return
      }
      if (command['id'] === 'perm-1' && 'result' in command) {
        self.line({ method: 'turn/completed', params: { turn: { id: 'turn_p', status: 'completed' } } })
      }
      if (method === 'turn/interrupt') {
        self.line({ id, result: {} })
        self.line({ method: 'turn/completed', params: { turn: { id: 'turn_p', status: 'interrupted' } } })
      }
      return
    }
    if (method === 'thread/start') { self.line({ id, result: { thread: { id: 'thr_new', turns: [] } } }); return }
    if (method === 'thread/resume') {
      self.line({ id, result: { thread: { id: params['threadId'], turns: options.history ? [{
        id: 'turn_0',
        items: [
          { type: 'userMessage', id: 'u0', content: [{ type: 'text', text: 'old question' }] },
          { type: 'commandExecution', id: 'c0', command: 'pwd', cwd: '/w', status: 'completed', aggregatedOutput: '/w\n', exitCode: 0 },
          { type: 'agentMessage', id: 'a0', text: 'old answer' },
        ],
      }] : [] } } })
      return
    }
    if (method === 'turn/start') {
      self.line({ id, result: { turn: { id: 'turn_1', status: 'inProgress', items: [] } } })
      self.line({ method: 'turn/started', params: { turn: { id: 'turn_1' } } })
      self.line({ method: 'item/started', params: { item: { type: 'agentMessage', id: 'a1', text: '' } } })
      self.line({ method: 'item/agentMessage/delta', params: { itemId: 'a1', delta: 'Running ' } })
      self.line({ method: 'item/agentMessage/delta', params: { itemId: 'a1', delta: 'tests.' } })
      self.line({ method: 'item/completed', params: { item: { type: 'agentMessage', id: 'a1', text: 'Running tests.' } } })
      self.line({ method: 'item/started', params: { item: { type: 'commandExecution', id: 'c1', command: 'pnpm test', cwd: '/w', status: 'inProgress' } } })
      self.line({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { itemId: 'c1', threadId: 'thr_new', turnId: 'turn_1', command: 'pnpm test', cwd: '/w', reason: 'runs outside the sandbox' } })
      return
    }
    if (command['id'] === 'approval-1' && 'result' in command) {
      const decision = (command['result'] as Json)['decision']
      const status = decision === 'accept' || decision === 'acceptForSession' ? 'completed' : 'declined'
      self.line({ method: 'item/completed', params: { item: { type: 'commandExecution', id: 'c1', command: 'pnpm test', cwd: '/w', status, aggregatedOutput: status === 'completed' ? '12 passed\n' : '', exitCode: status === 'completed' ? 0 : null } } })
      self.line({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: decision === 'cancel' ? 'interrupted' : 'completed' } } })
      return
    }
    if (method === 'turn/interrupt') {
      self.line({ id, result: {} })
      self.line({ method: 'turn/completed', params: { turn: { id: 'turn_1', status: 'interrupted' } } })
    }
  })
}

describe('WebSessionHost with the codex-app-server transport', () => {
  const codexInput = input({ agent: 'codex', wire: 'codex-app-server', command: ['codex', 'app-server'] })

  it('starts a thread, streams items, and routes command approvals to the browser', async () => {
    const onNativeSessionId = vi.fn()
    const process = codexProcess()
    const host = new WebSessionHost(logger, { onNativeSessionId }, () => process as never)
    const started = await host.start(codexInput)
    expect(started.nativeSessionId).toBe('thr_new')
    expect(onNativeSessionId).toHaveBeenCalledWith('record-1', 'thr_new')
    expect(process.received.map((c) => c['method'])).toEqual(['initialize', 'initialized', 'thread/start'])
    expect(process.received[2]).toMatchObject({ params: { cwd: '/tmp/workspace', approvalPolicy: 'never', sandbox: 'danger-full-access' } })

    await host.prompt('record-1', 'run the tests')
    await settle()
    const waiting = host.get('record-1')!
    expect(waiting.phase).toBe('awaiting-input')
    expect(waiting.requests[0]).toMatchObject({
      title: 'Run pnpm test',
      description: 'runs outside the sandbox',
      options: [{ id: 'accept', tone: 'allow' }, { id: 'acceptForSession', tone: 'allow' }, { id: 'decline', tone: 'deny' }],
    })
    await host.respond('record-1', waiting.requests[0]!.id, 'accept')
    await settle()
    const done = host.get('record-1')!
    expect(done.phase).toBe('idle')
    expect(texts(done)).toEqual(['user:run the tests', 'assistant:Running tests.|[shell]', 'toolResult:shell:ok'])
    expect(process.received.find((c) => c['id'] === 'approval-1')).toEqual({ id: 'approval-1', result: { decision: 'accept' } })
  })

  it('answers permission requests with the granted profile, not a decision enum', async () => {
    const process = codexProcess({ permissions: true })
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(codexInput)
    await host.prompt('record-1', 'install deps')
    await settle()
    const waiting = host.get('record-1')!
    expect(waiting.phase).toBe('awaiting-input')
    expect(waiting.requests[0]).toMatchObject({
      title: 'Grant additional permissions',
      description: 'needs to reach the registry',
      tool: { name: 'request_permissions', input: { network: { enabled: true } } },
      options: [{ id: 'grant', tone: 'allow' }, { id: 'grantForSession', tone: 'allow' }, { id: 'decline', tone: 'deny' }],
    })
    await host.respond('record-1', waiting.requests[0]!.id, 'grantForSession')
    await settle()
    expect(process.received.find((c) => c['id'] === 'perm-1')).toEqual({
      id: 'perm-1',
      result: { permissions: { network: { enabled: true } }, scope: 'session' },
    })
    expect(host.get('record-1')!.phase).toBe('idle')
  })

  it('cancels a pending permission request with an empty grant when the turn ends first', async () => {
    const process = codexProcess({ permissions: true })
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(codexInput)
    await host.prompt('record-1', 'install deps')
    await settle()
    expect(host.get('record-1')!.requests).toHaveLength(1)
    await host.abort('record-1')
    await settle()
    expect(process.received.find((c) => c['id'] === 'perm-1')).toEqual({ id: 'perm-1', result: { permissions: {} } })
    expect(host.get('record-1')!.requests).toEqual([])
  })

  it('replays thread history on resume', async () => {
    const host = new WebSessionHost(logger, {}, () => codexProcess({ history: true }) as never)
    const started = await host.start({ ...codexInput, nativeSessionId: 'thr_old' })
    expect(started.nativeSessionId).toBe('thr_old')
    expect(texts(started)).toEqual(['user:old question', 'assistant:[shell]', 'toolResult:shell:ok', 'assistant:old answer'])
  })

  it('interrupts the active turn and cancels pending approvals', async () => {
    const process = codexProcess()
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(codexInput)
    await host.prompt('record-1', 'run the tests')
    await settle()
    await host.abort('record-1')
    await settle()
    expect(process.received.some((c) => c['method'] === 'turn/interrupt')).toBe(true)
    const snapshot = host.get('record-1')!
    expect(snapshot.requests).toEqual([])
    expect(snapshot.phase).toBe('idle')
    expect(texts(snapshot).at(-1)).toBe('notice:Turn interrupted.')
  })
})


describe('Codex question answers', () => {
  async function setup() {
    const process = codexProcess()
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(input({ agent: 'codex', wire: 'codex-app-server', command: ['codex', 'app-server'] }))
    process.line({ id: 'questions', method: 'item/tool/requestUserInput', params: { questions: [
      { id: 'name', header: 'Project name', question: 'What name?', options: null },
      { id: 'style', header: 'Style', question: 'Which style?', options: [{ label: 'Simple' }], isOther: true },
    ] } })
    await settle()
    return { process, host }
  }

  it('round-trips free text and then a selected option', async () => {
    const { process, host } = await setup()
    const first = host.get('record-1')!.requests[0]!
    expect(first).toMatchObject({ allowText: true, options: [] })
    await expect(host.respond('record-1', first.id, '', '  ')).rejects.toThrow(/text/)
    expect(host.get('record-1')!.requests).toHaveLength(1)
    await host.respond('record-1', first.id, '', 'Alice research')
    await settle()
    await host.respond('record-1', host.get('record-1')!.requests[0]!.id, 'Simple')
    await settle()
    expect(process.received.find((frame) => frame['id'] === 'questions')).toMatchObject({ result: { answers: {
      name: { answers: ['Alice research'] }, style: { answers: ['Simple'] },
    } } })
    await host.stopAll()
  })

  it('does not enqueue later questions when the turn is cancelled', async () => {
    const { process, host } = await setup()
    process.line({ method: 'turn/completed', params: { turn: { id: 't', status: 'interrupted' } } })
    await settle()
    expect(host.get('record-1')!.requests).toEqual([])
    expect(host.get('record-1')!.phase).toBe('idle')
    expect(process.received.find((frame) => frame['id'] === 'questions')).toMatchObject({ result: { answers: {} } })
    await host.stopAll()
  })

  it('rejects text answers to permission requests without consuming the request', async () => {
    const process = codexProcess({ permissions: true })
    const host = new WebSessionHost(logger, {}, () => process as never)
    await host.start(input({ agent: 'codex', wire: 'codex-app-server', command: ['codex', 'app-server'] }))
    await host.prompt('record-1', 'test')
    await settle()
    const request = host.get('record-1')!.requests[0]!
    await expect(host.respond('record-1', request.id, 'grant', 'yes')).rejects.toThrow(/text/)
    expect(host.get('record-1')!.requests).toHaveLength(1)
    await host.stopAll()
  })
})


it('preserves the child diagnostic when ACP exits during its handshake', async () => {
  const exit = vi.fn()
  const process = new FakeProcess((_command, self) => {
    self.stderr.write('Error: --no-leader belongs after agent\n')
    self.emit('exit', 1, null)
  })
  const host = new WebSessionHost(logger, { onExit: exit }, () => process as never)
  await expect(host.start(input({ agent: 'grok', wire: 'acp', command: ['grok', 'agent', 'stdio'] })))
    .rejects.toThrow('--no-leader belongs after agent')
  expect(exit).toHaveBeenCalledWith('record-1', { code: 1, signal: null, intentional: false, startupFailed: true })
  expect(host.has('record-1')).toBe(false)
})
