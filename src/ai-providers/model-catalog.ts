/** Project-owned provider catalogs. Reads never wait for provider I/O. */
import { readFileSync } from 'node:fs'
import { discoveredModelSchema } from './discovered-model.js'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { dataPath } from '../core/paths.js'
import type { AIProvider } from './provider.js'
import type { ModelOption } from './preset-catalog.js'

export const MODEL_CATALOG_TTL_MS = 24 * 60 * 60 * 1000
const RETRY_DELAY_MS = 60_000
const snapshotSchema = z.object({
  version: z.literal(1), identity: z.string(), fetchedAt: z.number().finite().nonnegative(),
  models: z.array(discoveredModelSchema),
})
type Snapshot = z.infer<typeof snapshotSchema>
export interface ProviderModelCatalog {
  models: ModelOption[]
  discoverySupported: boolean
  source: 'bundled' | 'snapshot'
  fetchedAt: number | null
  refreshing: boolean
  error: string | null
}
interface Entry {
  identity: string
  ready: Promise<void>
  snapshot?: Snapshot
  pending?: Promise<void>
  attemptedAt?: number
  error: string | null
}
export class ProviderModelCatalogStore {
  private readonly entries = new Map<string, Entry>()
  constructor(private readonly options: {
    directory?: string
    now?: () => number
  } = {}) {}

  async read(provider: AIProvider, force = false): Promise<ProviderModelCatalog> {
    if (!provider.discoverModels) return { models: provider.models, discoverySupported: false, source: 'bundled', fetchedAt: null, refreshing: false, error: null }
    const directory = this.options.directory ?? dataPath('model-catalog', 'providers')
    // Each endpoint/protocol has its own catalog. Never share account-filtered
    // results across keys, or reveal a key/endpoint in the filename or response.
    const slot = provider.catalogSlot
    const identity = provider.catalogIdentity
    const file = join(directory, `${slot}.json`)
    let entry = this.entries.get(slot)
    if (!entry || entry.identity !== identity) {
      const created: Entry = { identity, ready: Promise.resolve(), error: null }
      if (provider.persistCatalog) created.ready = readFile(file, 'utf8').then((raw) => {
        const parsed = snapshotSchema.safeParse(JSON.parse(raw))
        if (parsed.success && parsed.data.identity === identity) created.snapshot = parsed.data
      }).catch(() => { /* Missing/corrupt caches are rebuilt; never block startup. */ })
      this.entries.set(slot, created)
      entry = created
    }
    await entry.ready
    const now = this.options.now ?? Date.now
    const age = entry.snapshot ? now() - entry.snapshot.fetchedAt : Infinity
    const stale = age < 0 || age >= provider.catalogTtlMs
    if (!entry.pending && (force || (stale && (entry.attemptedAt === undefined || now() - entry.attemptedAt >= RETRY_DELAY_MS)))) {
      const target = entry
      target.attemptedAt = now()
      target.error = null
      target.pending = (async () => {
        let temp: string | undefined
        try {
          const models = await provider.discoverModels!()
          const snapshot = snapshotSchema.parse({ version: 1, identity, fetchedAt: now(), models })
          if (this.entries.get(slot) !== target) return
          if (provider.persistCatalog) {
            await mkdir(directory, { recursive: true, mode: 0o700 })
            temp = `${file}.${randomUUID()}.tmp`
            await writeFile(temp, JSON.stringify(snapshot) + '\n', { mode: 0o600 })
            if (this.entries.get(slot) !== target) return
            await rename(temp, file)
          }
          target.snapshot = snapshot
        } catch {
          // Provider failures can include credentials. Keep the last successful
          // list and return only a fixed diagnostic suitable for the UI.
          target.error = 'Could not refresh models; keeping the previous catalog.'
        } finally {
          if (temp) await rm(temp, { force: true }).catch(() => undefined)
          target.pending = undefined
        }
      })()
    }
    // Explicit refresh waits; ordinary GET immediately serves local data while
    // its single-flight update runs. A failed refresh retains the timestamp.
    if (force) await entry.pending
    const models = entry.snapshot?.models ?? provider.models
    return {
      models: models.map((model) => provider.describeModel(model)),
      discoverySupported: true,
      source: entry.snapshot ? 'snapshot' : 'bundled',
      fetchedAt: entry.snapshot?.fetchedAt ?? null,
      refreshing: !!entry.pending,
      error: entry.error,
    }
  }
}

export const providerModelCatalog = new ProviderModelCatalogStore()

/** Launch reads local facts only: no network or credential writes on this path. */
export function cachedProviderModel(provider: AIProvider, model: string, directory = dataPath('model-catalog', 'providers')): ModelOption {
  try {
    const snapshot = snapshotSchema.parse(JSON.parse(readFileSync(join(directory, `${provider.catalogSlot}.json`), 'utf8')))
    if (snapshot.identity === provider.catalogIdentity) {
      const found = snapshot.models.find((entry) => entry.id === model)
      if (found) return provider.describeModel(found)
    }
  } catch { /* Missing or corrupt optional cache falls back to bundled facts. */ }
  return provider.describeModel({ id: model, label: model })
}
