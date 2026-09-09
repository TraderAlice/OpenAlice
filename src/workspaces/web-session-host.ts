/**
 * Web conversation surface — one long-lived structured Agent process per
 * Session record, presented in the browser instead of a PTY.
 *
 * The host owns process supervision (spawn, stdio framing, stderr tail, exit)
 * and hands each process to the transport that speaks its protocol. Transports
 * project the runtime's live protocol onto the neutral model in
 * `web-session/model.ts`; nothing here knows any vendor event name.
 */
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { StringDecoder } from 'node:string_decoder'

import type { Logger } from './logger.js'
import { AcpTransport } from './web-session/acp-transport.js'
import { ClaudeStreamJsonTransport } from './web-session/claude-stream-json-transport.js'
import { CodexAppServerTransport } from './web-session/codex-app-server-transport.js'
import { isJsonObject, type JsonObject, type WebSessionSnapshot, type WebSessionWire } from './web-session/model.js'
import { PiRpcTransport } from './web-session/pi-rpc-transport.js'
import {
  WebSessionState,
  type JsonlChannel,
  type StartWebSessionInput,
  type WebSessionTransport,
  type WebTransportFactory,
} from './web-session/transport.js'
import { resolveLaunchCommand } from './win-command.js'

export type { StartWebSessionInput } from './web-session/transport.js'
export type {
  WebConversationMessage,
  WebPermissionRequest,
  WebSessionPhase,
  WebSessionSnapshot,
  WebSessionWire,
} from './web-session/model.js'

const STDERR_MAX_CHARS = 64 * 1024

export interface WebSessionProcess {
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

export interface WebSessionExitReason {
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
  readonly intentional: boolean
  readonly startupFailed?: boolean
}

interface HostCallbacks {
  readonly onExit?: (recordId: string, reason: WebSessionExitReason) => void
  /** Fired once a transport learns (or confirms) the runtime's session id. */
  readonly onNativeSessionId?: (recordId: string, nativeSessionId: string) => void
}

type SpawnProcess = (input: StartWebSessionInput) => WebSessionProcess

export const WEB_TRANSPORTS: Readonly<Record<WebSessionWire, WebTransportFactory>> = {
  'pi-rpc': (ctx) => new PiRpcTransport(ctx),
  acp: (ctx) => new AcpTransport(ctx),
  'claude-stream-json': (ctx) => new ClaudeStreamJsonTransport(ctx),
  'codex-app-server': (ctx) => new CodexAppServerTransport(ctx),
}

export class WebSessionHost {
  private readonly sessions = new Map<string, LiveWebSession>()

  constructor(
    private readonly logger: Logger,
    private readonly callbacks: HostCallbacks = {},
    private readonly spawnProcess: SpawnProcess = defaultSpawnProcess,
    private readonly transports: Readonly<Record<WebSessionWire, WebTransportFactory>> = WEB_TRANSPORTS,
  ) {}

  has(recordId: string): boolean {
    return this.sessions.has(recordId)
  }

  get(recordId: string): WebSessionSnapshot | null {
    return this.sessions.get(recordId)?.snapshot() ?? null
  }

  async start(input: StartWebSessionInput): Promise<WebSessionSnapshot> {
    const existing = this.sessions.get(input.recordId)
    if (existing) return existing.snapshot()
    const factory = this.transports[input.wire]
    if (!factory) throw new Error(`no Web transport for wire ${String(input.wire)}`)
    const session = new LiveWebSession(
      input,
      this.spawnProcess(input),
      factory,
      this.logger.child({ scope: 'web-session', wsId: input.wsId, recordId: input.recordId, wire: input.wire }),
      {
        onExit: (reason) => {
          if (this.sessions.get(input.recordId) === session) this.sessions.delete(input.recordId)
          this.callbacks.onExit?.(input.recordId, reason)
        },
        onNativeSessionId: (id) => this.callbacks.onNativeSessionId?.(input.recordId, id),
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

  async prompt(recordId: string, message: string): Promise<WebSessionSnapshot> {
    const session = this.require(recordId)
    await session.prompt(message)
    return session.snapshot()
  }

  async abort(recordId: string): Promise<WebSessionSnapshot> {
    const session = this.require(recordId)
    await session.abort()
    return session.snapshot()
  }

  async respond(recordId: string, requestId: string, optionId: string, text?: string): Promise<WebSessionSnapshot> {
    const session = this.require(recordId)
    await session.respond(requestId, optionId, text)
    return session.snapshot()
  }

  async stop(recordId: string, reason = 'stopped'): Promise<boolean> {
    const session = this.sessions.get(recordId)
    if (!session) return false
    await session.stop(reason)
    if (this.sessions.get(recordId) === session) this.sessions.delete(recordId)
    return true
  }

  async stopAll(reason = 'host disposed'): Promise<void> {
    const sessions = Array.from(this.sessions.values())
    this.sessions.clear()
    await Promise.allSettled(sessions.map((session) => session.stop(reason)))
  }

  private require(recordId: string): LiveWebSession {
    const session = this.sessions.get(recordId)
    if (!session) throw new Error(`Web session is not running: ${recordId}`)
    return session
  }
}

class LiveWebSession {
  private readonly state: WebSessionState
  private readonly channel: ChildJsonlChannel
  private readonly transport: WebSessionTransport
  private stderrTail = ''
  private intentionalStop = false
  private exited = false
  private startupComplete = false
  private readonly startedAt = Date.now()

  constructor(
    private readonly input: StartWebSessionInput,
    private readonly child: WebSessionProcess,
    factory: WebTransportFactory,
    private readonly logger: Logger,
    private readonly callbacks: {
      onExit: (reason: WebSessionExitReason) => void
      onNativeSessionId: (id: string) => void
    },
  ) {
    let lastNativeId: string | null = input.nativeSessionId ?? null
    this.state = new WebSessionState(() => {
      if (this.state.nativeSessionId && this.state.nativeSessionId !== lastNativeId) {
        lastNativeId = this.state.nativeSessionId
        this.callbacks.onNativeSessionId(lastNativeId)
      }
    })
    if (input.nativeSessionId) this.state.nativeSessionId = input.nativeSessionId
    this.channel = new ChildJsonlChannel(child, logger)
    this.transport = factory({ input, state: this.state, channel: this.channel, logger })
  }

  async start(): Promise<void> {
    this.child.stderr.on('data', (chunk: Buffer) => this.onStderr(chunk))
    this.child.on('error', (error) => this.fail(error))
    this.child.once('exit', (code, signal) => this.handleExit(code, signal))
    this.channel.attach()
    await new Promise<void>((resolve, reject) => {
      this.child.once('spawn', resolve)
      this.child.once('error', reject)
    })
    this.logger.info('web_session.started', { pid: this.child.pid ?? null, command: this.input.command })
    try {
      await this.transport.start()
    } catch (error) {
      // Transport disposal rejects its handshake waiters with a generic
      // "session stopped" error. Preserve the child process diagnostic.
      if (this.exited) throw new Error(this.state.error ?? 'Web session process exited during startup')
      throw error
    }
    if (this.exited) throw new Error(this.state.error ?? 'Web session process exited during startup')
    if (this.state.phase === 'starting') this.state.setPhase('idle')
    this.startupComplete = true
  }

  snapshot(): WebSessionSnapshot {
    return {
      recordId: this.input.recordId,
      wsId: this.input.wsId,
      resumeId: this.input.resumeId,
      agent: this.input.agent,
      wire: this.input.wire,
      nativeSessionId: this.state.nativeSessionId,
      pid: this.exited ? null : this.child.pid ?? null,
      startedAt: this.startedAt,
      phase: this.state.phase,
      messages: this.state.messages,
      streamingMessage: this.state.streamingMessage,
      requests: this.state.requests,
      error: this.state.error,
      stderrTail: this.stderrTail,
      revision: this.state.revision,
    }
  }

  prompt(message: string): Promise<void> {
    this.assertLive()
    return this.transport.prompt(message)
  }

  abort(): Promise<void> {
    this.assertLive()
    return this.transport.abort()
  }

  respond(requestId: string, optionId: string, text?: string): Promise<void> {
    this.assertLive()
    const request = this.state.requests.find((entry) => entry.id === requestId)
    if (text !== undefined && (request?.kind !== 'question' || !request.allowText || optionId !== '' || !text.trim())) {
      return Promise.reject(new Error('This request does not accept this text answer'))
    }
    return this.transport.respond(requestId, optionId, text)
  }

  async stop(reason: string): Promise<void> {
    if (this.exited) return
    this.intentionalStop = true
    this.logger.info('web_session.stopping', { reason })
    try {
      this.transport.dispose?.()
    } catch (error) {
      this.logger.warn('web_session.dispose_failed', { error })
    }
    this.channel.close()
    this.child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolve) => this.child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
    ])
    if (!this.exited) {
      const exit = new Promise<void>((resolve) => this.child.once('exit', () => resolve()))
      this.child.kill('SIGKILL')
      let timer: ReturnType<typeof setTimeout> | undefined
      try {
        await Promise.race([exit, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2_000) })])
      } finally { if (timer) clearTimeout(timer) }
      if (!this.exited) throw new Error('Web process did not exit; background handoff was not started')
    }
  }

  private assertLive(): void {
    if (this.exited) throw new Error(this.state.error ?? 'Web session process exited')
  }

  private onStderr(chunk: Buffer): void {
    this.stderrTail = `${this.stderrTail}${chunk.toString('utf8')}`.slice(-STDERR_MAX_CHARS)
    this.state.bump()
  }

  private fail(error: Error): void {
    this.state.fail(error.message)
    this.logger.error('web_session.failed', { error })
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.exited) return
    this.exited = true
    this.channel.close()
    if (!this.intentionalStop && !this.state.error) {
      const detail = this.stderrTail.trim().slice(-2000)
      this.state.error = `${this.input.agent} exited (code=${String(code)}, signal=${String(signal)})${detail ? `: ${detail}` : ''}`
    }
    try {
      this.transport.dispose?.()
    } catch {
      // The process is already gone; a transport cleanup failure is not actionable.
    }
    this.state.phase = this.intentionalStop ? 'stopped' : 'failed'
    if (!this.intentionalStop && !this.state.error) {
      this.state.error = `${this.input.agent} exited (code=${String(code)}, signal=${String(signal)})`
    }
    this.state.clearRequests()
    this.state.bump()
    this.logger.info('web_session.exited', { code, signal, intentional: this.intentionalStop })
    this.callbacks.onExit({ code, signal, intentional: this.intentionalStop, startupFailed: !this.startupComplete })
  }
}

class ChildJsonlChannel implements JsonlChannel {
  private readonly decoder = new StringDecoder('utf8')
  private buffer = ''
  private handlers: Array<(value: JsonObject) => void> = []
  closed = false

  constructor(private readonly child: WebSessionProcess, private readonly logger: Logger) {}

  attach(): void {
    this.child.stdout.on('data', (chunk: Buffer) => this.onData(chunk))
  }

  send(value: unknown): Promise<void> {
    if (this.closed) return Promise.reject(new Error('process stdin is closed'))
    const line = `${JSON.stringify(value)}\n`
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(line, (error) => (error ? reject(error) : resolve()))
    })
  }

  onMessage(handler: (value: JsonObject) => void): void {
    this.handlers.push(handler)
  }

  close(): void {
    if (this.closed) return
    this.closed = true
    try {
      this.child.stdin.end()
    } catch {
      // stdin may already be destroyed by the exiting process
    }
  }

  private onData(chunk: Buffer): void {
    this.buffer += this.decoder.write(chunk)
    let newline = this.buffer.indexOf('\n')
    while (newline >= 0) {
      const line = this.buffer.slice(0, newline)
      this.buffer = this.buffer.slice(newline + 1)
      this.handleLine(line)
      newline = this.buffer.indexOf('\n')
    }
  }

  private handleLine(raw: string): void {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw
    if (!line.trim()) return
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch (error) {
      // Some runtimes print banners or progress text on stdout before/around
      // their protocol frames; keep them out of the transcript but visible.
      this.logger.warn('web_session.non_json_stdout', { error, line: line.slice(0, 500) })
      return
    }
    if (!isJsonObject(parsed)) return
    for (const handler of this.handlers) {
      try {
        handler(parsed)
      } catch (error) {
        this.logger.error('web_session.handler_failed', { error })
      }
    }
  }
}

function defaultSpawnProcess(input: StartWebSessionInput): WebSessionProcess {
  const resolved = resolveLaunchCommand(input.command, { env: input.env, cwd: input.cwd })
  const [file, ...args] = resolved.argv
  if (!file) throw new Error('Web session command is empty')
  return spawn(file, args, {
    cwd: input.cwd,
    env: { ...input.env },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}
