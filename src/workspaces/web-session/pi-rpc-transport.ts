/**
 * Pi's documented `--mode rpc` (and Oh My Pi's protocol-compatible fork).
 *
 * Pi exposes a canonical message list through `get_messages`, so this
 * transport refreshes that list at turn boundaries instead of accumulating
 * deltas. `message_update` frames only replace the streaming message.
 */
import {
  isJsonObject,
  stringOrNull,
  type JsonObject,
  type WebContentPart,
  type WebConversationMessage,
} from './model.js'
import {
  PendingRequests,
  type WebSessionTransport,
  type WebTransportContext,
} from './transport.js'

const MAX_PROMPT_CHARS = 16_000

export class PiRpcTransport implements WebSessionTransport {
  private readonly pending = new PendingRequests<JsonObject>('web-rpc')
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private disposed = false

  constructor(private readonly ctx: WebTransportContext) {
    ctx.channel.onMessage((event) => this.handleMessage(event))
  }

  async start(): Promise<void> {
    const rpcState = await this.refresh()
    this.ctx.state.setPhase(phaseFromRpcState(rpcState))
  }

  async prompt(message: string): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed) throw new Error('prompt cannot be empty')
    if (trimmed.length > MAX_PROMPT_CHARS) throw new Error(`prompt exceeds ${MAX_PROMPT_CHARS} characters`)
    this.ctx.state.error = null
    this.ctx.state.setPhase('working')
    try {
      await this.request('prompt', { message: trimmed })
    } catch (error) {
      // Pi rejects prompts synchronously for missing credentials or a bad
      // model; the turn never started, so fall back to idle and keep the
      // reason visible in the snapshot as well as in the thrown error.
      this.ctx.state.error = error instanceof Error ? error.message : String(error)
      this.ctx.state.setPhase(this.ctx.channel.closed ? 'failed' : 'idle')
      throw error
    }
    this.scheduleRefresh(50)
  }

  async abort(): Promise<void> {
    await this.request('abort')
    this.scheduleRefresh(0)
  }

  async respond(requestId: string): Promise<void> {
    throw new Error(`Pi RPC has no pending request ${requestId}`)
  }

  dispose(): void {
    this.disposed = true
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    this.pending.rejectAll(new Error('Pi RPC stopped'))
  }

  private async refresh(): Promise<JsonObject | null> {
    const [stateResponse, messageResponse] = await Promise.all([
      this.request('get_state'),
      this.request('get_messages'),
    ])
    const nextState = isJsonObject(stateResponse['data']) ? stateResponse['data'] : null
    if (nextState) {
      const id = stringOrNull(nextState['sessionId']) ?? stringOrNull(nextState['session_id'])
      if (id) this.ctx.state.setNativeSessionId(id)
    }
    const data = messageResponse['data']
    if (isJsonObject(data) && Array.isArray(data['messages'])) {
      this.ctx.state.replaceMessages(data['messages'].map(convertPiMessage))
      const last = data['messages'].at(-1)
      if (isJsonObject(last) && last['role'] === 'assistant' && last['stopReason'] === 'error') {
        this.ctx.state.error = stringOrNull(last['errorMessage']) ?? 'The model request failed'
      }
    }
    this.ctx.state.bump()
    return nextState
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.disposed) return
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh().catch((error: Error) => {
        if (!this.disposed && !this.ctx.channel.closed) this.ctx.state.fail(error.message)
      })
    }, delayMs)
  }

  private request(command: string, payload: JsonObject = {}): Promise<JsonObject> {
    if (this.ctx.channel.closed) return Promise.reject(new Error('Pi RPC process exited'))
    const id = this.pending.nextId()
    const wait = this.pending.wait(id, `Pi RPC ${command}`)
    void this.ctx.channel.send({ id, type: command, ...payload }).catch((error: Error) => {
      this.pending.reject(id, error)
    })
    return wait
  }

  private handleMessage(event: JsonObject): void {
    if (event['type'] === 'response' && typeof event['id'] === 'string') {
      const label = this.pending.label(event['id'])
      if (!label) return
      if (event['success'] === false) {
        this.pending.reject(event['id'], new Error(stringOrNull(event['error']) ?? `${label} failed`))
      } else {
        this.pending.resolve(event['id'], event)
      }
      return
    }
    this.handleEvent(event)
  }

  private handleEvent(event: JsonObject): void {
    const state = this.ctx.state
    switch (event['type']) {
      case 'ready':
        // Oh My Pi announces protocol versions before serving commands.
        break
      case 'agent_start':
      case 'turn_start':
        state.phase = 'working'
        break
      case 'message_update':
        state.streamingMessage = isJsonObject(event['message']) ? convertPiMessage(event['message']) : null
        break
      case 'message_end': {
        const message = isJsonObject(event['message']) ? event['message'] : null
        if (message?.['role'] === 'assistant') {
          state.streamingMessage = null
          state.error = message['stopReason'] === 'error'
            ? stringOrNull(message['errorMessage']) ?? 'The model request failed'
            : null
        }
        this.scheduleRefresh(30)
        break
      }
      case 'tool_execution_end':
      case 'queue_update':
        this.scheduleRefresh(30)
        break
      case 'agent_end':
        // OMP ends here; Pi may follow with agent_settled or retry events.
        state.phase = event['willRetry'] === true ? 'retrying' : 'idle'
        state.streamingMessage = null
        this.scheduleRefresh(0)
        break
      case 'agent_settled':
        state.phase = 'idle'
        state.streamingMessage = null
        this.scheduleRefresh(0)
        break
      case 'compaction_start':
        state.phase = 'compacting'
        break
      case 'compaction_end':
        state.phase = 'working'
        this.scheduleRefresh(0)
        break
      case 'auto_retry_start':
        state.phase = 'retrying'
        break
      case 'auto_retry_end':
        state.phase = 'working'
        break
      case 'extension_error':
        state.error = stringOrNull(event['error']) ?? 'Pi extension failed'
        break
      default:
        break
    }
    state.bump()
  }
}

function phaseFromRpcState(state: JsonObject | null): 'compacting' | 'working' | 'idle' {
  if (state?.['isCompacting'] === true) return 'compacting'
  return state?.['isStreaming'] === true ? 'working' : 'idle'
}

/** Pi's AgentMessage already matches the neutral shape; validate rather than translate. */
export function convertPiMessage(value: unknown): WebConversationMessage {
  if (!isJsonObject(value)) return { role: 'unknown', value }
  const timestamp = typeof value['timestamp'] === 'number' ? { timestamp: value['timestamp'] } : {}
  switch (value['role']) {
    case 'user':
      return { role: 'user', content: piContent(value['content']), ...timestamp }
    case 'assistant': {
      const content = piContent(value['content'])
      return { role: 'assistant', content: typeof content === 'string' ? [{ type: 'text', text: content }] : content, ...timestamp }
    }
    case 'toolResult':
    case 'tool':
      return {
        role: 'toolResult',
        toolCallId: stringOrNull(value['toolCallId']) ?? '',
        toolName: stringOrNull(value['toolName']) ?? 'tool',
        content: piContent(value['content']),
        isError: value['isError'] === true,
        ...timestamp,
      }
    default:
      return { role: 'unknown', value, ...timestamp }
  }
}

function piContent(value: unknown): readonly WebContentPart[] | string {
  if (typeof value === 'string') return value
  if (!Array.isArray(value)) return value === undefined ? '' : [{ type: 'data', value }]
  return value.map((part): WebContentPart => {
    if (!isJsonObject(part)) return { type: 'data', value: part }
    if (part['type'] === 'text' && typeof part['text'] === 'string') return { type: 'text', text: part['text'] }
    if (part['type'] === 'thinking') {
      return { type: 'thinking', thinking: stringOrNull(part['thinking']) ?? stringOrNull(part['text']) ?? '' }
    }
    if (part['type'] === 'toolCall') {
      return {
        type: 'toolCall',
        id: stringOrNull(part['id']) ?? stringOrNull(part['toolCallId']) ?? '',
        name: stringOrNull(part['name']) ?? 'tool',
        arguments: part['arguments'] ?? {},
      }
    }
    return { type: 'data', value: part }
  })
}
