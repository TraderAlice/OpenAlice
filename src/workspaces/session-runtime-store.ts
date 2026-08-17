import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { SessionRuntimeBinding } from './cli-adapter.js'
import { parseSessionRuntimeBinding } from './session-runtime-binding.js'

export const MAX_SESSION_DISPLAY_NAME = 120

export class SessionDisplayNameError extends Error {
  constructor(
    readonly code: 'too_long',
    message: string,
  ) {
    super(message)
    this.name = 'SessionDisplayNameError'
  }
}

export interface SessionDossier {
  readonly version: 1
  readonly resumeId: string
  readonly agent: string
  readonly ai?: SessionRuntimeBinding
  readonly displayName?: string
}

interface SessionRuntimeFile {
  readonly version: 1
  readonly resumeId: string
  readonly agent: string
  readonly ai?: SessionRuntimeBinding
  readonly displayName?: string
}

export interface SessionRuntimeBindingStore {
  read(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
  }): Promise<SessionRuntimeBinding | null>
  readDossier(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
  }): Promise<SessionDossier | null>
  ensure(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void>
  replace(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void>
  setDisplayName(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly displayName: string | null
  }): Promise<string | undefined>
}

function assertedFileName(resumeId: string): string {
  if (!resumeId || resumeId === '.' || resumeId === '..' || /[\\/\0]/u.test(resumeId)) {
    throw new Error(`invalid Session resumeId for Workspace storage: ${resumeId}`)
  }
  return `${resumeId}.json`
}

export function normalizeSessionDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const displayName = value.trim()
  if (!displayName) return undefined
  return displayName.slice(0, MAX_SESSION_DISPLAY_NAME)
}

function parseDossier(value: unknown, input: {
  readonly resumeId: string
  readonly agent: string
}): SessionDossier {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Session dossier ${input.resumeId} has an unsupported shape`)
  }
  const record = value as Record<string, unknown>
  if (
    record['version'] !== 1
    || record['resumeId'] !== input.resumeId
    || record['agent'] !== input.agent
  ) {
    throw new Error(`Session dossier ${input.resumeId} has an unsupported shape`)
  }
  const hasAi = Object.prototype.hasOwnProperty.call(record, 'ai')
  const ai = hasAi ? parseSessionRuntimeBinding(record['ai']) : undefined
  if (hasAi && !ai) {
    throw new Error(`Session AI config ${input.resumeId} has an unsupported shape`)
  }
  const displayName = normalizeSessionDisplayName(record['displayName'])
  return {
    version: 1,
    resumeId: input.resumeId,
    agent: input.agent,
    ...(ai ? { ai } : {}),
    ...(displayName ? { displayName } : {}),
  }
}

function serializeDossier(file: SessionRuntimeFile): SessionRuntimeFile {
  return {
    version: 1,
    resumeId: file.resumeId,
    agent: file.agent,
    ...(file.ai ? { ai: file.ai } : {}),
    ...(file.displayName ? { displayName: file.displayName } : {}),
  }
}

/**
 * Workspace-owned Session dossier: frozen AI launch binding plus a mutable
 * coworker displayName. Writes always target the first resolved directory.
 * The launcher-owned Workspace Manager may resolve to its own state directory
 * because its cwd is the active-floor root, not a Workspace.
 */
export class WorkspaceSessionRuntimeStore implements SessionRuntimeBindingStore {
  private writeChain: Promise<void> = Promise.resolve()

  constructor(
    private readonly resolveSessionDirectories: (wsId: string) => readonly string[],
  ) {}

  private paths(wsId: string, resumeId: string): string[] {
    const fileName = assertedFileName(resumeId)
    return [...new Set(this.resolveSessionDirectories(wsId))]
      .map((directory) => join(directory, fileName))
  }

  async read(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
  }): Promise<SessionRuntimeBinding | null> {
    return (await this.readDossier(input))?.ai ?? null
  }

  async readDossier(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
  }): Promise<SessionDossier | null> {
    for (const path of this.paths(input.wsId, input.resumeId)) {
      try {
        const value = JSON.parse(await readFile(path, 'utf8')) as unknown
        return parseDossier(value, input)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw error
      }
    }
    return null
  }

  async ensure(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void> {
    const next = this.writeChain.then(() => this.ensureNow(input))
    this.writeChain = next.catch(() => undefined)
    await next
  }

  /** Explicit paused-Session edit boundary. Normal launch paths keep using
   * `ensure()` so an existing Session can never change its AI binding merely
   * because a later launch supplied different defaults. */
  async replace(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void> {
    const next = this.writeChain.then(() => this.replaceNow(input))
    this.writeChain = next.catch(() => undefined)
    await next
  }

  async setDisplayName(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly displayName: string | null
  }): Promise<string | undefined> {
    const next = this.writeChain.then(() => this.setDisplayNameNow(input))
    this.writeChain = next.then(() => undefined, () => undefined)
    return next
  }

  private async ensureNow(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void> {
    const existing = await this.readDossier(input)
    if (existing?.ai) {
      if (JSON.stringify(existing.ai) !== JSON.stringify(input.binding)) {
        throw new Error(`Session ${input.resumeId} already owns a different runtime binding`)
      }
      return
    }
    await this.writeNow({
      wsId: input.wsId,
      resumeId: input.resumeId,
      agent: input.agent,
      ai: input.binding,
      displayName: existing?.displayName,
    })
  }

  private async replaceNow(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void> {
    const existing = await this.readDossier(input)
    await this.writeNow({
      wsId: input.wsId,
      resumeId: input.resumeId,
      agent: input.agent,
      ai: input.binding,
      displayName: existing?.displayName,
    })
  }

  private async setDisplayNameNow(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly displayName: string | null
  }): Promise<string | undefined> {
    if (typeof input.displayName === 'string' && input.displayName.trim().length > MAX_SESSION_DISPLAY_NAME) {
      throw new SessionDisplayNameError(
        'too_long',
        `displayName must be at most ${MAX_SESSION_DISPLAY_NAME} characters`,
      )
    }
    const displayName = normalizeSessionDisplayName(input.displayName)
    const existing = await this.readDossier(input)
    if (!existing && !displayName) return undefined
    await this.writeNow({
      wsId: input.wsId,
      resumeId: input.resumeId,
      agent: input.agent,
      ai: existing?.ai,
      displayName,
    })
    return displayName
  }

  private async writeNow(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly ai?: SessionRuntimeBinding
    readonly displayName?: string
  }): Promise<void> {
    const [path] = this.paths(input.wsId, input.resumeId)
    if (!path) throw new Error(`Workspace ${input.wsId} is unavailable for Session dossier storage`)
    const directory = dirname(path)
    await mkdir(directory, { recursive: true })
    const temp = join(directory, `.${randomUUID()}.tmp`)
    const file = serializeDossier({
      version: 1,
      resumeId: input.resumeId,
      agent: input.agent,
      ...(input.ai ? { ai: input.ai } : {}),
      ...(input.displayName ? { displayName: input.displayName } : {}),
    })
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
  }
}
