import { useCallback, useEffect, useRef, useState } from 'react'
import { configApi, type ModelDiscoveryInput } from '../api/config'
import type { PresetModel } from '../api'
import { listNativeModels } from '../components/workspace/api'

type Request = { slug: string; agent?: string; wireShape?: ModelDiscoveryInput['wireShape'] } | { native: string; workspaceId?: string } | ModelDiscoveryInput
interface Catalog {
  key: string
  models: PresetModel[] | null
  error: string | null
  loading: boolean
  discoverySupported?: boolean
  source?: 'bundled' | 'snapshot'
  fetchedAt?: number | null
}

/** Account-scoped discovery; late results cannot replace another account's list. */
export function useModelCatalog(request: Request | null) {
  const key = JSON.stringify(request)
  const [revision, setRevision] = useState(0)
  const handledRefresh = useRef(0)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const input = JSON.parse(key) as Request | null
    if (!input) return
    const controller = new AbortController()
    let timer: number
    const manual = revision !== handledRefresh.current
    handledRefresh.current = revision
    setCatalog((old) => old?.key === key
      ? { ...old, error: null, loading: true }
      : { key, models: null, error: null, loading: true })
    const read = async (force = false) => {
      try {
        if ('slug' in input || 'native' in input) {
          const result = 'native' in input
            ? await listNativeModels(input.native, input.workspaceId, controller.signal, force)
            : await configApi.getCredentialModels(input.slug, input.agent, controller.signal, input.wireShape, force)
          if (!Array.isArray(result.models)) throw new Error('Invalid model list')
          if (!controller.signal.aborted) {
            setCatalog({ key, models: result.models, error: result.error, loading: result.refreshing, source: result.source, discoverySupported: result.discoverySupported, fetchedAt: result.fetchedAt })
            // Poll only while the shared backend refresh is in flight. The GET
            // serves local state; it never starts a second provider request.
            if (result.refreshing) timer = window.setTimeout(() => { void read() }, 1000)
          }
        } else {
          const result = await configApi.discoverModels(input, controller.signal)
          const { models, discoverySupported } = result
          if (!Array.isArray(models)) throw new Error('Invalid model list')
          if (!controller.signal.aborted) setCatalog({ key, models, error: null, loading: false, discoverySupported, ...(discoverySupported === false ? { source: 'bundled' } : {}) })
        }
      } catch (error) {
        if (!controller.signal.aborted) setCatalog((old) => ({
          ...(old?.key === key ? old : { key, models: null }),
          error: error instanceof Error ? error.message : String(error), loading: false,
        }))
      }
    }
    timer = window.setTimeout(() => { void read(manual) }, 'apiKey' in input ? 400 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [key, revision])
  const current = request && catalog?.key === key ? catalog : null
  return {
    enabled: request !== null,
    models: current?.models ?? null,
    loading: request !== null && (current?.loading ?? true),
    error: current?.error ?? null,
    source: current?.source,
    discoverySupported: current?.discoverySupported,
    fetchedAt: current?.fetchedAt,
    refresh,
  }
}

export function catalogModelOptions(discovered: readonly PresetModel[] | null, fallback: readonly PresetModel[]): readonly PresetModel[] {
  if (discovered === null) return fallback
  return discovered.map((model) => ({ ...fallback.find((known) => known.id === model.id), ...model }))
}
