/**
 * OpenAlice-owned resumable conversation identities.
 *
 * Product surfaces exchange `resumeId`; native runtime session ids never cross
 * the backend boundary. This registry is the translation table between that
 * stable product identity and the current CLI-specific conversation id.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

import type { Logger } from './logger.js'
import { generateResumeId } from './resume-id.js'

export interface ResumeIdentityRecord {
  readonly resumeId: string
  readonly wsId: string
  readonly agent: string
  agentSessionId?: string
  latestTaskId?: string
  readonly createdAt: number
  updatedAt: number
  /** Product employment state. Native transcript history is retained either way. */
  lifecycle: 'active' | 'retired'
  retiredAt?: number
  retirementReason?: string
  successorResumeId?: string
}

export class ResumeRegistry {
  private readonly records = new Map<string, ResumeIdentityRecord>()
  private flushChain: Promise<void> = Promise.resolve()

  private constructor(
    private readonly path: string,
    private readonly logger: Logger,
  ) {}

  static async load(path: string, logger: Logger): Promise<ResumeRegistry> {
    const registry = new ResumeRegistry(path, logger)
    await registry.read()
    return registry
  }

  private async read(): Promise<void> {
    try {
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { version?: unknown; records?: unknown }
      if (parsed.version !== 1 || !Array.isArray(parsed.records)) {
        throw new Error('resume-identities.json has an unsupported shape')
      }
      for (const value of parsed.records) {
        if (!value || typeof value !== 'object') throw new Error('resume-identities.json contains an invalid record')
        const record = value as Record<string, unknown>
        if (
          typeof record['resumeId'] !== 'string' ||
          typeof record['wsId'] !== 'string' ||
          typeof record['agent'] !== 'string' ||
          typeof record['createdAt'] !== 'number' ||
          typeof record['updatedAt'] !== 'number'
        ) throw new Error('resume-identities.json contains an invalid record')
        this.records.set(record['resumeId'], {
          resumeId: record['resumeId'],
          wsId: record['wsId'],
          agent: record['agent'],
          createdAt: record['createdAt'],
          updatedAt: record['updatedAt'],
          lifecycle: record['lifecycle'] === 'retired' ? 'retired' : 'active',
          ...(typeof record['agentSessionId'] === 'string'
            ? { agentSessionId: record['agentSessionId'] }
            : {}),
          ...(typeof record['latestTaskId'] === 'string'
            ? { latestTaskId: record['latestTaskId'] }
            : {}),
          ...(typeof record['retiredAt'] === 'number'
            ? { retiredAt: record['retiredAt'] }
            : {}),
          ...(typeof record['retirementReason'] === 'string'
            ? { retirementReason: record['retirementReason'] }
            : {}),
          ...(typeof record['successorResumeId'] === 'string'
            ? { successorResumeId: record['successorResumeId'] }
            : {}),
        })
      }
    } catch (err) {
      // Migration creates the file for existing installs. A fresh install has
      // no identities until its first conversation is created.
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return
      this.logger.error('resume_registry.read_failed', { path: this.path, err })
      // Resume identities are the durable employment/signature ledger. A
      // malformed file must stop startup instead of silently making every
      // coworker appear new and severing provenance links.
      throw err
    }
  }

  get(resumeId: string): ResumeIdentityRecord | null {
    return this.records.get(resumeId) ?? null
  }

  /** Backend records newest-first. Callers must project them before crossing an
   * API/tool boundary because records also carry the native runtime mapping. */
  list(opts: { wsId?: string; limit?: number } = {}): ResumeIdentityRecord[] {
    const records = [...this.records.values()]
      .filter((record) => !opts.wsId || record.wsId === opts.wsId)
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return opts.limit && opts.limit > 0 ? records.slice(0, opts.limit) : records
  }

  async ensure(input: {
    resumeId?: string
    wsId: string
    agent: string
    agentSessionId?: string
    latestTaskId?: string
    now?: number
  }): Promise<ResumeIdentityRecord> {
    const resumeId = input.resumeId ?? generateResumeId({
      isTaken: (candidate) => this.records.has(candidate),
    })
    const existing = this.records.get(resumeId)
    if (existing) {
      if (existing.wsId !== input.wsId || existing.agent !== input.agent) {
        throw new Error(`resume identity ${resumeId} belongs to ${existing.wsId}/${existing.agent}`)
      }
      if (existing.lifecycle === 'retired') {
        throw new Error(`resume identity ${resumeId} is retired`)
      }
      if (input.agentSessionId) existing.agentSessionId = input.agentSessionId
      if (input.latestTaskId) existing.latestTaskId = input.latestTaskId
      existing.updatedAt = input.now ?? Date.now()
      await this.flush()
      return existing
    }
    const now = input.now ?? Date.now()
    const record: ResumeIdentityRecord = {
      resumeId,
      wsId: input.wsId,
      agent: input.agent,
      createdAt: now,
      updatedAt: now,
      lifecycle: 'active',
      ...(input.agentSessionId ? { agentSessionId: input.agentSessionId } : {}),
      ...(input.latestTaskId ? { latestTaskId: input.latestTaskId } : {}),
    }
    this.records.set(resumeId, record)
    await this.flush()
    return record
  }

  async bindAgentSessionId(resumeId: string, agentSessionId: string): Promise<void> {
    const record = this.records.get(resumeId)
    if (!record || record.agentSessionId === agentSessionId) return
    record.agentSessionId = agentSessionId
    record.updatedAt = Date.now()
    await this.flush()
  }

  async retireWorkspace(
    wsId: string,
    input: { reason: string; successors?: Readonly<Record<string, string>>; now?: number },
  ): Promise<ResumeIdentityRecord[]> {
    const now = input.now ?? Date.now()
    const changed: ResumeIdentityRecord[] = []
    for (const record of this.records.values()) {
      if (record.wsId !== wsId) continue
      record.lifecycle = 'retired'
      record.retiredAt = now
      record.retirementReason = input.reason
      const successor = input.successors?.[record.resumeId]
      if (successor) record.successorResumeId = successor
      record.updatedAt = now
      changed.push(record)
    }
    if (changed.length > 0) await this.flush()
    return changed
  }

  /** Restore the old coworkers with their old signatures and native mappings. */
  async recallWorkspace(wsId: string, now = Date.now()): Promise<ResumeIdentityRecord[]> {
    const changed: ResumeIdentityRecord[] = []
    for (const record of this.records.values()) {
      if (record.wsId !== wsId || record.lifecycle !== 'retired') continue
      record.lifecycle = 'active'
      delete record.retiredAt
      delete record.retirementReason
      delete record.successorResumeId
      record.updatedAt = now
      changed.push(record)
    }
    if (changed.length > 0) await this.flush()
    return changed
  }

  private async flush(): Promise<void> {
    const next = this.flushChain.then(() => this.flushNow())
    this.flushChain = next.catch(() => undefined)
    await next
  }

  private async flushNow(): Promise<void> {
    try {
      await mkdir(dirname(this.path), { recursive: true })
      const tmp = `${this.path}.tmp`
      await writeFile(tmp, JSON.stringify({ version: 1, records: [...this.records.values()] }, null, 2), 'utf8')
      await rename(tmp, this.path)
    } catch (err) {
      this.logger.warn('resume_registry.flush_failed', { err })
      // Callers such as Workspace offboarding depend on retirement being
      // durable before the Catalog transition is committed.
      throw err
    }
  }
}
