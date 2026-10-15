import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import type { ExecutionOrigin } from './session-execution-manager.js'

const actorSchema = z.object({ kind: z.enum(['user', 'issue', 'schedule', 'connector', 'session', 'system']), entry: z.string().min(1), workspaceId: z.string().optional(), resumeId: z.string().optional(), taskId: z.string().optional(), issueId: z.string().optional(), connectorId: z.string().optional() }).strict()
const blockSchema = z.object({
  id: z.string(), resumeId: z.string(), kind: z.enum(['user-cooldown', 'execution-fault']),
  createdAt: z.number(), expiresAt: z.number().optional(), executionId: z.string(),
  actor: actorSchema, reason: z.string(), releasedAt: z.number().optional(), releasedBy: actorSchema.optional(),
}).strict()
export type SessionBlock = z.infer<typeof blockSchema>
const stateSchema = z.object({ version: z.literal(1), cooldownSeconds: z.number().int().min(10).max(86400), blocks: z.array(blockSchema), failures: z.record(z.string(), z.number().int().nonnegative()) }).strict()

export class SessionAdmissionError extends Error {
  readonly code = 'session_blocked'
  readonly retryAt?: number
  constructor(readonly blocks: SessionBlock[]) {
    super(blocks.map(block => block.reason).join('; '))
    this.name = 'SessionAdmissionError'
    if (blocks.length && blocks.every(block => block.expiresAt !== undefined)) this.retryAt = Math.max(...blocks.map(block => block.expiresAt!))
  }
}

/** Session-owned launch policy. It does not dispatch, retry or advance schedules. */
export class SessionAdmission {
  private state: z.infer<typeof stateSchema> = { version: 1, cooldownSeconds: 600, blocks: [], failures: {} }
  private writes = Promise.resolve()
  private constructor(private readonly file: string) {}
  static async open(file: string) {
    const policy = new SessionAdmission(file)
    try { policy.state = stateSchema.parse(JSON.parse(await readFile(file, 'utf8'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    return policy
  }
  get cooldownSeconds() { return this.state.cooldownSeconds }
  blocks(resumeId: string, now = Date.now()) {
    return structuredClone(this.state.blocks.filter(block => block.resumeId === resumeId && !block.releasedAt && (block.expiresAt === undefined || block.expiresAt > now)))
  }
  assertAllowed(resumeId: string) {
    const blocks = this.blocks(resumeId)
    if (blocks.length) throw new SessionAdmissionError(blocks)
  }
  async configure(seconds: number, actor: ExecutionOrigin) {
    this.assertUser(actor)
    this.state.cooldownSeconds = stateSchema.shape.cooldownSeconds.parse(seconds)
    await this.persist()
  }
  async cooldown(resumeId: string, executionId: string, actor: ExecutionOrigin) {
    this.assertUser(actor)
    if (this.state.blocks.some(block => block.executionId === executionId && block.kind === 'user-cooldown')) return
    const now = Date.now()
    this.state.blocks.push({ id: randomUUID(), resumeId, executionId, kind: 'user-cooldown', createdAt: now,
      expiresAt: now + this.cooldownSeconds * 1000, actor: actorSchema.parse(actor), reason: 'User interrupted this Session; new starts are cooling down.' })
    await this.persist()
  }
  async outcome(resumeId: string, executionId: string, failed: boolean, reason: string) {
    this.state.failures[resumeId] = failed ? (this.state.failures[resumeId] ?? 0) + 1 : 0
    if (this.state.failures[resumeId] >= 3 && !this.blocks(resumeId).some(block => block.kind === 'execution-fault')) {
      this.state.blocks.push({ id: randomUUID(), resumeId, executionId, kind: 'execution-fault', createdAt: Date.now(),
        actor: { kind: 'system', entry: 'session-failure-policy' }, reason: `Three consecutive executions failed. Review the failure before allowing another start (${reason}).` })
    }
    await this.persist()
  }
  async release(resumeId: string, id: string, actor: ExecutionOrigin) {
    this.assertUser(actor)
    const block = this.state.blocks.find(row => row.resumeId === resumeId && row.id === id)
    if (!block) throw new Error('Session block not found')
    if (block.releasedAt) return
    block.releasedAt = Date.now(); block.releasedBy = actorSchema.parse(actor)
    if (block.kind === 'execution-fault') this.state.failures[resumeId] = 0
    await this.persist()
  }
  private assertUser(actor: ExecutionOrigin) {
    actorSchema.parse(actor)
    if (actor.kind !== 'user') throw new Error('Only an explicit user action may release or configure Session launch blocks')
  }
  private persist() {
    const body = JSON.stringify(this.state, null, 2)
    const write = this.writes.catch(() => {}).then(async () => {
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(`${this.file}.tmp`, body, 'utf8')
      await rename(`${this.file}.tmp`, this.file)
    })
    this.writes = write
    return write
  }
}
