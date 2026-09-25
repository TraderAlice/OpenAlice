import { SessionTerminationError } from './session-process-stop.js'
import { SessionAdmission } from './session-admission.js'
import { SessionTakeovers } from './session-takeover.js'
import { z } from 'zod'
import type { SessionRecord } from './session-registry.js'
import type { SessionRuntimeBinding } from './cli-adapter.js'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type ExecutionPhase = 'starting' | 'running' | 'stopping' | 'ended' | 'failed' | 'interrupted'
export type ExecutionSurface = 'terminal' | 'webpi' | 'headless'
export interface ExecutionOrigin {
  kind: 'user' | 'issue' | 'schedule' | 'connector' | 'session' | 'system'
  /** Concrete entry point, not a guessed attribution from a Session title. */
  entry: string
  workspaceId?: string
  resumeId?: string
  taskId?: string
  issueId?: string
  connectorId?: string
}
export interface ExecutionRequest {
  workspaceId: string
  resumeId: string
  recordId: string
  agent: string
  taskId?: string
  surface: ExecutionSurface
  intent: 'fresh' | 'resume' | 'reconfigure' | 'handoff' | 'probe'
  origin: ExecutionOrigin
  /** Secret-free resolved selection only; never argv, environment or a prompt. */
  configuration: { credentialSource: string; credentialSlug?: string; model?: string; effort?: string }
}
export interface ExecutionRecord extends ExecutionRequest {
  executionId: string
  phase: ExecutionPhase
  requestedAt: number
  startedAt?: number
  finishedAt?: number
  pid?: number
  taskId?: string
  activity?: string
  reason?: string
  interruption?: { requestedAt: number; actor: ExecutionOrigin; reason: string }
  stopError?: string
  events: Array<{ phase: ExecutionPhase; at: number; reason?: string; activity?: string }>
}
export interface ExecutionDriver<T> {
  /** Returning means the process is ready, not merely that spawn was requested. */
  start(report: (activity: string) => Promise<void>, signal: AbortSignal): Promise<{ value: T; pid?: number; taskId?: string; completed: Promise<{ reason: string; failed?: boolean; interrupted?: boolean }> }>
  /** Resolves only after the process has exited. Also used after partial startup. */
  stop(reason: string): Promise<void>
}
const textField = z.string().trim().min(1).max(256)
const requestSchema = z.object({
  workspaceId: textField, resumeId: textField, recordId: textField, agent: textField, taskId: textField.optional(),
  surface: z.enum(['terminal', 'webpi', 'headless']),
  intent: z.enum(['fresh', 'resume', 'reconfigure', 'handoff', 'probe']),
  origin: z.object({
    kind: z.enum(['user', 'issue', 'schedule', 'connector', 'session', 'system']), entry: textField,
    workspaceId: textField.optional(), resumeId: textField.optional(), taskId: textField.optional(),
    issueId: textField.optional(), connectorId: textField.optional(),
  }).strict(),
  configuration: z.object({ credentialSource: textField, credentialSlug: textField.optional(), model: textField.optional(), effort: textField.optional() }).strict(),
}).strict()
const phaseSchema = z.enum(['starting', 'running', 'stopping', 'ended', 'failed', 'interrupted'])
const recordSchema = requestSchema.extend({
  executionId: textField, phase: phaseSchema, requestedAt: z.number().finite(),
  startedAt: z.number().finite().optional(), finishedAt: z.number().finite().optional(),
  pid: z.number().int().positive().optional(), taskId: textField.optional(),
  activity: textField.optional(), reason: textField.optional(),
  interruption: z.object({ requestedAt: z.number(), actor: requestSchema.shape.origin, reason: textField }).strict().optional(),
  stopError: z.string().optional(),
  events: z.array(z.object({ phase: phaseSchema, at: z.number().finite(), reason: textField.optional(), activity: textField.optional() }).strict()),
}).strict()
const terminal = (phase: ExecutionPhase) => phase === 'ended' || phase === 'failed' || phase === 'interrupted'

/** Sole admission and state authority for a product Session execution. */
export class SessionExecutionManager {
  takeovers!: SessionTakeovers
  admission!: SessionAdmission
  private readonly records = new Map<string, ExecutionRecord>()
  private readonly active = new Map<string, { record: ExecutionRecord; stop: (reason: string) => Promise<void>; controller: AbortController; stopping?: Promise<boolean> }>()
  private readonly locks = new Map<string, Promise<void>>()
  private readonly completions = new Map<string, Promise<void>>()
  private closing = false
  private fault: Error | undefined
  private writes: Promise<void> = Promise.resolve()

  private constructor(private readonly file: string, private readonly project: (record: ExecutionRecord) => Promise<void>) {}

  static async open(file: string, project: (record: ExecutionRecord) => Promise<void>) {
    const manager = new SessionExecutionManager(file, project)
    manager.admission = await SessionAdmission.open(`${file}.admission.json`)
    manager.takeovers = await SessionTakeovers.open(`${file}.takeovers.json`, id => manager.active.get(id)?.record, (id, reason) => manager.stop(id, reason), id => manager.admission.assertAllowed(id))
    let data: { version: number; records: ExecutionRecord[] }
    try { data = JSON.parse(await readFile(file, 'utf8')) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; return manager }
    data = z.object({ version: z.literal(1), records: z.array(recordSchema) }).strict().parse(data)
    for (const record of data.records) {
      if (!record.executionId || !record.resumeId || !record.origin?.entry) throw new Error('Invalid Session execution record')
      manager.records.set(record.executionId, record)
      if (!terminal(record.phase)) {
        record.phase = 'interrupted'
        record.finishedAt = Date.now()
        record.reason = 'owner-restarted'
        record.events.push({ phase: 'interrupted', at: record.finishedAt, reason: record.reason })
        await project(record)
      }
    }
    await manager.persist()
    return manager
  }

  /** Boot-only repair of roster ownership predating or interrupted before journal projection. */
  async recoverOrphans(roster: readonly SessionRecord[]): Promise<void> {
    for (const row of roster) {
      if (row.state !== 'running') continue;
      const record: ExecutionRecord = {
        executionId: randomUUID(), workspaceId: row.wsId, recordId: row.id, resumeId: row.resumeId,
        agent: row.agent, surface: row.surface ?? 'terminal', intent: 'resume',
        origin: { kind: 'system', entry: 'startup-reconciliation' },
        configuration: { credentialSource: 'unknown' },
        phase: 'interrupted', requestedAt: Date.now(), finishedAt: Date.now(), reason: 'orphaned-owner',
        events: [{ phase: 'interrupted', at: Date.now(), reason: 'orphaned-owner' }],
      };
      this.records.set(record.executionId, record);
      await this.persist();
      await this.project(record);
    }
  }

  list(resumeId?: string): ExecutionRecord[] {
    return structuredClone([...this.records.values()].filter(row => !resumeId || row.resumeId === resumeId))
  }

  async start<T>(request: ExecutionRequest, driver: ExecutionDriver<T>): Promise<T> {
    request = requestSchema.parse(request)
    if (this.closing) throw new Error('Session execution manager is shutting down')
    if (this.fault) throw new Error('Session execution journal is unavailable', { cause: this.fault })
    if (request.surface !== 'headless' && this.takeovers.isHandingOff(request.resumeId)) throw new Error('Session handoff is in progress')
    this.admission.assertAllowed(request.resumeId)
    if (this.locks.has(request.resumeId) || this.active.has(request.resumeId)) throw new Error('Session execution is busy')
    const release = this.lock(request.resumeId)
    const record: ExecutionRecord = { ...structuredClone(request), executionId: randomUUID(), phase: 'starting', requestedAt: Date.now(), events: [] }
    this.records.set(record.executionId, record)
    const controller = new AbortController()
    this.active.set(record.resumeId, { record, stop: driver.stop, controller })
    let cancel!: (error: Error) => void
    const canceled = new Promise<never>((_, reject) => { cancel = reject })
    void canceled.catch(() => {})
    controller.signal.addEventListener('abort', () => cancel(new Error('Session startup interrupted')), { once: true })
    try {
      await this.transition(record, 'starting')
      controller.signal.throwIfAborted()
      this.admission.assertAllowed(request.resumeId)
      const startup = driver.start(async activity => {
        if (this.active.get(record.resumeId)?.record !== record || terminal(record.phase)) return
        activity = textField.parse(activity)
        if (record.activity === activity) return
        record.activity = activity
        record.events.push({ phase: record.phase, at: Date.now(), activity })
        await this.persist()
      }, controller.signal)
      void startup.then(async () => { if (controller.signal.aborted && this.active.get(record.resumeId)?.record === record) await driver.stop(record.reason ?? 'interrupted') }).catch(() => {})
      const launched = await Promise.race([startup, canceled])
      controller.signal.throwIfAborted()
      record.pid = launched.pid
      record.taskId = launched.taskId ?? request.taskId
      record.startedAt = Date.now()
      await this.transition(record, 'running')
      controller.signal.throwIfAborted()
      const completion = launched.completed.then(
        result => this.finish(record, result.interrupted ? 'interrupted' : result.failed ? 'failed' : 'ended', result.reason),
        async error => {
          if (error instanceof SessionTerminationError) {
            record.stopError = error.message
            await this.transition(record, 'stopping', 'termination-unconfirmed')
          } else await this.finish(record, 'failed', 'execution-failed')
        },
      );
      this.completions.set(record.resumeId, completion);
      void completion.catch(error => { this.fault = error instanceof Error ? error : new Error('Execution projection failed'); console.error('session_execution.completion_failed', { executionId: record.executionId }); }).finally(() => { if (this.completions.get(record.resumeId) === completion) this.completions.delete(record.resumeId) })
      return launched.value
    } catch (error) {
      if (controller.signal.aborted) throw error
      try { await driver.stop('startup-failed') }
      catch { await this.transition(record, 'stopping', 'startup-cleanup-failed'); throw error }
      await this.finish(record, 'failed', 'startup-failed')
      throw error
    } finally { release() }
  }

  /** One-shot process driver shared by background turns and diagnostic probes. */
  async run<T>(request: ExecutionRequest, spawn: (ready: (pid?: number) => void, signal: AbortSignal) => Promise<T>, classify: (value: T) => { reason: string; failed?: boolean; interrupted?: boolean }): Promise<T> {
    let result: Promise<T> | undefined
    let ready!: (value: { pid?: number } | null) => void
    const spawned = new Promise<{ pid?: number } | null>(resolve => { ready = resolve })
    const running = await this.start(request, {
      start: async (_report, signal) => {
        signal.throwIfAborted()
        result = spawn(pid => { ready({ pid }) }, signal)
        void result.then(() => ready(null), () => ready(null))
        const process = await spawned
        if (!process) { await result; throw new Error('Process did not start') }
        return { value: { result }, pid: process.pid, completed: result.then(classify) }
      },
      stop: async () => { await result?.catch(async error => { if (error instanceof SessionTerminationError) { await error.retry() } }) },
    })
    const value = await running.result
    await this.completions.get(request.resumeId)
    return value
  }

  current(resumeId: string) { return structuredClone(this.active.get(resumeId)?.record ?? null) }

  async interrupt(resumeId: string, executionId: string, actor: ExecutionOrigin): Promise<boolean> {
    actor = validateExecutionOrigin(actor)
    const record = this.records.get(executionId)
    if (!record || record.resumeId !== resumeId) throw new Error('Execution not found')
    if (terminal(record.phase)) return false
    if (this.active.get(resumeId)?.record !== record) throw new Error('Execution changed; refresh before interrupting')
    if (!record.interruption) record.interruption = { requestedAt: Date.now(), actor, reason: actor.kind === 'user' ? 'user-interrupted' : 'system-interrupted' }
    record.reason = record.interruption.reason
    // Install the block before yielding, so queued/new starts cannot race the stop.
    const blocked = actor.kind === 'user' ? this.admission.cooldown(resumeId, executionId, actor) : Promise.resolve()
    this.takeovers.cancel(resumeId)
    const stopped = this.stop(resumeId, record.interruption.reason, 'interrupted')
    const results = await Promise.allSettled([blocked, stopped])
    for (const result of results) if (result.status === 'rejected') throw result.reason
    return (results[1] as PromiseFulfilledResult<boolean>).value
  }

  async stop(resumeId: string, reason: string, outcome: 'ended' | 'interrupted' = 'ended'): Promise<boolean> {
    if (!reason.trim()) throw new Error('Stop reason is required')
    const entry = this.active.get(resumeId)
    if (!entry || terminal(entry.record.phase)) return false
    if (entry.stopping) return entry.stopping
    // Do not wait on the startup lock: cancellation is the escape hatch for a hung handshake.
    entry.controller.abort(reason)
    entry.record.phase = 'stopping'
    entry.record.reason = reason
    entry.stopping = (async () => {
      let journalError: unknown
      const journal = this.transition(entry.record, 'stopping', reason).catch(error => { journalError = error })
      let timeout: NodeJS.Timeout | undefined
      try {
        await Promise.race([entry.stop(reason), new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Process exit is unconfirmed; Session remains occupied')), 15_000)
        })])
        delete entry.record.stopError
      }
      catch (error) {
        entry.record.stopError = String(error)
        await this.persist().catch(() => {})
        throw error
      } finally { if (timeout) clearTimeout(timeout) }
      await journal
      try { await this.finish(entry.record, entry.record.interruption ? 'interrupted' : outcome, reason, true) } catch (error) { journalError ??= error }
      if (journalError) {
        this.fault = journalError instanceof Error ? journalError : new Error('Execution journal unavailable')
        this.active.delete(resumeId)
        this.completions.delete(resumeId)
        throw new Error('Process stopped but its execution journal could not be updated', { cause: this.fault })
      }
      return true
    })()
    try { return await entry.stopping } finally { entry.stopping = undefined }
  }

  async stopAll(reason: string) {
    this.closing = true
    const takeoverErrors: unknown[] = []
    try { await this.takeovers.close() } catch (error) { takeoverErrors.push(error) }
    const results = await Promise.allSettled([...this.active.keys()].map(id => this.stop(id, reason)))
    if (!results.some(result => result.status === 'rejected')) await Promise.all(this.completions.values())
    const errors = [...takeoverErrors, ...results.filter(row => row.status === 'rejected').map(row => (row as PromiseRejectedResult).reason)]
    if (errors.length) throw new AggregateError(errors, 'Session shutdown failed')
  }

  private lock(resumeId: string): () => void {
    let resolve!: () => void
    this.locks.set(resumeId, new Promise<void>(done => { resolve = done }))
    return () => { this.locks.delete(resumeId); resolve() }
  }

  private async finish(record: ExecutionRecord, phase: 'ended' | 'failed' | 'interrupted', reason: string, explicit = false) {
    if (this.active.get(record.resumeId)?.record !== record || terminal(record.phase)) return
    // An explicit stop owns the completion reason; a natural callback cannot race it.
    if (record.phase === 'stopping' && !explicit) return
    if (phase === 'failed' || (phase === 'ended' && !explicit)) await this.admission.outcome(record.resumeId, record.executionId, phase === 'failed', reason)
    if (record.phase === 'stopping' && !explicit) return
    await this.transition(record, phase, record.phase === 'stopping' ? record.reason ?? reason : reason)
    if (this.active.get(record.resumeId)?.record === record) {
      this.active.delete(record.resumeId)
      this.completions.delete(record.resumeId)
    }
  }

  private async transition(record: ExecutionRecord, phase: ExecutionPhase, reason?: string) {
    record.phase = phase
    if (reason) record.reason = reason
    if (terminal(phase)) record.finishedAt = Date.now()
    record.events.push({ phase, at: Date.now(), ...(reason ? { reason } : {}) })
    await this.persist()
    await this.project(structuredClone(record))
  }

  private persist(): Promise<void> {
    const body = JSON.stringify({ version: 1, records: [...this.records.values()] }, null, 2)
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      const temporary = `${this.file}.tmp`
      await writeFile(temporary, body, 'utf8')
      await rename(temporary, this.file)
    })
    this.writes = write
    return write
  }
}

/** Whitelist only selection metadata; resolved credentials must never reach the journal. */
export function executionConfiguration(binding?: SessionRuntimeBinding): ExecutionRequest['configuration'] {
  return {
    credentialSource: binding?.credential.source ?? 'native',
    ...(binding?.credential.source === 'vault' ? { credentialSlug: binding.credential.credentialSlug } : {}),
    ...(binding?.model ? { model: binding.model } : {}),
    ...(binding?.reasoningEffort ? { effort: binding.reasoningEffort } : {}),
  }
}

export function validateExecutionOrigin(origin: ExecutionOrigin): ExecutionOrigin {
  return requestSchema.shape.origin.parse(origin)
}
