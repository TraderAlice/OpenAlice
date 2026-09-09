import type { Logger } from '../logger.js'
import {
  type JsonObject,
  type WebConversationMessage,
  type WebPermissionRequest,
  type WebSessionPhase,
  type WebSessionWire,
} from './model.js'

export interface StartWebSessionInput {
  readonly recordId: string
  readonly wsId: string
  readonly resumeId: string
  readonly agent: string
  readonly wire: WebSessionWire
  readonly command: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
  /**
   * Native session to reopen. Absent means the transport must create a new
   * runtime session and report its id through `WebSessionState.nativeSessionId`.
   */
  readonly nativeSessionId?: string
  /** Runtime-specific launch options the transport may forward in-band. */
  readonly model?: string
  readonly reasoningEffort?: string
}

/**
 * Mutable live state one transport owns. Every mutation bumps `revision` so
 * the browser's `?revision=` long-poll sees each change exactly once.
 */
export class WebSessionState {
  phase: WebSessionPhase = 'starting'
  nativeSessionId: string | null = null
  messages: readonly WebConversationMessage[] = []
  streamingMessage: WebConversationMessage | null = null
  requests: readonly WebPermissionRequest[] = []
  error: string | null = null
  revision = 0

  constructor(private readonly onChange: () => void = () => undefined) {}

  bump(): void {
    this.revision += 1
    this.onChange()
  }

  setPhase(phase: WebSessionPhase): void {
    this.phase = phase
    this.bump()
  }

  setNativeSessionId(id: string | null): void {
    if (id === this.nativeSessionId) return
    this.nativeSessionId = id
    this.bump()
  }

  replaceMessages(messages: readonly WebConversationMessage[]): void {
    this.messages = messages
    this.bump()
  }

  append(message: WebConversationMessage): void {
    this.messages = [...this.messages, message]
    this.bump()
  }

  setStreaming(message: WebConversationMessage | null): void {
    this.streamingMessage = message
    this.bump()
  }

  /** Move the in-flight assistant message into the committed transcript. */
  commitStreaming(): void {
    const streaming = this.streamingMessage
    if (!streaming) return
    this.streamingMessage = null
    if (streaming.role === 'assistant' && streaming.content.length === 0) {
      this.bump()
      return
    }
    this.messages = [...this.messages, streaming]
    this.bump()
  }

  addRequest(request: WebPermissionRequest): void {
    this.requests = [...this.requests.filter((r) => r.id !== request.id), request]
    this.phase = 'awaiting-input'
    this.bump()
  }

  removeRequest(requestId: string): WebPermissionRequest | null {
    const request = this.requests.find((r) => r.id === requestId) ?? null
    if (!request) return null
    this.requests = this.requests.filter((r) => r.id !== requestId)
    if (this.phase === 'awaiting-input' && this.requests.length === 0) this.phase = 'working'
    this.bump()
    return request
  }

  clearRequests(): readonly WebPermissionRequest[] {
    const cleared = this.requests
    this.requests = []
    if (cleared.length > 0) this.bump()
    return cleared
  }

  fail(message: string): void {
    this.error = message
    this.phase = 'failed'
    this.bump()
  }
}

/**
 * Line-oriented JSON channel over the child's stdio. The host owns the
 * process; transports only read complete JSON objects and write complete
 * lines, so framing, decoding, and stderr capture stay in one place.
 */
export interface JsonlChannel {
  send(value: unknown): Promise<void>
  onMessage(handler: (value: JsonObject) => void): void
  readonly closed: boolean
}

export interface WebTransportContext {
  readonly input: StartWebSessionInput
  readonly state: WebSessionState
  readonly channel: JsonlChannel
  readonly logger: Logger
}

/**
 * One runtime protocol projected onto the neutral live model. Transports are
 * created after the process spawns and must be idempotent to a `stop` that
 * arrives before `start` resolves.
 */
export interface WebSessionTransport {
  /** Establish or reopen the native session; resolves when prompts may be sent. */
  start(): Promise<void>
  prompt(message: string): Promise<void>
  abort(): Promise<void>
  /** Answer one outstanding request with the chosen option id. */
  respond(requestId: string, optionId: string, text?: string): Promise<void>
  /** Polite shutdown before the host closes stdin and signals the process. */
  dispose?(): void
}

export type WebTransportFactory = (ctx: WebTransportContext) => WebSessionTransport

export const REQUEST_TIMEOUT_MS = 15_000

interface Pending<T> {
  readonly label: string
  readonly resolve: (value: T) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout> | null
}

/** Request/response correlation shared by every protocol on this channel. */
export class PendingRequests<T = JsonObject> {
  private readonly pending = new Map<string, Pending<T>>()
  private seq = 0

  constructor(private readonly prefix: string) {}

  nextId(): string {
    this.seq += 1
    return `${this.prefix}-${this.seq}`
  }

  /** `timeoutMs: null` waits indefinitely (long-running turns). */
  wait(id: string, label: string, timeoutMs: number | null = REQUEST_TIMEOUT_MS): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = timeoutMs === null
        ? null
        : setTimeout(() => {
            this.pending.delete(id)
            reject(new Error(`${label} timed out`))
          }, timeoutMs)
      this.pending.set(id, { label, resolve, reject, timer })
    })
  }

  has(id: string): boolean {
    return this.pending.has(id)
  }

  label(id: string): string | null {
    return this.pending.get(id)?.label ?? null
  }

  resolve(id: string, value: T): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false
    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.resolve(value)
    return true
  }

  reject(id: string, error: Error): boolean {
    const pending = this.pending.get(id)
    if (!pending) return false
    if (pending.timer) clearTimeout(pending.timer)
    this.pending.delete(id)
    pending.reject(error)
    return true
  }

  rejectAll(error: Error): void {
    for (const [id] of this.pending) this.reject(id, error)
  }
}
