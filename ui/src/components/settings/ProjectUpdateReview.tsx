import { useEffect, useRef, useState } from 'react'
import { ArrowRight, Check, LoaderCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { UpdatePlan } from '@traderalice/update-lifecycle'
import { useUpdateLifecycle } from '../../hooks/useUpdateLifecycle'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { workspacePlanIsCurrent, workspacePlanRequest } from '../../lib/updates/workspacePlans'
import { Button } from '../ui/button'
import { Collapsible, CollapsibleContent, CollapsibleDetailsTrigger } from '../ui/collapsible'

/** One project decision, executed by the existing durable update owner. */
export function ProjectUpdateReview({ onClose }: { onClose(): void }) {
  const updates = useUpdateLifecycle()
  const { openAgentConfig, refresh: refreshWorkspaces } = useWorkspaces()
  const { t } = useTranslation()
  const blockerLabels: Record<string, string> = {
    active_runtime: t('workspace.sourceUpgradeBlocker.active_runtime'),
    active_sessions: t('workspace.upgradeBlockedSessions'),
    staged_changes: t('workspace.upgradeBlockedStaged'),
    working_tree_changes: t('workspace.sourceUpgradeBlocker.working_tree_changes'),
    merge_conflicts: t('workspace.sourceUpgradeBlocker.merge_conflicts'),
    incompatible_manifest: t('workspace.sourceUpgradeBlocker.incompatible_manifest'),
  }
  const [reviewed, setReviewed] = useState<{ plan: UpdatePlan; key: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const candidates = updates.projectWorkspaces.flatMap(item => {
    if (!item.workspace) return []
    const state = updates.workspaceStates.find(state => state.workspaceId === item.workspace!.id)
    if (!state?.toVersion || !['available', 'blocked'].includes(state.phase)) return []
    return [{ ...item, workspace: item.workspace, request: { ...workspacePlanRequest(item.workspace), targetVersion: state.toVersion } }]
  })
  const candidateKey = JSON.stringify(candidates.map(item => item.request))
  useEffect(() => {
    for (const item of candidates) void updates.workspacePlans.ensure(item.request)
  }, [updates.workspacePlans, candidateKey, retry, updates.workspacePlans.getSnapshot()]) // eslint-disable-line react-hooks/exhaustive-deps
  const rows = candidates.flatMap(({ workspace, label, request }) => {
    if (!workspace) return []
    const snapshot = updates.workspacePlans.resource(request).getSnapshot()
    const preview = snapshot.value?.plan
    if (!preview || workspacePlanIsCurrent(preview)) return []
    return [{ workspace, label, preview, error: snapshot.error ?? snapshot.value?.error, checking: snapshot.checking,
      id: `${request.kind}:${workspace.id}`,
      paths: preview.strategy === 'managed-context' ? preview.files.filter(file => file.status !== 'unchanged').map(file => file.path) : preview.changedPaths,
      conflicts: preview.strategy === 'managed-context' ? preview.summary.conflicts > 0 : preview.conflictedPaths.length > 0,
    }]
  })
  const previews = candidates.map(({ request }) => updates.workspacePlans.resource(request).getSnapshot())
  const previewError = updates.error || updates.workspaceStates.find(state => state.phase === 'failed' && updates.projectWorkspaces.some(item => item.workspace?.id === state.workspaceId))?.reason || updates.projectWorkspaces.find(item => item.error)?.error
    || previews.map(snapshot => snapshot.error ?? snapshot.value?.error).find(Boolean)
  const pendingPreview = updates.checking || updates.projectWorkspaces.some(item => !item.loaded || updates.workspaceStates.some(state => state.workspaceId === item.workspace?.id && ['checking', 'applying'].includes(state.phase))) || previews.some(snapshot => snapshot.checking || (!snapshot.value && !snapshot.error))
  const key = JSON.stringify([candidateKey, rows.map(row => [row.id, row.preview.planDigest, row.error, row.checking])])
  const plan = reviewed?.key === key ? reviewed.plan : null
  const operation = updates.operation
  const active = operation && operation.phase !== 'succeeded'
  const [startedId, setStartedId] = useState<string | null>(null)
  const finished = operation?.phase === 'succeeded' && (startedId === operation.id || busy)
  // Re-plan if exact preview or default selection changes; retired requests cannot authorize.
  useEffect(() => {
    let live = true
    setReviewed(null); setError(null)
    if (active || finished || !rows.length || rows.some(row => row.error || row.checking) || pendingPreview || previewError) { setLoading(false); return }
    setLoading(true)
    void updates.review({ client: false, backend: false, projectUnits: rows.map(row => row.id) })
      .then(next => {
        const proposals = next.proposals.flatMap(proposal => proposal.unit.id === 'project' && proposal.reference?.plan
          ? (JSON.parse(proposal.reference.plan) as UpdatePlan).proposals : [proposal])
        if (proposals.length !== rows.length || rows.some(row => !proposals.some(proposal => proposal.unit.id === row.id
          && proposal.fingerprint === row.preview.planDigest && proposal.unit.desired?.version === row.preview.toVersion))) {
          throw new Error(t('settings.versions.previewChanged'))
        }
        if (live) setReviewed({ plan: next, key })
      })
      .catch(cause => { if (live) setError(String(cause)) })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [key, updates.review, Boolean(active), Boolean(finished), pendingPreview, previewError, retry]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (active) setStartedId(operation.id) }, [active, operation?.id])
  const act = async (action: () => Promise<void>) => {
    if (busy) return
    setBusy(true); setError(null)
    try {
      await action()
      for (const row of rows) updates.workspacePlans.invalidateWorkspace(row.workspace.id)
      await refreshWorkspaces()
      await updates.refresh()
    } catch (cause) { if (mounted.current) { setError(String(cause)); setReviewed(null) } }
    finally { if (mounted.current) setBusy(false) }
  }
  const blocked = Boolean(updates.checking || pendingPreview || previewError || plan?.blockers.length || rows.some(row => row.error || row.checking || row.preview.blocked || row.conflicts))
  return <>
    <div className="min-h-0 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
      {active || finished ? <div role="status" aria-live="polite" className="space-y-4">
        <div className="flex items-center gap-2 font-medium">{finished ? <Check className="size-5 text-success" /> : <LoaderCircle className={`size-5 text-primary ${busy || operation?.phase === 'running' ? 'animate-spin motion-reduce:animate-none' : ''}`} />}{t(`settings.updateCoordinator.phase.${operation!.phase}`)}</div>
        <p className="text-sm text-muted-foreground">{Object.keys(operation!.completed).length} / {operation!.plan.steps.length}</p>
        <div className="h-1.5 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-label={t('settings.versions.updating')} aria-valuemin={0} aria-valuemax={operation!.plan.steps.length} aria-valuenow={Object.keys(operation!.completed).length}><div className="h-full bg-primary transition-[width] motion-reduce:transition-none" style={{ width: `${operation!.plan.steps.length ? Object.keys(operation!.completed).length / operation!.plan.steps.length * 100 : 0}%` }} /></div>
        {operation!.error && <p role="alert" className="break-words text-sm text-warning">{operation!.error}</p>}
      </div> : <>
        {(loading || pendingPreview) && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" />{t('settings.versions.preparingUpdate')}</p>}
        <div className="divide-y divide-border">{rows.map(row => <div key={row.id} className="py-3 first:pt-0">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium">{row.label}</span><span className="flex items-center gap-2 text-sm tabular-nums">{row.preview.fromVersion}<ArrowRight className="size-3 text-muted-foreground" />{row.preview.toVersion}</span></div>
          <p className="mt-1 text-xs text-muted-foreground">{row.workspace.displayName || row.workspace.tag}</p>
          <p className="mt-2 text-sm text-muted-foreground">{row.preview.strategy === 'managed-context'
            ? t('settings.versions.managedChanges', { changed: row.preview.summary.ready, preserved: row.preview.summary.preserved })
            : t('settings.versions.sourceChanges', { count: row.preview.changedPaths.length })}</p>
          {(row.error || row.preview.blocked) && <p role="alert" className="mt-2 break-words text-sm text-warning">{row.error || row.preview.blockers.map(reason => blockerLabels[reason] ?? reason).join(' ')}</p>}
          {row.conflicts && <Button variant="outline" size="sm" className="mt-3" onClick={() => { onClose(); openAgentConfig(row.workspace.id, undefined, 'template') }}>{t('settings.versions.resolveConflicts')}</Button>}
        </div>)}</div>
        {!rows.length && !loading && !pendingPreview && !previewError && <p className="text-sm text-muted-foreground">{t('settings.versions.current')}</p>}
        {rows.length > 0 && <>
          <div><h4 className="text-sm font-medium">{t('settings.versions.impact')}</h4><p className="mt-2 text-sm leading-6 text-muted-foreground">{t('settings.versions.projectImpact')}</p></div>
          <Collapsible><CollapsibleDetailsTrigger>{t('settings.versions.changedFiles')}</CollapsibleDetailsTrigger><CollapsibleContent><div className="space-y-4 py-3">{rows.map(row => <div key={row.id}><p className="mb-1 text-xs font-medium">{row.label}</p>{row.paths.map(path => <p key={path} className="break-all py-0.5 font-mono text-xs text-muted-foreground">{path}</p>)}</div>)}</div></CollapsibleContent></Collapsible>
        </>}
        {plan?.blockers.filter(reason => !rows.some(row => row.preview.blockers.includes(reason))).map(reason => <p key={reason} role="alert" className="break-words text-sm text-warning">{blockerLabels[reason] ?? reason}</p>)}
      </>}
      {previewError && <p role="alert" className="break-words text-sm text-warning">{previewError}</p>}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    </div>
    <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-4 sm:px-6">
      <Button variant="outline" onClick={onClose}>{t('settings.versions.close')}</Button>
      {active ? <>
        <Button variant="ghost" disabled={busy || operation.phase === 'running'} onClick={() => { void act(updates.abandon) }}>{t('settings.updateCoordinator.abandon')}</Button>
        <Button disabled={busy || operation.phase === 'running'} onClick={() => { void act(updates.resume) }}>{t('settings.updateCoordinator.resume')}</Button>
      </> : !finished && <>
        {(error || previewError) && <Button variant="outline" disabled={busy || loading} onClick={() => { void updates.refresh(); setRetry(value => value + 1) }}>{t('common.retry')}</Button>}
        <Button disabled={!plan || blocked || loading || busy || !rows.length} onClick={() => { if (plan) void act(() => updates.approve(plan)) }}>{busy ? t('settings.versions.updating') : t('settings.versions.updateProject')}</Button>
      </>}
    </div>
  </>
}
