/**
 * Claude Code's bidirectional stream-json mode:
 * `claude -p --input-format stream-json --output-format stream-json --verbose
 *  --permission-prompt-tool stdio`.
 *
 * The process stays alive between turns. Tool permission prompts arrive as
 * `control_request` frames (`can_use_tool`) and are answered with
 * `control_response`; `interrupt` is a client-initiated control request.
 */
import { readClaudeHistory } from './claude-history.js'
import {
  isJsonObject,
  stringOrNull,
  type JsonObject,
  type WebContentPart,
  type WebPermissionRequest,
} from './model.js'
import { partsFromUnknownContent, TranscriptBuilder } from './transcript-builder.js'
import { PendingRequests, type WebSessionTransport, type WebTransportContext } from './transport.js'

const ALLOW = 'allow'
const DENY = 'deny'

interface PendingControl {
  readonly requestId: string
  readonly input: unknown
}

export class ClaudeStreamJsonTransport implements WebSessionTransport {
  private readonly builder: TranscriptBuilder
  private readonly controls = new PendingRequests<JsonObject>('web-claude')
  private readonly permissions = new Map<string, PendingControl>()
  private turnActive = false
  private blocks: WebContentPart[] = []
  private partial: WebContentPart[] = []
  private assistantMessageId: string | null = null

  constructor(private readonly ctx: WebTransportContext) {
    this.builder = new TranscriptBuilder(ctx.state)
    ctx.channel.onMessage((event) => this.handleEvent(event))
  }

  async start(): Promise<void> {
    // Claude prints `system/init` only once the first user message arrives,
    // so there is nothing to await here beyond a live process.
    if (this.ctx.input.nativeSessionId) {
      const history = await readClaudeHistory(this.ctx.input.cwd, this.ctx.input.nativeSessionId, this.ctx.input.env)
      for (const entry of history) {
        const message = entry['message']
        if (!isJsonObject(message)) continue
        if (entry['type'] === 'assistant') this.handleAssistant(message)
        else if (Array.isArray(message['content']) && message['content'].some((part) => isJsonObject(part) && part['type'] === 'tool_result')) this.handleUser(message)
        else {
          this.commitBlocks()
          this.builder.endTurn()
          this.builder.user(partsFromUnknownContent(message['content'] ?? ''))
        }
      }
      this.commitBlocks()
      this.builder.endTurn()
    }
    this.ctx.state.setPhase('idle')
  }

  async prompt(message: string): Promise<void> {
    const text = message.trim()
    if (!text) throw new Error('prompt cannot be empty')
    if (this.turnActive) throw new Error('Claude is still working on the previous prompt')
    this.turnActive = true
    this.ctx.state.error = null
    this.builder.user(text)
    this.ctx.state.setPhase('working')
    try {
      await this.ctx.channel.send({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text }] },
        ...(this.ctx.state.nativeSessionId ? { session_id: this.ctx.state.nativeSessionId } : {}),
      })
    } catch (error) {
      this.turnActive = false
      this.ctx.state.error = error instanceof Error ? error.message : String(error)
      this.ctx.state.setPhase(this.ctx.channel.closed ? 'failed' : 'idle')
      throw error
    }
  }

  async abort(): Promise<void> {
    if (!this.turnActive) return
    const requestId = this.controls.nextId()
    const wait = this.controls.wait(requestId, 'Claude interrupt')
    await this.ctx.channel.send({ type: 'control_request', request_id: requestId, request: { subtype: 'interrupt' } })
    await wait.catch(() => undefined)
  }

  async respond(requestId: string, optionId: string): Promise<void> {
    const pending = this.permissions.get(requestId)
    if (!pending) throw new Error(`no pending request ${requestId}`)
    if (optionId !== ALLOW && optionId !== DENY) throw new Error(`option ${optionId} is not offered by request ${requestId}`)
    this.permissions.delete(requestId)
    this.ctx.state.removeRequest(requestId)
    await this.ctx.channel.send({
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: pending.requestId,
        response: optionId === ALLOW
          ? { behavior: 'allow', updatedInput: pending.input }
          : { behavior: 'deny', message: 'The user declined this tool use in OpenAlice.' },
      },
    })
  }

  dispose(): void {
    this.permissions.clear()
    this.controls.rejectAll(new Error('Claude session stopped'))
  }

  private handleEvent(event: JsonObject): void {
    const sessionId = stringOrNull(event['session_id'])
    if (sessionId) this.ctx.state.setNativeSessionId(sessionId)
    switch (event['type']) {
      case 'system':
        if (event['subtype'] === 'compact_boundary') this.builder.notice('Claude compacted the conversation context.')
        break
      case 'stream_event':
        this.handleStreamEvent(event['event'])
        break
      case 'assistant':
        this.handleAssistant(event['message'])
        break
      case 'user':
        this.handleUser(event['message'])
        break
      case 'result':
        this.finishTurn(event)
        break
      case 'control_request':
        this.handleControlRequest(event)
        break
      case 'control_response': {
        const response = isJsonObject(event['response']) ? event['response'] : null
        const id = stringOrNull(response?.['request_id'])
        if (id) this.controls.resolve(id, response ?? {})
        break
      }
      default:
        break
    }
  }

  private handleStreamEvent(raw: unknown): void {
    if (!isJsonObject(raw)) return
    if (raw['type'] === 'message_start' && isJsonObject(raw['message'])) {
      const id = stringOrNull(raw['message']['id'])
      if (id && id !== this.assistantMessageId) {
        this.commitBlocks()
        this.assistantMessageId = id
      }
      return
    }
    if (raw['type'] !== 'content_block_delta' || !isJsonObject(raw['delta'])) return
    const delta = raw['delta']
    const last = this.partial[this.partial.length - 1]
    if (delta['type'] === 'text_delta' && typeof delta['text'] === 'string') {
      if (last?.type === 'text') this.partial[this.partial.length - 1] = { type: 'text', text: last.text + delta['text'] }
      else this.partial.push({ type: 'text', text: delta['text'] })
    } else if (delta['type'] === 'thinking_delta' && typeof delta['thinking'] === 'string') {
      if (last?.type === 'thinking') this.partial[this.partial.length - 1] = { type: 'thinking', thinking: last.thinking + delta['thinking'] }
      else this.partial.push({ type: 'thinking', thinking: delta['thinking'] })
    } else {
      return
    }
    this.render()
  }

  private handleAssistant(message: unknown): void {
    if (!isJsonObject(message) || !Array.isArray(message['content'])) return
    const id = stringOrNull(message['id'])
    if (id !== this.assistantMessageId) {
      if (this.assistantMessageId !== null) this.commitBlocks()
      this.assistantMessageId = id
      this.blocks = []
    }
    // Each stream-json `assistant` frame carries the content blocks that
    // completed so far for one API message; deltas for those blocks are now
    // authoritative in `blocks` and no longer needed as partial text.
    this.partial = []
    for (const block of message['content']) {
      const part = convertClaudeBlock(block)
      if (part) this.blocks.push(part)
    }
    this.render()
    for (const part of this.blocks) {
      if (part.type === 'toolCall' && !this.builder.hasOpenToolCall(part.id)) {
        this.builder.trackToolCall(part.id, part.name)
      }
    }
  }

  private handleUser(message: unknown): void {
    if (!isJsonObject(message) || !Array.isArray(message['content'])) return
    for (const block of message['content']) {
      if (!isJsonObject(block) || block['type'] !== 'tool_result') continue
      const toolUseId = stringOrNull(block['tool_use_id'])
      if (!toolUseId) continue
      this.commitBlocks()
      this.builder.toolResult(toolUseId, partsFromUnknownContent(block['content'] ?? ''), block['is_error'] === true)
    }
  }

  private handleControlRequest(event: JsonObject): void {
    const requestId = stringOrNull(event['request_id'])
    const request = isJsonObject(event['request']) ? event['request'] : null
    if (!requestId || !request) return
    if (request['subtype'] !== 'can_use_tool') {
      void this.ctx.channel.send({
        type: 'control_response',
        response: { subtype: 'error', request_id: requestId, error: `OpenAlice does not handle ${String(request['subtype'])}` },
      })
      return
    }
    const toolName = stringOrNull(request['tool_name']) ?? 'tool'
    const id = `claude-${requestId}`
    this.permissions.set(id, { requestId, input: request['input'] ?? {} })
    const permission: WebPermissionRequest = {
      id,
      kind: 'permission',
      title: toolName,
      description: stringOrNull(request['description']) ?? 'Claude wants to use this tool.',
      tool: { name: toolName, input: request['input'] ?? {} },
      options: [
        { id: ALLOW, label: 'Allow', tone: 'allow' },
        { id: DENY, label: 'Deny', tone: 'deny' },
      ],
      createdAt: Date.now(),
    }
    this.ctx.state.addRequest(permission)
  }

  private finishTurn(event: JsonObject): void {
    this.turnActive = false
    for (const [id] of this.permissions) this.ctx.state.removeRequest(id)
    this.permissions.clear()
    this.commitBlocks()
    this.builder.endTurn()
    if (event['is_error'] === true) {
      const errors = Array.isArray(event['errors']) ? event['errors'].map(String).join('\n') : ''
      const detail = stringOrNull(event['result']) || errors || stringOrNull(event['subtype']) || 'Claude turn failed'
      this.ctx.state.error = detail
    }
    this.ctx.state.setPhase('idle')
  }

  private render(): void {
    this.ctx.state.setStreaming({ role: 'assistant', content: [...this.blocks, ...this.partial], timestamp: Date.now() })
  }

  private commitBlocks(): void {
    if (this.blocks.length === 0 && this.partial.length === 0) return
    this.render()
    this.ctx.state.commitStreaming()
    this.blocks = []
    this.partial = []
    this.assistantMessageId = null
  }
}

function convertClaudeBlock(block: unknown): WebContentPart | null {
  if (!isJsonObject(block)) return null
  switch (block['type']) {
    case 'text':
      return typeof block['text'] === 'string' && block['text'] ? { type: 'text', text: block['text'] } : null
    case 'thinking':
      return { type: 'thinking', thinking: stringOrNull(block['thinking']) ?? '' }
    case 'tool_use':
      return {
        type: 'toolCall',
        id: stringOrNull(block['id']) ?? `tool-${Date.now()}`,
        name: stringOrNull(block['name']) ?? 'tool',
        arguments: block['input'] ?? {},
      }
    default:
      return { type: 'data', value: block }
  }
}
