/**
 * Codex `app-server` over stdio (JSON-RPC 2.0 without the version header).
 *
 * Threads are Codex's sessions; a Web session resumes the recorded thread or
 * starts a new one, drives turns with `turn/start`, and answers command,
 * file-change, permission, and user-input requests from the browser.
 */
import { JsonRpcPeer } from './json-rpc.js'
import {
  isJsonObject,
  stringOrNull,
  type JsonObject,
  type WebContentPart,
  type WebPermissionRequest,
  type WebRequestOption,
} from './model.js'
import { TranscriptBuilder } from './transcript-builder.js'
import type { WebSessionTransport, WebTransportContext } from './transport.js'

const THREAD_TIMEOUT_MS = 60_000

type Answer = (value: unknown) => void

interface PendingApproval {
  readonly answer: Answer
  readonly respondWith: (optionId: string) => unknown
  /** Payload sent when the turn ends or stops before the browser answers. */
  readonly cancelWith: unknown
}

const DEFAULT_DECISIONS: readonly WebRequestOption[] = [
  { id: 'accept', label: 'Approve', tone: 'allow' },
  { id: 'acceptForSession', label: 'Approve for this session', tone: 'allow' },
  { id: 'decline', label: 'Decline', tone: 'deny' },
]

export class CodexAppServerTransport implements WebSessionTransport {
  private readonly peer: JsonRpcPeer
  private readonly builder: TranscriptBuilder
  private readonly approvals = new Map<string, PendingApproval>()
  private readonly deltaItems = new Set<string>()
  private threadId: string | null
  private turnId: string | null = null
  private requestSeq = 0
  private cancellationEpoch = 0

  constructor(private readonly ctx: WebTransportContext) {
    this.threadId = ctx.input.nativeSessionId ?? null
    this.builder = new TranscriptBuilder(ctx.state)
    this.peer = new JsonRpcPeer(ctx.channel, ctx.logger, {
      onNotification: (method, params) => this.onNotification(method, params),
      onRequest: (method, params, id) => this.onRequest(method, params, id),
    }, { header: false })
  }

  async start(): Promise<void> {
    await this.peer.request('initialize', {
      clientInfo: { name: 'openalice', title: 'OpenAlice', version: '1' },
      capabilities: {},
    })
    await this.peer.notify('initialized', {})
    // `AskForApproval` / `SandboxMode` are kebab-case wire enums (verified
    // against `codex app-server generate-json-schema`, 0.153.x).
    const options = {
      cwd: this.ctx.input.cwd,
      approvalPolicy: 'never',
      sandbox: 'danger-full-access',
      ...(this.ctx.input.model ? { model: this.ctx.input.model } : {}),
    }
    const result = this.threadId
      ? await this.peer.request('thread/resume', { threadId: this.threadId, ...options }, THREAD_TIMEOUT_MS)
      : await this.peer.request('thread/start', options, THREAD_TIMEOUT_MS)
    const thread = isJsonObject(result) && isJsonObject(result['thread']) ? result['thread'] : null
    const id = thread ? stringOrNull(thread['id']) : null
    if (!id) throw new Error('Codex app-server returned no thread id')
    this.threadId = id
    if (thread && Array.isArray(thread['turns'])) this.replayHistory(thread['turns'])
    this.ctx.state.setNativeSessionId(id)
    this.ctx.state.setPhase('idle')
  }

  async prompt(message: string): Promise<void> {
    const text = message.trim()
    if (!text) throw new Error('prompt cannot be empty')
    if (!this.threadId) throw new Error('Codex thread is not established')
    if (this.turnId) throw new Error('Codex is still working on the previous prompt')
    this.ctx.state.error = null
    this.builder.user(text)
    this.ctx.state.setPhase('working')
    const result = await this.peer.request('turn/start', {
      threadId: this.threadId,
      input: [{ type: 'text', text }],
    }).catch((error: Error) => {
      this.ctx.state.error = error.message
      this.ctx.state.setPhase('idle')
      throw error
    })
    const turn = isJsonObject(result) && isJsonObject(result['turn']) ? result['turn'] : null
    this.turnId = (turn ? stringOrNull(turn['id']) : null) ?? 'pending'
  }

  async abort(): Promise<void> {
    if (!this.threadId || !this.turnId || this.turnId === 'pending') return
    await this.peer.request('turn/interrupt', { threadId: this.threadId, turnId: this.turnId })
  }

  async respond(requestId: string, optionId: string, text?: string): Promise<void> {
    const request = this.ctx.state.requests.find((r) => r.id === requestId)
    const pending = this.approvals.get(requestId)
    if (!request || !pending) throw new Error(`no pending request ${requestId}`)
    const textAnswer = text !== undefined && request.kind === 'question' && request.allowText && optionId === '' && text.trim()
    if (text !== undefined && !textAnswer) throw new Error('Invalid text answer')
    if (!textAnswer && !request.options.some((option) => option.id === optionId)) {
      throw new Error(`option ${optionId} is not offered by request ${requestId}`)
    }
    this.approvals.delete(requestId)
    this.ctx.state.removeRequest(requestId)
    pending.answer(pending.respondWith(textAnswer ? text! : optionId))
  }

  dispose(): void {
    this.cancelApprovals()
    this.peer.dispose(new Error('Codex session stopped'))
  }

  private onNotification(method: string, params: unknown): void {
    const p = isJsonObject(params) ? params : {}
    switch (method) {
      case 'turn/started': {
        const turn = isJsonObject(p['turn']) ? p['turn'] : null
        const id = turn ? stringOrNull(turn['id']) : null
        if (id) this.turnId = id
        this.ctx.state.setPhase('working')
        break
      }
      case 'turn/completed': {
        const turn = isJsonObject(p['turn']) ? p['turn'] : null
        this.turnId = null
        this.cancelApprovals()
        this.builder.endTurn()
        this.deltaItems.clear()
        if (turn?.['status'] === 'failed') {
          const error = isJsonObject(turn['error']) ? turn['error'] : null
          this.ctx.state.error = stringOrNull(error?.['message']) ?? 'Codex turn failed'
        } else if (turn?.['status'] === 'interrupted') {
          this.builder.notice('Turn interrupted.')
        }
        this.ctx.state.setPhase('idle')
        break
      }
      case 'item/started':
        this.onItemStarted(p['item'])
        break
      case 'item/completed':
        this.onItemCompleted(p['item'])
        break
      case 'item/agentMessage/delta': {
        const itemId = stringOrNull(p['itemId'])
        if (itemId) this.deltaItems.add(itemId)
        this.builder.text(stringOrNull(p['delta']) ?? '')
        break
      }
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const itemId = stringOrNull(p['itemId'])
        if (itemId) this.deltaItems.add(itemId)
        this.builder.thinking(stringOrNull(p['delta']) ?? '')
        break
      }
      case 'item/reasoning/summaryPartAdded':
        this.builder.thinking('\n\n')
        break
      case 'error': {
        const error = isJsonObject(p['error']) ? p['error'] : p
        this.ctx.state.error = stringOrNull(error['message']) ?? 'Codex reported an error'
        this.ctx.state.bump()
        break
      }
      case 'warning':
        this.ctx.logger.warn('web_session.codex_warning', { message: p['message'] })
        break
      default:
        break
    }
  }

  private onItemStarted(raw: unknown): void {
    if (!isJsonObject(raw)) return
    const id = stringOrNull(raw['id'])
    if (!id) return
    switch (raw['type']) {
      case 'commandExecution':
        this.builder.toolCall(id, 'shell', { command: raw['command'], cwd: raw['cwd'] })
        break
      case 'fileChange':
        this.builder.toolCall(id, 'apply_patch', { changes: raw['changes'] ?? [] })
        break
      case 'mcpToolCall':
        this.builder.toolCall(id, `${stringOrNull(raw['server']) ?? 'mcp'}/${stringOrNull(raw['tool']) ?? 'tool'}`, raw['arguments'] ?? {})
        break
      case 'webSearch':
        this.builder.toolCall(id, 'web_search', { query: raw['query'] })
        break
      case 'imageGeneration':
        this.builder.toolCall(id, 'image_generation', {})
        break
      case 'contextCompaction':
        this.ctx.state.setPhase('compacting')
        break
      default:
        break
    }
  }

  private onItemCompleted(raw: unknown): void {
    if (!isJsonObject(raw)) return
    const id = stringOrNull(raw['id'])
    if (!id) return
    const streamed = this.deltaItems.has(id)
    switch (raw['type']) {
      case 'agentMessage':
        if (!streamed) this.builder.text(stringOrNull(raw['text']) ?? '')
        break
      case 'reasoning':
        if (!streamed) {
          const summary = Array.isArray(raw['summary']) ? raw['summary'].map(String).join('\n\n') : ''
          const content = Array.isArray(raw['content']) ? raw['content'].map(String).join('\n\n') : ''
          this.builder.thinking(summary || content)
        }
        break
      case 'commandExecution': {
        const command = commandLabel(raw['command'])
        const output = stringOrNull(raw['aggregatedOutput']) ?? ''
        const exitCode = raw['exitCode']
        const text = [
          `$ ${command}`,
          output.trimEnd(),
          exitCode === undefined || exitCode === null ? '' : `(exit ${String(exitCode)})`,
        ].filter(Boolean).join('\n')
        this.builder.toolResult(id, text, raw['status'] === 'failed' || raw['status'] === 'declined')
        break
      }
      case 'fileChange': {
        const changes = Array.isArray(raw['changes']) ? raw['changes'] : []
        const text = changes.map((change) => {
          if (!isJsonObject(change)) return ''
          const diff = stringOrNull(change['diff'])
          return `${stringOrNull(change['kind']) ?? 'edit'} ${stringOrNull(change['path']) ?? ''}${diff ? `\n\`\`\`diff\n${diff}\n\`\`\`` : ''}`
        }).filter(Boolean).join('\n\n')
        this.builder.toolResult(id, text || 'No file changes', raw['status'] === 'failed' || raw['status'] === 'declined')
        break
      }
      case 'mcpToolCall': {
        const failed = raw['status'] === 'failed'
        const body: readonly WebContentPart[] = failed
          ? [{ type: 'text', text: stringOrNull(isJsonObject(raw['error']) ? raw['error']['message'] : raw['error']) ?? 'MCP call failed' }]
          : [{ type: 'data', value: raw['result'] ?? null }]
        this.builder.toolResult(id, body, failed)
        break
      }
      case 'webSearch':
        this.builder.toolResult(id, [{ type: 'data', value: raw['results'] ?? raw['action'] ?? null }], false)
        break
      case 'imageGeneration':
        this.builder.toolResult(id, stringOrNull(raw['savedPath']) ?? 'Image generated', raw['status'] === 'failed')
        break
      case 'contextCompaction':
        this.builder.notice('Codex compacted the conversation context.')
        if (this.turnId) this.ctx.state.setPhase('working')
        break
      default:
        break
    }
  }

  private replayHistory(turns: readonly unknown[]): void {
    for (const turn of turns) {
      if (!isJsonObject(turn) || !Array.isArray(turn['items'])) continue
      for (const item of turn['items']) {
        if (!isJsonObject(item)) continue
        if (item['type'] === 'userMessage') {
          const content = Array.isArray(item['content']) ? item['content'] : []
          const text = content.map((part) => (isJsonObject(part) && typeof part['text'] === 'string' ? part['text'] : '')).filter(Boolean).join('\n')
          this.builder.user(text)
          continue
        }
        this.onItemStarted(item)
        this.onItemCompleted(item)
      }
      this.builder.endTurn()
    }
    this.deltaItems.clear()
  }

  private async onRequest(method: string, params: unknown, _id: string | number): Promise<unknown> {
    const p = isJsonObject(params) ? params : {}
    switch (method) {
      case 'item/commandExecution/requestApproval':
        return this.approval(p, {
          title: `Run ${commandLabel(p['command'])}`,
          description: stringOrNull(p['reason']) ?? `Codex wants to run a command in ${stringOrNull(p['cwd']) ?? 'the workspace'}.`,
          tool: { name: 'shell', input: { command: p['command'], cwd: p['cwd'] } },
        })
      case 'item/fileChange/requestApproval':
        return this.approval(p, {
          title: 'Apply file changes',
          description: stringOrNull(p['reason']) ?? 'Codex wants to edit files in the workspace.',
          tool: { name: 'apply_patch', input: { itemId: p['itemId'], grantRoot: p['grantRoot'] } },
        })
      case 'item/permissions/requestApproval': {
        // Unlike command/file approvals, this request answers with the granted
        // profile (`{ permissions, scope }`), not a decision enum. Granting
        // echoes the requested profile; declining grants nothing.
        const requested = isJsonObject(p['permissions']) ? p['permissions'] : {}
        return this.enqueue({
          kind: 'permission',
          title: 'Grant additional permissions',
          description: stringOrNull(p['reason']) ?? 'Codex requests network or filesystem access beyond its sandbox.',
          tool: { name: 'request_permissions', input: requested },
          options: [
            { id: 'grant', label: 'Grant for this turn', tone: 'allow' },
            { id: 'grantForSession', label: 'Grant for this session', tone: 'allow' },
            { id: 'decline', label: 'Decline', tone: 'deny' },
          ],
        }, (optionId) => optionId === 'decline'
          ? { permissions: {} }
          : { permissions: requested, scope: optionId === 'grantForSession' ? 'session' : 'turn' },
        { permissions: {} })
      }
      case 'item/tool/requestUserInput':
        return this.userInput(p)
      default: {
        const error = new Error(`OpenAlice does not implement ${method}`) as Error & { code: number }
        error.code = -32601
        throw error
      }
    }
  }

  private approval(
    params: JsonObject,
    shape: { title: string; description: string; tool: WebPermissionRequest['tool'] },
    fallback: readonly WebRequestOption[] = DEFAULT_DECISIONS,
  ): Promise<unknown> {
    const available = Array.isArray(params['availableDecisions'])
      ? params['availableDecisions'].flatMap((decision): WebRequestOption[] => {
          const id = typeof decision === 'string' ? decision : null
          if (!id) return []
          return [{ id, label: decisionLabel(id), tone: id.startsWith('accept') || id.startsWith('apply') ? 'allow' : 'deny' }]
        })
      : []
    const options = available.length > 0 ? available : fallback
    return this.enqueue({
      kind: 'permission',
      title: shape.title,
      description: shape.description,
      ...(shape.tool ? { tool: shape.tool } : {}),
      options,
    }, (optionId) => ({ decision: optionId }), { decision: 'cancel' })
  }

  private async userInput(params: JsonObject): Promise<unknown> {
    const questions = Array.isArray(params['questions']) ? params['questions'].filter(isJsonObject) : []
    const answers: Record<string, { answers: string[] }> = {}
    const epoch = this.cancellationEpoch
    for (const question of questions) {
      const questionId = stringOrNull(question['id']) ?? `q${Object.keys(answers).length}`
      const options = Array.isArray(question['options'])
        ? question['options'].flatMap((option): WebRequestOption[] => {
            if (!isJsonObject(option)) return []
            const label = stringOrNull(option['label'])
            return label ? [{ id: label, label, tone: 'neutral' }] : []
          })
        : []
      const choice = await this.enqueue({
        kind: 'question',
        title: stringOrNull(question['header']) ?? 'Codex has a question',
        description: stringOrNull(question['question']) ?? '',
        options,
        allowText: true,
        secret: question['isSecret'] === true,
      }, (optionId) => optionId, '')
      if (epoch !== this.cancellationEpoch) return { answers: {} }
      answers[questionId] = { answers: typeof choice === 'string' && choice ? [choice] : [] }
    }
    return { answers }
  }

  private enqueue(
    request: Omit<WebPermissionRequest, 'id' | 'createdAt'>,
    respondWith: (optionId: string) => unknown,
    cancelWith: unknown,
  ): Promise<unknown> {
    this.requestSeq += 1
    const id = `codex-${this.requestSeq}`
    return new Promise<unknown>((resolve) => {
      this.approvals.set(id, { answer: resolve, respondWith, cancelWith })
      this.ctx.state.addRequest({ ...request, id, createdAt: Date.now() })
    })
  }

  private cancelApprovals(): void {
    this.cancellationEpoch += 1
    for (const [id, pending] of this.approvals) {
      this.approvals.delete(id)
      this.ctx.state.removeRequest(id)
      pending.answer(pending.cancelWith)
    }
  }
}

function commandLabel(command: unknown): string {
  if (typeof command === 'string') return command
  if (Array.isArray(command)) return command.map(String).join(' ')
  return 'command'
}

function decisionLabel(id: string): string {
  switch (id) {
    case 'accept': return 'Approve'
    case 'acceptForSession': return 'Approve for this session'
    case 'decline': return 'Decline'
    case 'cancel': return 'Cancel'
    default: return id
  }
}
