import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { ExecutionOrigin, ExecutionRecord } from './session-execution-manager.js'

export interface SessionTakeover {
  id: string
  workspaceId: string
  recordId: string
  resumeId: string
  origin: ExecutionOrigin
  requestedAt: number
  idleSeconds: number
  deadline: number
  state: 'pending' | 'waiting-idle' | 'handoff' | 'running' | 'completed' | 'rejected' | 'canceled' | 'failed'
  blocker?: 'working' | 'terminal' | 'queued'
  decidedAt?: number
  decision?: 'approved' | 'idle-timeout' | 'rejected' | 'owner-restarted' | 'shutdown' | 'unoccupied'
}
export class SessionTakeoverDeclinedError extends Error {
  constructor() { super('Session takeover declined by the user'); this.name = 'SessionTakeoverDeclinedError' }
}
const text = z.string().min(1).max(256)
const journalSchema = z.object({
  version: z.literal(1), idleSeconds: z.number().int().min(10).max(3600),
  requests: z.array(z.object({
    id: text, workspaceId: text, recordId: text, resumeId: text,
    origin: z.object({ kind: z.enum(['user', 'issue', 'schedule', 'connector', 'session', 'system']), entry: text,
      workspaceId: text.optional(), resumeId: text.optional(), taskId: text.optional(), issueId: text.optional(), connectorId: text.optional() }).strict(),
    requestedAt: z.number().finite(), idleSeconds: z.number().finite().nonnegative(), deadline: z.number().finite(),
    state: z.enum(['pending', 'waiting-idle', 'handoff', 'running', 'completed', 'rejected', 'canceled', 'failed']),
    blocker: z.enum(['working', 'terminal', 'queued']).optional(), decidedAt: z.number().finite().optional(),
    decision: z.enum(['approved', 'idle-timeout', 'rejected', 'owner-restarted', 'shutdown', 'unoccupied']).optional(),
  }).strict()),
}).strict()
type Entry = { row: SessionTakeover; approved: boolean; resolve: (release: () => void) => void; reject: (error: Error) => void }
const pending = (row: SessionTakeover) => ['pending', 'waiting-idle', 'handoff', 'running'].includes(row.state)

/** An internal part of the execution authority, never a second process launcher. */
export class SessionTakeovers {
  idleSeconds = 60
  private rows: SessionTakeover[] = []
  private entries: Entry[] = []
  private timer?: ReturnType<typeof setInterval>
  private ticking = false
  private closed = false
  private writes = Promise.resolve()
  private fault?: Error
  private constructor(private readonly file: string, private readonly current: (id: string) => ExecutionRecord | undefined,
    private readonly stop: (id: string, reason: string) => Promise<boolean>, private readonly admit: (id: string) => void = () => {}) {}

  static async open(file: string, current: (id: string) => ExecutionRecord | undefined, stop: (id: string, reason: string) => Promise<boolean>, admit: (id: string) => void = () => {}) {
    const value = new SessionTakeovers(file, current, stop, admit)
    try {
      const data = journalSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      value.idleSeconds = data.idleSeconds
      value.rows = data.requests
      for (const row of value.rows) if (pending(row)) { row.state = 'canceled'; row.decision = 'owner-restarted'; row.decidedAt = Date.now() }
      await value.persist()
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return value
  }

  async configure(seconds: number) {
    if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new Error("Idle timeout must be 10–3600 seconds")
    this.idleSeconds = seconds
    await this.persist()
  }
  list() { return structuredClone(this.rows) }
  isHandingOff(resumeId: string) { return this.entries.some(e => e.row.resumeId === resumeId && ['handoff', 'running'].includes(e.row.state)) }
  activity(resumeId: string) {
    for (const e of this.entries) if (e.row.resumeId === resumeId && !e.approved && ['pending', 'waiting-idle'].includes(e.row.state)) {
      e.row.deadline = Date.now() + e.row.idleSeconds * 1000
      e.row.state = 'pending'
    }
  }
  async decide(id: string, decision: 'approve' | 'reject') {
    const entry = this.entries.find(e => e.row.id === id)
    if (!entry || !['pending', 'waiting-idle'].includes(entry.row.state)) throw new Error('Takeover is no longer awaiting a decision')
    entry.row.decidedAt = Date.now()
    if (decision === 'reject') {
      entry.row.state = 'rejected'; entry.row.decision = 'rejected'
      await this.persist()
      this.entries = this.entries.filter(e => e !== entry)
      entry.reject(new SessionTakeoverDeclinedError())
    } else {
      entry.approved = true; entry.row.decision = 'approved'; entry.row.state = 'waiting-idle'
      await this.persist()
    }
    await this.tick()
  }
  async acquire(target: { workspaceId: string; recordId: string; resumeId: string }, origin: ExecutionOrigin, idleSeconds: number): Promise<() => void> {
    this.admit(target.resumeId)
    if (this.closed || this.fault) throw new Error('Session takeover admission unavailable')
    if (origin.resumeId === target.resumeId) throw new Error('A Session cannot request its own takeover')
    if (this.entries.length >= 100) throw new Error('Session takeover queue is full')
    const row: SessionTakeover = { ...target, id: randomUUID(), origin: structuredClone(origin), requestedAt: Date.now(), idleSeconds,
      deadline: Date.now() + idleSeconds * 1000, state: 'pending' }
    const result = new Promise<() => void>((resolve, reject) => { this.entries.push({ row, resolve, reject, approved: false }) })
    // Install a rejection observer before durable admission or shutdown can fail.
    void result.catch(() => {})
    this.rows.push(row)
    try { await this.persist() } catch (error) {
      const entry = this.entries.find(e => e.row === row)!
      this.entries = this.entries.filter(e => e !== entry); entry.reject(error as Error); throw error
    }
    if (!this.timer) { this.timer = setInterval(() => { void this.tick() }, 250); this.timer.unref() }
    void this.tick()
    return result
  }
  cancel(resumeId: string) {
    for (const e of this.entries.filter(e => e.row.resumeId === resumeId)) {
      e.row.state = 'canceled'; e.row.decidedAt = Date.now()
      e.reject(new Error('Session was interrupted; queued request canceled'))
    }
    this.entries = this.entries.filter(e => e.row.resumeId !== resumeId)
    void this.persist().catch(error => { this.fault = error as Error })
  }
  async close() {
    this.closed = true
    if (this.timer) clearInterval(this.timer)
    for (const e of this.entries) {
      e.row.state = 'canceled'; e.row.decision = 'shutdown'; e.row.decidedAt = Date.now()
      e.reject(new Error('Session manager is shutting down'))
    }
    this.entries = []
    await this.persist()
  }
  private async tick() {
    if (this.ticking || this.closed || this.fault) return
    this.ticking = true
    try {
      const seen = new Set<string>()
      for (const e of [...this.entries]) {
        const row = e.row
        if (seen.has(row.resumeId)) { row.blocker = 'queued'; continue }
        seen.add(row.resumeId)
        if (row.state === 'running' || row.state === 'handoff') continue
        try { this.admit(row.resumeId) } catch (error) {
          row.state = 'canceled'; row.decidedAt = Date.now(); e.reject(error as Error)
          this.entries = this.entries.filter(other => other !== e); await this.persist(); continue
        }
        const owner = this.current(row.resumeId)
        if (owner?.surface === 'headless' || (owner && owner.phase !== 'running')) { row.blocker = 'queued'; continue }
        if (owner && !e.approved && Date.now() < row.deadline) { row.state = 'pending'; row.blocker = owner.surface === 'terminal' ? 'terminal' : owner.activity !== 'idle' ? 'working' : undefined; continue }
        if (owner && (owner.surface === 'terminal' ? !e.approved : owner.activity !== 'idle')) {
          row.state = 'waiting-idle'; row.blocker = owner.surface === 'terminal' ? 'terminal' : 'working'; continue
        }
        // This synchronous state change closes input admission before any await.
        row.state = 'handoff'; row.blocker = undefined
        row.decision ??= owner ? 'idle-timeout' : 'unoccupied'; row.decidedAt ??= Date.now()
        void this.handoff(e, owner?.executionId)
      }
    } catch (error) {
      this.fault = error as Error
      for (const e of this.entries) if (e.row.state !== 'running') e.reject(this.fault)
    } finally {
      this.ticking = false
      if (!this.entries.length && this.timer) { clearInterval(this.timer); this.timer = undefined }
    }
  }
  private async handoff(e: Entry, ownerExecutionId?: string) {
    const row = e.row
    try {
      await this.persist()
      if (this.closed || !this.entries.includes(e)) return
      this.admit(row.resumeId)
      // The journal write yields. A GUI turn may have started while the handoff
      // was being recorded, so inspect the live owner once more before stopping it.
      const owner = this.current(row.resumeId)
      if (owner && (owner.executionId !== ownerExecutionId || owner.phase !== 'running'
        || owner.surface === 'headless' || (owner.surface === 'terminal' ? !e.approved : owner.activity !== 'idle'))) {
        row.state = 'waiting-idle'
        row.blocker = owner.executionId !== ownerExecutionId || owner.surface === 'headless' || owner.phase !== 'running'
          ? 'queued' : owner.surface === 'terminal' ? 'terminal' : 'working'
        if (owner.executionId !== ownerExecutionId && !e.approved) row.deadline = Date.now() + row.idleSeconds * 1000
        if (row.decision !== 'approved') { row.decision = undefined; row.decidedAt = undefined }
        await this.persist()
        void this.tick()
        return
      }
      if (owner) await this.stop(row.resumeId, `takeover:${row.id}:${row.decision}`)
      if (this.closed || !this.entries.includes(e)) return
      this.admit(row.resumeId)
      row.state = 'running'; await this.persist()
      let released = false
      e.resolve(() => {
        if (released) return
        released = true
        if (!this.closed && this.entries.includes(e)) row.state = 'completed'
        this.entries = this.entries.filter(item => item !== e)
        void this.persist().catch(() => {})
        void this.tick()
      })
    } catch (error) {
      row.state = 'failed'; this.entries = this.entries.filter(item => item !== e); e.reject(error as Error)
      await this.persist().catch(() => {})
    }
  }
  private persist() {
    const retained = new Set(this.rows.filter(row => !pending(row)).slice(-500).map(row => row.id))
    this.rows = this.rows.filter(row => pending(row) || retained.has(row.id))
    const body = JSON.stringify({ version: 1, idleSeconds: this.idleSeconds, requests: this.rows }, null, 2)
    const write = this.writes.then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, body, 'utf8'); await rename(`${this.file}.tmp`, this.file)
    })
    this.writes = write.catch(error => {
      this.fault = error
      for (const e of this.entries) if (e.row.state !== 'running') { e.row.state = 'failed'; e.reject(error) }
      throw error
    })
    void this.writes.catch(() => {})
    return write
  }
}
