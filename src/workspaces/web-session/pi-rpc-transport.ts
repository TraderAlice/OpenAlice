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
const DEFAULT_PAGE_LIMIT = 64
const MAX_MESSAGE_PAGES = 256
const MAX_STALE_PAGE_RETRIES = 2

function isTransportLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /exceeded the transport limit/i.test(message)
}

function isPagingBusyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cannot page messages while the session is changing/i.test(message)
}

function isPagingStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /message cursor is stale/i.test(message)
}

function isUnsupportedCommandError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /unknown command|unsupported|not implemented|invalid.*type/i.test(message)
}

type FetchMessagesResult =
  | { readonly kind: 'ok'; readonly messages: readonly WebConversationMessage[]; readonly rawMessages: readonly unknown[] }
  | { readonly kind: 'partial'; readonly messages: readonly WebConversationMessage[]; readonly rawMessages: readonly unknown[]; readonly reason: string }
  | { readonly kind: 'busy' }

export class PiRpcTransport implements WebSessionTransport {
  private readonly pending = new PendingRequests<JsonObject>('web-rpc')
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private refreshInFlight = false
  private refreshQueued = false
  private busyRetryCount = 0
  private supportsPagedMessages: boolean | null = null
  private transcriptDegraded = false
  private disposed = false

  constructor(private readonly ctx: WebTransportContext) {
    ctx.channel.onMessage((event) => this.handleMessage(event))
  }

  async start(): Promise<void> {
    const rpcState = await this.refresh({ allowDegradedTranscript: true })
    this.ctx.state.setPhase(phaseFromRpcState(rpcState))
  }

  async prompt(message: string): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed) throw new Error('prompt cannot be empty')
    if (trimmed.length > MAX_PROMPT_CHARS) throw new Error(`prompt exceeds ${MAX_PROMPT_CHARS} characters`)
    this.ctx.state.error = null
    if (this.transcriptDegraded) {
      this.ctx.state.append({ role: 'user', content: trimmed, timestamp: Date.now() })
    }
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

  private async refresh(opts: { readonly allowDegradedTranscript?: boolean } = {}): Promise<JsonObject | null> {
    const stateResponse = await this.request('get_state')
    const nextState = isJsonObject(stateResponse['data']) ? stateResponse['data'] : null
    if (nextState) {
      const id = stringOrNull(nextState['sessionId']) ?? stringOrNull(nextState['session_id'])
      if (id) this.ctx.state.setNativeSessionId(id)
    }

    const fetched = await this.fetchMessages(opts.allowDegradedTranscript === true)
    if (fetched.kind === 'ok' || fetched.kind === 'partial') {
      const wasDegraded = this.transcriptDegraded
      this.transcriptDegraded = fetched.kind === 'partial'
      this.busyRetryCount = 0
      if (fetched.kind === 'ok') {
        this.ctx.state.replaceMessages(fetched.messages)
      } else if (!wasDegraded || this.ctx.state.messages.length === 0) {
        this.ctx.state.replaceMessages([
          ...fetched.messages,
          { role: 'notice', text: `Older transcript history exceeded the RPC frame limit (${fetched.reason}); live turns continue normally.` },
        ])
      }
      const last = fetched.rawMessages.at(-1)
      if (isJsonObject(last) && last['role'] === 'assistant' && last['stopReason'] === 'error') {
        this.ctx.state.error = stringOrNull(last['errorMessage']) ?? 'The model request failed'
      } else if (this.ctx.state.error && isTransportLimitError(this.ctx.state.error)) {
        this.ctx.state.error = null
      }
    } else if (
      fetched.kind === 'busy'
      && this.ctx.state.phase === 'idle'
      && this.busyRetryCount < 3
    ) {
      this.busyRetryCount += 1
      this.refreshQueued = true
    }
    this.ctx.state.bump()
    return nextState
  }

  private async fetchMessages(allowDegraded: boolean): Promise<FetchMessagesResult> {
    if (this.supportsPagedMessages === true) {
      return this.fetchMessagesPaged(allowDegraded)
    }
    try {
      const messageResponse = await this.request('get_messages')
      const data = messageResponse['data']
      const rawMessages = isJsonObject(data) && Array.isArray(data['messages']) ? data['messages'] : []
      return { kind: 'ok', messages: rawMessages.map(convertPiMessage), rawMessages }
    } catch (error) {
      if (isTransportLimitError(error)) {
        this.ctx.logger.warn('pi_rpc.get_messages_exceeded_transport_limit', {
          agent: this.ctx.input.agent,
          error: error instanceof Error ? error.message : String(error),
        })
        this.supportsPagedMessages = true
        return this.fetchMessagesPaged(true)
      }
      if (allowDegraded && !this.ctx.channel.closed) {
        this.ctx.logger.warn('pi_rpc.get_messages_failed', {
          agent: this.ctx.input.agent,
          error: error instanceof Error ? error.message : String(error),
        })
        return { kind: 'busy' }
      }
      throw error
    }
  }

  private async fetchMessagesPaged(allowDegraded: boolean): Promise<FetchMessagesResult> {
    for (let attempt = 0; attempt <= MAX_STALE_PAGE_RETRIES; attempt += 1) {
      const rawMessages: unknown[] = []
      const seenCursors = new Set<string>()
      let expectedTotal: number | undefined
      let cursor: string | undefined
      let limit = DEFAULT_PAGE_LIMIT
      let restartAttempt = false

      for (let page = 0; page < MAX_MESSAGE_PAGES; page += 1) {
        const payload: JsonObject = { limit, ...(cursor ? { cursor } : {}) }
        let response: JsonObject
        try {
          response = await this.request('get_messages_page', payload)
        } catch (error) {
          if (isPagingBusyError(error)) {
            return { kind: 'busy' }
          }
          if (isPagingStaleError(error) && attempt < MAX_STALE_PAGE_RETRIES) {
            restartAttempt = true
            break
          }
          if (isTransportLimitError(error)) {
            if (limit > 1) {
              limit = Math.max(1, Math.floor(limit / 2))
              page -= 1
              continue
            }
            const reason = error instanceof Error ? error.message : String(error)
            this.ctx.logger.warn('pi_rpc.get_messages_page_single_frame_exceeded', {
              agent: this.ctx.input.agent,
              collectedMessages: rawMessages.length,
              reason,
            })
            if (allowDegraded) {
              return { kind: 'partial', messages: rawMessages.map(convertPiMessage), rawMessages, reason }
            }
            throw error
          }
          if (isUnsupportedCommandError(error)) {
            this.supportsPagedMessages = false
            return this.fetchMessages(allowDegraded)
          }
          throw error
        }

        const data = isJsonObject(response['data']) ? response['data'] : null
        const pageMessages = data && Array.isArray(data['messages']) ? data['messages'] : []
        const totalMessages = data && typeof data['totalMessages'] === 'number' ? data['totalMessages'] : undefined
        if (totalMessages !== undefined && expectedTotal !== undefined && totalMessages !== expectedTotal) {
          if (attempt < MAX_STALE_PAGE_RETRIES) {
            restartAttempt = true
            break
          }
        }
        if (totalMessages !== undefined) expectedTotal = totalMessages
        rawMessages.push(...pageMessages)

        const nextCursor = data ? stringOrNull(data['nextCursor']) : null
        if (!nextCursor) {
          return { kind: 'ok', messages: rawMessages.map(convertPiMessage), rawMessages }
        }
        if (seenCursors.has(nextCursor)) {
          return { kind: 'ok', messages: rawMessages.map(convertPiMessage), rawMessages }
        }
        seenCursors.add(nextCursor)
        cursor = nextCursor
      }

      if (!restartAttempt) {
        return { kind: 'ok', messages: rawMessages.map(convertPiMessage), rawMessages }
      }
    }

    return { kind: 'busy' }
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.disposed) return
    if (this.refreshInFlight) {
      this.refreshQueued = true
      return
    }
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.runScheduledRefresh()
    }, delayMs)
  }

  private async runScheduledRefresh(): Promise<void> {
    if (this.disposed || this.ctx.channel.closed) return
    if (this.refreshInFlight) {
      this.refreshQueued = true
      return
    }
    this.refreshInFlight = true
    try {
      await this.refresh({ allowDegradedTranscript: true })
    } catch (error) {
      if (!this.disposed && !this.ctx.channel.closed) {
        // Never kill a live, responsive session over a non-fatal transcript
        // sync error (which would block SessionWakeDelivery and user prompts).
        this.ctx.logger.warn('pi_rpc.refresh_failed', {
          agent: this.ctx.input.agent,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    } finally {
      this.refreshInFlight = false
      if (this.refreshQueued && !this.disposed && !this.ctx.channel.closed) {
        this.refreshQueued = false
        this.scheduleRefresh(30)
      }
    }
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
      case 'ready': {
        // Oh My Pi announces protocol versions & maxFrameBytes before serving commands.
        const supported = Array.isArray(event['supportedProtocolVersions'])
          ? event['supportedProtocolVersions']
          : []
        if (supported.includes(2) || typeof event['maxFrameBytes'] === 'number') {
          this.supportsPagedMessages = true
        }
        break
      }
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
        if (this.transcriptDegraded && message) {
          state.append(convertPiMessage(message))
        } else if (!this.supportsPagedMessages) {
          this.scheduleRefresh(30)
        }
        break
      }
      case 'tool_execution_end':
      case 'queue_update':
        if (!this.supportsPagedMessages) {
          this.scheduleRefresh(30)
        }
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
