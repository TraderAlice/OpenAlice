import { useCallback, useEffect, useState } from 'react'
import { configApi, type ModelDiscoveryInput } from '../api/config'
import type { PresetModel } from '../api'
import { listNativeModels } from '../components/workspace/api'

type Request = { slug: string; agent?: string; wireShape?: ModelDiscoveryInput['wireShape'] } | { native: 'omp'; workspaceId?: string } | ModelDiscoveryInput
interface Catalog {
  key: string
  models: PresetModel[] | null
  error: string | null
  loading: boolean
}

/** Account-scoped discovery; late results cannot replace another account's list. */
export function useModelCatalog(request: Request | null) {
  const key = JSON.stringify(request)
  const [revision, setRevision] = useState(0)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  useEffect(() => {
    const input = JSON.parse(key) as Request | null
    if (!input) return
    const controller = new AbortController()
    setCatalog({ key, models: null, error: null, loading: true })
    const timer = window.setTimeout(async () => {
      try {
        const models = 'slug' in input
          ? await configApi.getCredentialModels(input.slug, input.agent, controller.signal, input.wireShape)
          : 'native' in input
            ? await listNativeModels(input.native, input.workspaceId, controller.signal)
            : await configApi.discoverModels(input, controller.signal)
        if (!Array.isArray(models)) throw new Error('Invalid model list')
        if (!controller.signal.aborted) setCatalog({ key, models, error: null, loading: false })
      } catch (error) {
        if (!controller.signal.aborted) setCatalog({ key, models: null, error: error instanceof Error ? error.message : String(error), loading: false })
      }
    }, 'apiKey' in input ? 400 : 0)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [key, revision])
  const current = request && catalog?.key === key ? catalog : null
  return {
    enabled: request !== null,
    models: current?.models ?? null,
    loading: request !== null && (current?.loading ?? true),
    error: current?.error ?? null,
    refresh,
  }
}

export function catalogModelOptions(discovered: readonly PresetModel[] | null, fallback: readonly PresetModel[]): readonly PresetModel[] {
  if (discovered === null) return fallback
  return discovered.map((model) => ({ ...fallback.find((known) => known.id === model.id), ...model }))
}
