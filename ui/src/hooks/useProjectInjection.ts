import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchJson } from '../api/client'
import { applyTemplateUpgrade, type TemplateUpgradePlan } from '../components/workspace/api'
export interface SkillProjection {
  injectedVersion?: string | null
  injectedAt?: string | null
  name: string
  enabled: boolean
  installed: boolean
  canonicalPresent: boolean
  mirrorDiverged: boolean
  customized: boolean
  sourceChanged: boolean
  files: { path: string; currentPreview?: string | null; sourcePreview?: string | null; differs: boolean; truncated: boolean; unverified: boolean }[]
}
export interface InjectionWorkspace {
  projections?: SkillProjection[]
  id: string
  name: string
  template: string
  plan?: TemplateUpgradePlan
  error?: string
}
export interface ProjectInjection {
  commands: Record<string, Record<string, string[]>>
  version: string
  skills: { name: string; files: { path: string; content: string }[] }[]
  workspaces: InjectionWorkspace[]
}
export function injectionStatus(row: InjectionWorkspace) {
  const p = row.plan
  if (!p) return 'error'
  if (p.blocked) return 'busy'
  if (p.summary.conflicts) return 'conflicts'
  if (p.summary.ready) return 'update'
  if (p.fromVersion !== p.toVersion) return 'record'
  return p.summary.preserved ? 'customized' : 'current'
}
export function useProjectInjection() {
  const [data, setData] = useState<ProjectInjection | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [results, setResults] = useState<Record<string, string>>({})
  const alive = useRef(true)
  const updating = useRef(false)
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  const refresh = useCallback(() => setRevision((v) => v + 1), [])
  useEffect(() => {
    const controller = new AbortController()
    setError(null)
    void fetchJson<ProjectInjection>('/api/workspaces/alice-harness/catalog', { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value) })
      .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message) })
    return () => controller.abort()
  }, [revision])
  const updateReady = async () => {
    if (updating.current || !data || error) return
    updating.current = true
    setBusy(true)
    setResults({})
    try {
      for (const row of data.workspaces) {
        if (!alive.current) break
        if (!['update', 'record'].includes(injectionStatus(row)) || !row.plan) continue
        let result = 'ok'
        try { await applyTemplateUpgrade(row.id, row.plan.planDigest, {}, 'alice-harness') }
        catch (err) { result = (err as Error).message }
        if (alive.current) setResults((old) => ({ ...old, [row.id]: result }))
      }
    } finally {
      updating.current = false
      if (alive.current) { setBusy(false); refresh() }
    }
  }
  return { data, error, refresh, busy, results, updateReady }
}

export function useSkillProjection(workspaceId: string, skill: string, enabled: boolean) {
  const [data, setData] = useState<SkillProjection | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    setData(null); setError(null)
    if (!enabled) return
    const controller = new AbortController()
    void fetchJson<SkillProjection>(`/api/workspaces/${encodeURIComponent(workspaceId)}/alice-harness/skills/${encodeURIComponent(skill)}`, { signal: controller.signal })
      .then((value) => { if (!controller.signal.aborted) setData(value) })
      .catch((err) => { if (!controller.signal.aborted) setError((err as Error).message) })
    return () => controller.abort()
  }, [workspaceId, skill, enabled])
  return { data, error }
}
