import { chmod, mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { dataPath } from '@/core/paths.js'
import { isSealedEnvelope, seal, unseal } from '@/core/sealing.js'

export type ConnectorWorkKind = 'inbound' | 'artifact' | 'uta'

const claimSchema = z.object({ id: z.string().min(1), expiresAt: z.number().int().nonnegative() })
const entrySchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['inbound', 'artifact', 'uta']),
  enqueuedAt: z.number().int().nonnegative(),
  payload: z.unknown(),
  claim: claimSchema.optional(),
})
const stateSchema = z.object({ version: z.literal(1), entries: z.array(entrySchema) })
type QueueState = z.infer<typeof stateSchema>

export interface ConnectorWorkClaim<T> {
  claimId: string
  items: Array<{ id: string; payload: T }>
}

export interface ConnectorWorkQueueOptions {
  path?: string
  now?: () => number
  leaseMs?: number
  limits?: Partial<Record<ConnectorWorkKind, number>>
}

export interface ConnectorWorkQueueStore {
  enqueue<T>(kind: ConnectorWorkKind, id: string, payload: T): Promise<void>
  claim<T>(kind: ConnectorWorkKind, limit: number): Promise<ConnectorWorkClaim<T>>
  ack(claimId: string, itemIds: readonly string[]): Promise<void>
  release(claimId: string, itemIds: readonly string[]): Promise<void>
}

const DEFAULT_LIMITS: Record<ConnectorWorkKind, number> = {
  inbound: 100,
  artifact: 20,
  uta: 20,
}

/** Private sealed queue for Connector -> Alice work. Mutations are serialized
 * in process and committed through atomic rename before platform callbacks are
 * allowed to acknowledge the external event. */
export class ConnectorWorkQueue implements ConnectorWorkQueueStore {
  private readonly path: string
  private readonly now: () => number
  private readonly leaseMs: number
  private readonly limits: Record<ConnectorWorkKind, number>
  private state: QueueState | null = null
  private tail: Promise<void> = Promise.resolve()

  constructor(options: ConnectorWorkQueueOptions = {}) {
    this.path = options.path ?? dataPath('state', 'connector-work-queue.json')
    this.now = options.now ?? Date.now
    this.leaseMs = options.leaseMs ?? 30_000
    this.limits = { ...DEFAULT_LIMITS, ...options.limits }
  }

  enqueue<T>(kind: ConnectorWorkKind, id: string, payload: T): Promise<void> {
    return this.mutate(async (state) => {
      if (state.entries.some((entry) => entry.id === id)) return false
      if (state.entries.filter((entry) => entry.kind === kind).length >= this.limits[kind]) {
        throw new Error(`Connector ${kind} queue is full. Try again.`)
      }
      state.entries.push({ id, kind, payload, enqueuedAt: this.now() })
      return true
    })
  }

  claim<T>(kind: ConnectorWorkKind, limit: number): Promise<ConnectorWorkClaim<T>> {
    return this.mutate(async (state) => {
      const now = this.now()
      const selected = state.entries
        .filter((entry) => entry.kind === kind && (!entry.claim || entry.claim.expiresAt <= now))
        .slice(0, Math.max(0, limit))
      const claimId = `claim-${randomUUID()}`
      for (const entry of selected) entry.claim = { id: claimId, expiresAt: now + this.leaseMs }
      return {
        changed: selected.length > 0,
        value: { claimId, items: selected.map((entry) => ({ id: entry.id, payload: entry.payload as T })) },
      }
    }, true)
  }

  ack(claimId: string, itemIds: readonly string[]): Promise<void> {
    const ids = new Set(itemIds)
    return this.mutate(async (state) => {
      const before = state.entries.length
      state.entries = state.entries.filter((entry) => entry.claim?.id !== claimId || !ids.has(entry.id))
      return state.entries.length !== before
    })
  }

  release(claimId: string, itemIds: readonly string[]): Promise<void> {
    const ids = new Set(itemIds)
    return this.mutate(async (state) => {
      let changed = false
      for (const entry of state.entries) {
        if (entry.claim?.id !== claimId || !ids.has(entry.id)) continue
        delete entry.claim
        changed = true
      }
      return changed
    })
  }

  private async mutate<T>(
    operation: (state: QueueState) => Promise<boolean | { changed: boolean; value: T }>,
    returnsValue = false,
  ): Promise<T> {
    let release!: () => void
    const predecessor = this.tail
    this.tail = new Promise<void>((resolve) => { release = resolve })
    await predecessor
    try {
      const state = await this.load()
      const before = structuredClone(state)
      try {
        const result = await operation(state)
        const changed = typeof result === 'boolean' ? result : result.changed
        if (changed) await this.write(state)
        if (returnsValue && typeof result !== 'boolean') return result.value
        return undefined as T
      } catch (error) {
        this.state = before
        throw error
      }
    } finally {
      release()
    }
  }

  private async load(): Promise<QueueState> {
    if (this.state) return this.state
    try {
      const raw = JSON.parse(await readFile(this.path, 'utf8')) as unknown
      if (!isSealedEnvelope(raw)) {
        throw new Error('Connector work queue is not a sealed envelope')
      }
      this.state = stateSchema.parse(await unseal(raw))
    } catch (error) {
      if (!isENOENT(error)) throw error
      this.state = { version: 1, entries: [] }
    }
    return this.state
  }

  private async write(state: QueueState): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    const temp = `${this.path}.${process.pid}.${randomUUID()}.tmp`
    try {
      await writeFile(temp, `${JSON.stringify(await seal(state), null, 2)}\n`, { mode: 0o600 })
      await chmod(temp, 0o600)
      await rename(temp, this.path)
    } catch (error) {
      await unlink(temp).catch(() => undefined)
      throw error
    }
  }
}

function isENOENT(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT'
}
