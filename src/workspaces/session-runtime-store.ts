import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { SessionRuntimeBinding } from './cli-adapter.js'
import { parseSessionRuntimeBinding } from './session-runtime-binding.js'

interface SessionRuntimeFile {
  readonly version: 1
  readonly resumeId: string
  readonly agent: string
  readonly ai: SessionRuntimeBinding
}

export interface SessionRuntimeBindingStore {
  read(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
  }): Promise<SessionRuntimeBinding | null>
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
}

function assertedFileName(resumeId: string): string {
  if (!resumeId || resumeId === '.' || resumeId === '..' || /[\\/\0]/u.test(resumeId)) {
    throw new Error(`invalid Session resumeId for Workspace storage: ${resumeId}`)
  }
  return `${resumeId}.json`
}

function parsedFile(value: unknown, input: {
  readonly resumeId: string
  readonly agent: string
}): SessionRuntimeFile {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Session AI config ${input.resumeId} has an unsupported shape`)
  }
  const record = value as Record<string, unknown>
  const ai = parseSessionRuntimeBinding(record['ai'])
  if (
    record['version'] !== 1
    || record['resumeId'] !== input.resumeId
    || record['agent'] !== input.agent
    || !ai
  ) {
    throw new Error(`Session AI config ${input.resumeId} has an unsupported shape`)
  }
  return {
    version: 1,
    resumeId: input.resumeId,
    agent: input.agent,
    ai,
  }
}

/**
 * Workspace-owned, secret-free AI launch configuration for product Sessions.
 *
 * The resolver returns the current Workspace session-config directory first
 * and may include a departed checkout as a read fallback. Writes always target
 * the first path. The launcher-owned Workspace Manager may resolve to its own
 * state directory because its cwd is the active-floor root, not a Workspace.
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
    for (const path of this.paths(input.wsId, input.resumeId)) {
      try {
        const value = JSON.parse(await readFile(path, 'utf8')) as unknown
        return parsedFile(value, input).ai
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
    const next = this.writeChain.then(() => this.writeNow(input))
    this.writeChain = next.catch(() => undefined)
    await next
  }

  private async ensureNow(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void> {
    const existing = await this.read(input)
    if (existing) {
      if (JSON.stringify(existing) !== JSON.stringify(input.binding)) {
        throw new Error(`Session ${input.resumeId} already owns a different runtime binding`)
      }
      return
    }

    await this.writeNow(input)
  }

  private async writeNow(input: {
    readonly wsId: string
    readonly resumeId: string
    readonly agent: string
    readonly binding: SessionRuntimeBinding
  }): Promise<void> {
    const [path] = this.paths(input.wsId, input.resumeId)
    if (!path) throw new Error(`Workspace ${input.wsId} is unavailable for Session AI config storage`)
    const directory = dirname(path)
    await mkdir(directory, { recursive: true })
    const temp = join(directory, `.${randomUUID()}.tmp`)
    const file: SessionRuntimeFile = {
      version: 1,
      resumeId: input.resumeId,
      agent: input.agent,
      ai: input.binding,
    }
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, { mode: 0o600 })
    await rename(temp, path)
  }
}
