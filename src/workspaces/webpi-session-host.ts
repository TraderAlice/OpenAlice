/**
 * WebPi — Pi's documented RPC mode supervised as a second interactive surface.
 *
 * This deliberately does NOT translate Pi messages into an OpenAlice message
 * model. The browser receives Pi's own AgentMessage objects plus the current
 * cumulative streaming message. Pi's JSONL session remains the only durable
 * conversation store; this host owns only one live RPC process per record.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import type { Logger } from './logger.js'
import { resolveLaunchCommand } from './win-command.js'

const REQUEST_TIMEOUT_MS = 15_000
const STDERR_MAX_CHARS = 64 * 1024

type JsonObject = Record<string, unknown>

interface RpcProcess {
  readonly pid?: number
  readonly stdin: ChildProcessWithoutNullStreams['stdin']
  readonly stdout: ChildProcessWithoutNullStreams['stdout']
  readonly stderr: ChildProcessWithoutNullStreams['stderr']
  once(event: 'spawn', listener: () => void): this
  once(event: 'error', listener: (error: Error) => void): this
  once(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): this
  on(event: 'error', listener: (error: Error) => void): this
  kill(signal?: NodeJS.Signals): boolean
}

export interface WebPiSnapshot {
  readonly recordId: string
  readonly wsId: string
  readonly resumeId: string
  readonly pid: number | null
  readonly startedAt: number
  readonly phase: 'starting' | 'idle' | 'working' | 'compacting' | 'retrying' | 'stopped' | 'failed'
  readonly state: JsonObject | null
  readonly messages: readonly unknown[]
  /** Pi's current cumulative assistant message; replaced, never accumulated. */
  readonly streamingMessage: unknown | null
  readonly error: string | null
  readonly stderrTail: string
  readonly revision: number
}

export interface StartWebPiInput {
  readonly recordId: string
  readonly wsId: string
  readonly resumeId: string
  readonly command: readonly string[]
  readonly cwd: string
  readonly env: Readonly<Record<string, string>>
}

interface PendingRequest {
  readonly command: string
  readonly resolve: (response: JsonObject) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

interface HostCallbacks {
  readonly onExit?: (recordId: string, reason: { code: number | null; signal: NodeJS.Signals | null; intentional: boolean }) => void
}

type SpawnProcess = (input: StartWebPiInput) => RpcProcess

export class WebPiSessionHost {
  private readonly sessions = new Map<string, LiveWebPiSession>()

  constructor(
    private readonly logger: Logger,
    private readonly callbacks: HostCallbacks = {},
    private readonly spawnProcess: SpawnProcess = defaultSpawnProcess,
  ) {}

  has(recordId: string): boolean {
    return this.sessions.has(recordId)
  }

  get(recordId: string): WebPiSnapshot | null {
    return this.sessions.get(recordId)?.snapshot() ?? null
  }

  async start(input: StartWebPiInput): Promise<WebPiSnapshot> {
    const existing = this.sessions.get(input.recordId)
    if (existing) return existing.snapshot()
    const session = new LiveWebPiSession(
      input,
      this.spawnProcess(input),
      this.logger.child({ scope: 'webpi', wsId: input.wsId, recordId: input.recordId }),
      (reason) => {
        if (this.sessions.get(input.recordId) === session) this.sessions.delete(input.recordId)
        this.callbacks.onExit?.(input.recordId, reason)
      },
    )
    this.sessions.set(input.recordId, session)
    try {
      await session.start()
      return session.snapshot()
    } catch (error) {
      this.sessions.delete(input.recordId)
      await session.stop('startup failed').catch(() => undefined)
      throw error
    }
  }

  async prompt(recordId: string, message: string): Promise<WebPiSnapshot> {
    const session = this.require(recordId)
    await session.prompt(message)
    return session.snapshot()
  }

  async abort(recordId: string): Promise<WebPiSnapshot> {
    const session = this.require(recordId)
    await session.abort()
    return session.snapshot()
  }

  async stop(recordId: string, reason = 'stopped'): Promise<boolean> {
    const session = this.sessions.get(recordId)
    if (!session) return false
    this.sessions.delete(recordId)
    await session.stop(reason)
    return true
  }

  async stopAll(reason = 'host disposed'): Promise<void> {
    const sessions = Array.from(this.sessions.values())
    this.sessions.clear()
    await Promise.allSettled(sessions.map((session) => session.stop(reason)))
  }

  private require(recordId: string): LiveWebPiSession {
    const session = this.sessions.get(recordId)
    if (!session) throw new Error(`WebPi session is not running: ${recordId}`)
    return session
  }
}

class LiveWebPiSession {
  private readonly pending = new Map<string, PendingRequest>()
  private requestSeq = 0
  private decoder = new StringDecoder('utf8')
  private stdoutBuffer = ''
  private stderrTail = ''
  private phase: WebPiSnapshot['phase'] = 'starting'
  private state: JsonObject | null = null
  private messages: readonly unknown[] = []
  private streamingMessage: unknown | null = null
  private error: string | null = null
  private revision = 0
  private intentionalStop = false
  private refreshTimer: ReturnType<typeof setTimeout> | null = null
  private exited = false
  private readonly startedAt = Date.now()

  constructor(
    private readonly input: StartWebPiInput,
    private readonly child: RpcProcess,
    private readonly logger: Logger,
    private readonly onExit: (reason: { code: number | null; signal: NodeJS.Signals | null; intentional: boolean }) => void,
  ) {}

  async start(): Promise<void> {
    this.child.stdout.on('data', (chunk: Buffer) => this.onStdout(chunk))
    this.child.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk))
    this.child.on('error', (error) => this.fail(error))
    this.child.once('exit', (code, signal) => this.handleExit(code, signal))
    await new Promise<void>((resolve, reject) => {
      this.child.once('spawn', resolve)
      this.child.once('error', reject)
    })
    this.logger.info('webpi.started', { pid: this.child.pid ?? null, command: this.input.command })
    await this.refresh()
    this.phase = phaseFromRpcState(this.state)
    this.bump()
  }

  snapshot(): WebPiSnapshot {
    return {
      recordId: this.input.recordId,
      wsId: this.input.wsId,
      resumeId: this.input.resumeId,
      pid: this.exited ? null : this.child.pid ?? null,
      startedAt: this.startedAt,
      phase: this.phase,
      state: this.state,
      messages: this.messages,
      streamingMessage: this.streamingMessage,
      error: this.error,
      stderrTail: this.stderrTail,
      revision: this.revision,
    }
  }

  async prompt(message: string): Promise<void> {
    const trimmed = message.trim()
    if (!trimmed) throw new Error('WebPi prompt cannot be empty')
    if (trimmed.length > 16_000) throw new Error('WebPi prompt exceeds 16000 characters')
    this.phase = 'working'
    this.error = null
    this.bump()
    await this.request('prompt', { message: trimmed })
    this.scheduleRefresh(50)
  }

  async abort(): Promise<void> {
    await this.request('abort')
    this.scheduleRefresh(0)
  }

  async stop(reason: string): Promise<void> {
    if (this.exited) return
    this.intentionalStop = true
    this.logger.info('webpi.stopping', { reason })
    this.child.stdin.end()
    this.child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolve) => this.child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ])
    if (!this.exited) this.child.kill('SIGKILL')
  }

  private async refresh(): Promise<void> {
    const [stateResponse, messageResponse] = await Promise.all([
      this.request('get_state'),
      this.request('get_messages'),
    ])
    const nextState = stateResponse['data']
    if (isObject(nextState)) this.state = nextState
    const data = messageResponse['data']
    if (isObject(data) && Array.isArray(data['messages'])) this.messages = data['messages']
    this.bump()
  }

  private scheduleRefresh(delayMs: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = null
      void this.refresh().catch((error) => this.fail(error))
    }, delayMs)
  }

  private request(command: string, payload: JsonObject = {}): Promise<JsonObject> {
    if (this.exited) return Promise.reject(new Error('WebPi process exited'))
    const id = `webpi-${++this.requestSeq}`
    return new Promise<JsonObject>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`WebPi RPC ${command} timed out`))
      }, REQUEST_TIMEOUT_MS)
      this.pending.set(id, { command, resolve, reject, timer })
      const line = `${JSON.stringify({ id, type: command, ...payload })}\n`
      this.child.stdin.write(line, (error) => {
        if (!error) return
        const pending = this.pending.get(id)
        if (!pending) return
        clearTimeout(pending.timer)
        this.pending.delete(id)
        pending.reject(error)
      })
    })
  }

  private onStdout(chunk: Buffer): void {
    this.stdoutBuffer += this.decoder.write(chunk)
    let newline = this.stdoutBuffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.stdoutBuffer.slice(0, newline)
      this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
      this.handleLine(line)
      newline = this.stdoutBuffer.indexOf('\n')
    }
  }

  private handleLine(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line) return
    let event: JsonObject
    try {
      const parsed: unknown = JSON.parse(line)
      if (!isObject(parsed)) return
      event = parsed
    } catch (error) {
      this.logger.warn('webpi.invalid_json', { error, line: line.slice(0, 500) })
      return
    }
    if (event['type'] === 'response' && typeof event['id'] === 'string') {
      const pending = this.pending.get(event['id'])
      if (!pending) return
      clearTimeout(pending.timer)
      this.pending.delete(event['id'])
      if (event['success'] === false) {
        pending.reject(new Error(typeof event['error'] === 'string' ? event['error'] : `WebPi RPC ${pending.command} failed`))
      } else {
        pending.resolve(event)
      }
      return
    }
    this.handleEvent(event)
  }

  private handleEvent(event: JsonObject): void {
    switch (event['type']) {
      case 'agent_start':
      case 'turn_start':
        this.phase = 'working'
        break
      case 'message_update':
        this.streamingMessage = event['message'] ?? null
        break
      case 'message_end':
      case 'tool_execution_end':
      case 'queue_update':
        this.scheduleRefresh(30)
        break
      case 'agent_settled':
        this.phase = 'idle'
        this.streamingMessage = null
        this.scheduleRefresh(0)
        break
      case 'compaction_start':
        this.phase = 'compacting'
        break
      case 'compaction_end':
        this.phase = 'working'
        this.scheduleRefresh(0)
        break
      case 'auto_retry_start':
        this.phase = 'retrying'
        break
      case 'auto_retry_end':
        this.phase = 'working'
        break
      case 'extension_error':
        this.error = typeof event['error'] === 'string' ? event['error'] : 'Pi extension failed'
        break
      default:
        break
    }
    this.bump()
  }

  private onStderr(chunk: Buffer): void {
    this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-STDERR_MAX_CHARS)
    this.bump()
  }

  private fail(error: Error): void {
    this.error = error.message
    this.phase = 'failed'
    this.bump()
    this.logger.error('webpi.failed', { error })
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return
    this.exited = true
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = null
    this.phase = this.intentionalStop ? 'stopped' : 'failed'
    if (!this.intentionalStop && !this.error) {
      this.error = `Pi RPC exited (code=${String(code)}, signal=${String(signal)})`
    }
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(this.error ?? 'WebPi stopped'))
    }
    this.pending.clear()
    this.bump()
    this.logger.info('webpi.exited', { code, signal, intentional: this.intentionalStop })
    this.onExit({ code, signal, intentional: this.intentionalStop })
  }

  private bump(): void {
    this.revision += 1
  }
}

function defaultSpawnProcess(input: StartWebPiInput): RpcProcess {
  const resolved = resolveLaunchCommand(input.command, { env: input.env })
  const [file, ...args] = resolved.argv
  if (!file) throw new Error('WebPi command is empty')
  return spawn(file, args, {
    cwd: input.cwd,
    env: { ...input.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

function phaseFromRpcState(state: JsonObject | null): WebPiSnapshot['phase'] {
  if (state?.['isCompacting'] === true) return 'compacting'
  return state?.['isStreaming'] === true ? 'working' : 'idle'
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
