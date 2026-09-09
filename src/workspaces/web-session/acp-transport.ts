/**
 * Agent Client Protocol (https://agentclientprotocol.com) over stdio.
 *
 * Cursor Agent (`agent acp`), Grok Build (`grok agent stdio`) and opencode
 * (`opencode acp`) implement the agent side natively. Alice is the client: it
 * advertises no filesystem or terminal capabilities, so agents keep using
 * their own tools, and only permission requests round-trip to the browser.
 */
import { JsonRpcPeer, type JsonRpcError } from './json-rpc.js'
import {
  isJsonObject,
  stringOrNull,
  type JsonObject,
  type WebContentPart,
  type WebPermissionRequest,
  type WebRequestOption,
  type WebRequestOptionTone,
} from './model.js'
import { TranscriptBuilder } from './transcript-builder.js'
import type { WebSessionTransport, WebTransportContext } from './transport.js'

const ACP_PROTOCOL_VERSION = 1
const SESSION_LOAD_TIMEOUT_MS = 120_000

interface PendingPermission {
  readonly rpcId: string | number
  readonly resolve: (outcome: JsonObject) => void
}

export class AcpTransport implements WebSessionTransport {
  private readonly peer: JsonRpcPeer
  private readonly builder: TranscriptBuilder
  private readonly permissions = new Map<string, PendingPermission>()
  private sessionId: string | null
  private pendingUserText: string | null = null
  private turnActive = false

  constructor(private readonly ctx: WebTransportContext) {
    this.sessionId = ctx.input.nativeSessionId ?? null
    this.builder = new TranscriptBuilder(ctx.state)
    this.peer = new JsonRpcPeer(ctx.channel, ctx.logger, {
      onNotification: (method, params) => this.onNotification(method, params),
      onRequest: (method, params, id) => this.onRequest(method, params, id),
    })
  }

  async start(): Promise<void> {
    const init = await this.peer.request('initialize', {
      protocolVersion: ACP_PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'openalice', title: 'OpenAlice', version: '1' },
    })
    const capabilities = isJsonObject(init) && isJsonObject(init['agentCapabilities']) ? init['agentCapabilities'] : {}
    const canLoad = capabilities['loadSession'] === true
    const params = { cwd: this.ctx.input.cwd, mcpServers: [] }
    try {
      if (this.sessionId && canLoad) {
        await this.peer.request('session/load', { sessionId: this.sessionId, ...params }, SESSION_LOAD_TIMEOUT_MS)
        this.flushUser()
        this.builder.endTurn()
      } else {
        if (this.sessionId) {
          throw new Error(`${this.ctx.input.agent} cannot reopen this conversation over ACP. Open the existing Session in the terminal, or create a separate new Session.`)
        }
        const created = await this.peer.request('session/new', params)
        const id = isJsonObject(created) ? stringOrNull(created['sessionId']) : null
        if (!id) throw new Error('ACP session/new returned no sessionId')
        this.sessionId = id
      }
    } catch (error) {
      throw describeAcpFailure(error, this.ctx.input.agent)
    }
    this.ctx.state.setNativeSessionId(this.sessionId)
    this.ctx.state.setPhase('idle')
  }

  async prompt(message: string): Promise<void> {
    const text = message.trim()
    if (!text) throw new Error('prompt cannot be empty')
    if (!this.sessionId) throw new Error('ACP session is not established')
    if (this.turnActive) throw new Error(`${this.ctx.input.agent} is still working on the previous prompt`)
    this.turnActive = true
    this.ctx.state.error = null
    this.builder.user(text)
    this.ctx.state.setPhase('working')
    const turn = this.peer.request('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    }, null)
    void turn.then(
      (result) => this.finishTurn(isJsonObject(result) ? stringOrNull(result['stopReason']) : null, null),
      (error: Error) => this.finishTurn(null, error),
    )
  }

  async abort(): Promise<void> {
    if (!this.sessionId) return
    await this.peer.notify('session/cancel', { sessionId: this.sessionId })
  }

  async respond(requestId: string, optionId: string): Promise<void> {
    const request = this.ctx.state.requests.find((r) => r.id === requestId)
    const pending = this.permissions.get(requestId)
    if (!request || !pending) throw new Error(`no pending request ${requestId}`)
    if (!request.options.some((option) => option.id === optionId)) {
      throw new Error(`option ${optionId} is not offered by request ${requestId}`)
    }
    this.permissions.delete(requestId)
    this.ctx.state.removeRequest(requestId)
    pending.resolve({ outcome: { outcome: 'selected', optionId } })
  }

  dispose(): void {
    this.cancelPermissions()
    this.peer.dispose(new Error('ACP session stopped'))
  }

  private finishTurn(stopReason: string | null, error: Error | null): void {
    this.turnActive = false
    this.cancelPermissions()
    this.flushUser()
    this.builder.endTurn()
    if (error) {
      if (!this.ctx.channel.closed) {
        this.ctx.state.error = error.message
        this.ctx.state.setPhase('idle')
      }
      return
    }
    if (stopReason === 'refusal') this.builder.notice(`${this.ctx.input.agent} refused to continue this turn.`)
    if (stopReason === 'max_tokens') this.builder.notice('The turn stopped at the model output limit.')
    if (stopReason === 'max_turn_requests') this.builder.notice('The turn stopped at the request limit.')
    this.ctx.state.setPhase('idle')
  }

  private onNotification(method: string, params: unknown): void {
    if (method !== 'session/update' || !isJsonObject(params)) return
    const update = params['update']
    if (!isJsonObject(update)) return
    const kind = update['sessionUpdate']
    if (kind !== 'user_message_chunk') this.flushUser()
    switch (kind) {
      case 'user_message_chunk':
        // prompt() already appended this turn's user message. ACP runtimes
        // such as Grok echo it; only history replay should append these chunks.
        if (this.turnActive) break
        this.pendingUserText = `${this.pendingUserText ?? ''}${contentBlockText(update['content'])}`
        break
      case 'agent_message_chunk':
        this.builder.text(contentBlockText(update['content']))
        break
      case 'agent_thought_chunk':
        this.builder.thinking(contentBlockText(update['content']))
        break
      case 'tool_call': {
        const id = stringOrNull(update['toolCallId'])
        if (!id) break
        this.builder.toolCall(id, toolTitle(update), update['rawInput'] ?? {})
        this.applyToolStatus(id, update)
        break
      }
      case 'tool_call_update': {
        const id = stringOrNull(update['toolCallId'])
        if (!id) break
        const name = stringOrNull(update['title'])
        this.builder.toolCallUpdate(id, {
          ...(name ? { name } : {}),
          ...(update['rawInput'] !== undefined ? { args: update['rawInput'] } : {}),
        })
        this.applyToolStatus(id, update)
        break
      }
      default:
        // plan, available_commands_update, current_mode_update, config_option_update
        break
    }
  }

  private applyToolStatus(id: string, update: JsonObject): void {
    const status = update['status']
    if (status !== 'completed' && status !== 'failed') return
    const content = toolCallContent(update['content'])
    const output = content.length > 0
      ? content
      : update['rawOutput'] !== undefined
        ? [{ type: 'data', value: update['rawOutput'] } satisfies WebContentPart]
        : ''
    this.builder.toolResult(id, output, status === 'failed')
  }

  private async onRequest(method: string, params: unknown, id: string | number): Promise<unknown> {
    if (method === 'session/request_permission' && isJsonObject(params)) {
      return this.requestPermission(params, id)
    }
    const error = new Error(`OpenAlice does not implement ${method}`) as Error & { code: number }
    error.code = -32601
    throw error
  }

  private requestPermission(params: JsonObject, rpcId: string | number): Promise<JsonObject> {
    const toolCall = isJsonObject(params['toolCall']) ? params['toolCall'] : {}
    const requestId = `acp-${String(rpcId)}`
    const options = Array.isArray(params['options'])
      ? params['options'].flatMap((option): WebRequestOption[] => {
          if (!isJsonObject(option)) return []
          const optionId = stringOrNull(option['optionId'])
          if (!optionId) return []
          return [{ id: optionId, label: stringOrNull(option['name']) ?? optionId, tone: toneFromKind(option['kind']) }]
        })
      : []
    const toolName = toolTitle(toolCall)
    const request: WebPermissionRequest = {
      id: requestId,
      kind: 'permission',
      title: toolName === 'tool' ? `${this.ctx.input.agent} requests permission` : toolName,
      description: `${this.ctx.input.agent} wants to run this tool.`,
      tool: { name: toolName, input: toolCall['rawInput'] ?? {} },
      options: options.length > 0
        ? options
        : [{ id: 'allow', label: 'Allow', tone: 'allow' }, { id: 'reject', label: 'Reject', tone: 'deny' }],
      createdAt: Date.now(),
    }
    return new Promise<JsonObject>((resolve) => {
      this.permissions.set(requestId, { rpcId, resolve })
      this.ctx.state.addRequest(request)
    })
  }

  private cancelPermissions(): void {
    for (const [requestId, pending] of this.permissions) {
      this.permissions.delete(requestId)
      this.ctx.state.removeRequest(requestId)
      pending.resolve({ outcome: { outcome: 'cancelled' } })
    }
  }

  private flushUser(): void {
    if (this.pendingUserText === null) return
    const text = this.pendingUserText
    this.pendingUserText = null
    if (text.trim()) this.builder.user(text)
  }
}

function toolTitle(record: JsonObject): string {
  return stringOrNull(record['title']) ?? stringOrNull(record['kind']) ?? 'tool'
}

function toneFromKind(kind: unknown): WebRequestOptionTone {
  if (kind === 'allow_once' || kind === 'allow_always') return 'allow'
  if (kind === 'reject_once' || kind === 'reject_always') return 'deny'
  return 'neutral'
}

function contentBlockText(block: unknown): string {
  if (!isJsonObject(block)) return ''
  if (block['type'] === 'text') return stringOrNull(block['text']) ?? ''
  if (block['type'] === 'resource_link') return stringOrNull(block['uri']) ?? ''
  if (block['type'] === 'resource' && isJsonObject(block['resource'])) return stringOrNull(block['resource']['text']) ?? ''
  return ''
}

function toolCallContent(value: unknown): WebContentPart[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry): WebContentPart[] => {
    if (!isJsonObject(entry)) return []
    if (entry['type'] === 'content') {
      const text = contentBlockText(entry['content'])
      return text ? [{ type: 'text', text }] : []
    }
    if (entry['type'] === 'diff') {
      const path = stringOrNull(entry['path']) ?? 'file'
      const oldText = stringOrNull(entry['oldText'])
      const newText = stringOrNull(entry['newText']) ?? ''
      return [{ type: 'text', text: `Edited ${path}\n\n\`\`\`diff\n${diffPreview(oldText, newText)}\n\`\`\`` }]
    }
    if (entry['type'] === 'terminal') return [{ type: 'data', value: entry }]
    return [{ type: 'data', value: entry }]
  })
}

function diffPreview(oldText: string | null, newText: string): string {
  const removed = oldText ? oldText.split('\n').map((line) => `- ${line}`) : []
  const added = newText.split('\n').map((line) => `+ ${line}`)
  return [...removed, ...added].join('\n')
}

function describeAcpFailure(error: unknown, agent: string): Error {
  const rpc = error as Partial<JsonRpcError>
  if (rpc.code === -32000 || /auth/i.test(rpc.message ?? '')) {
    return new Error(`${agent} requires authentication before it can open a Web session: ${rpc.message ?? 'auth required'}`)
  }
  return error instanceof Error ? error : new Error(String(error))
}
