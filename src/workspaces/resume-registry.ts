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
      const parsed = JSON.parse(await readFile(this.path, 'utf8')) as { records?: unknown[] }
      for (const value of Array.isArray(parsed.records) ? parsed.records : []) {
        if (!value || typeof value !== 'object') continue
        const record = value as Record<string, unknown>
        if (
          typeof record['resumeId'] !== 'string' ||
          typeof record['wsId'] !== 'string' ||
          typeof record['agent'] !== 'string' ||
          typeof record['createdAt'] !== 'number' ||
          typeof record['updatedAt'] !== 'number'
        ) continue
        this.records.set(record['resumeId'], {
          resumeId: record['resumeId'],
          wsId: record['wsId'],
          agent: record['agent'],
          createdAt: record['createdAt'],
          updatedAt: record['updatedAt'],
          ...(typeof record['agentSessionId'] === 'string'
            ? { agentSessionId: record['agentSessionId'] }
            : {}),
          ...(typeof record['latestTaskId'] === 'string'
            ? { latestTaskId: record['latestTaskId'] }
            : {}),
        })
      }
    } catch {
      // Migration creates the file for existing installs. A fresh install has
      // no identities until its first conversation is created.
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
    }
  }
}
