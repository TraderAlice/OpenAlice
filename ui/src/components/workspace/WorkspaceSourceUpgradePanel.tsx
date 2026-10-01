import { useEffect, useState, type ReactElement } from 'react'
import { AlertTriangle, ArrowRight, GitMerge, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useWorkspacePlan } from '../../lib/updates/useWorkspacePlan'
import { workspacePlanIsCurrent } from '../../lib/updates/workspacePlans'
import { CenteredLoading, EmptyState } from '../StateViews'
import { Button } from '../ui/button'
import {
  applyHarnessSourceUpgrade,
  HarnessSourceUpgradeApiError,
  type HarnessSourceUpgradePlan,
  type HarnessSourceUpgradeResult,
} from './api'

interface Props {
  readonly wsId: string
  readonly onWorkspaceChanged: () => void
}

export function WorkspaceSourceUpgradePanel({ wsId, onWorkspaceChanged }: Props): ReactElement {
  const { t } = useTranslation()
  const shared = useWorkspacePlan({ workspaceId: wsId, kind: 'source' })
  const plan = shared.plan as HarnessSourceUpgradePlan | null
  const [result, setResult] = useState<HarnessSourceUpgradeResult | null>(null)
  const { loading } = shared
  const [applying, setApplying] = useState(false)
  const [applyError, setError] = useState<string | null>(null)
  const error = applyError ?? shared.error
  const current = !!plan && workspacePlanIsCurrent(plan)
  const blockerLabels: Record<string, string> = {
    active_runtime: t('workspace.sourceUpgradeBlocker.active_runtime'),
    working_tree_changes: t('workspace.sourceUpgradeBlocker.working_tree_changes'),
    merge_conflicts: t('workspace.sourceUpgradeBlocker.merge_conflicts'),
    incompatible_manifest: t('workspace.sourceUpgradeBlocker.incompatible_manifest'),
  }

  const load = async () => { setError(null); await shared.refresh() }
  useEffect(() => { setResult(null); setError(null); setApplying(false) }, [shared.identity])

  const apply = async () => {
    if (!plan || current || plan.blocked || applying || loading || shared.error) return
    setApplying(true)
    setError(null)
    try {
      const next = await applyHarnessSourceUpgrade(wsId, plan.planDigest, plan.toVersion)
      if (!shared.isActive()) return
      shared.invalidate()
      await shared.refresh()
      onWorkspaceChanged()
      if (shared.isCurrent()) setResult(next)
    } catch (err) {
      if (!shared.isActive()) return
      if (err instanceof HarnessSourceUpgradeApiError && err.plan) await shared.replace(err.plan)
      if (shared.isCurrent()) setError((err as Error).message)
    } finally {
      if (shared.isCurrent()) setApplying(false)
    }
  }

  if (!plan && !error) {
    return <CenteredLoading label={t('workspace.sourceUpgradeLoading')} />
  }

  if (result) {
    return (
      <div className="flex min-h-[360px] items-center justify-center px-6">
        <EmptyState
          icon={<ShieldCheck className="text-success" />}
          title={t('workspace.sourceUpgradeComplete')}
          description={`${result.fromVersion} → ${result.toVersion}`}
        />
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      {plan && (
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-secondary/35 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-sm leading-5 font-semibold text-muted-foreground"><GitMerge size={14} />{t('workspace.sourceUpgradeTitle')}</div>
                <div className="mt-2 flex items-center gap-2 text-[18px] font-semibold"><span>{plan.fromVersion}</span><ArrowRight size={17} className="text-muted-foreground" /><span className="text-primary">{plan.toVersion}</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-sm leading-5">
                  <span className={`rounded-full px-2 py-0.5 ${plan.verified ? 'bg-success/10 text-success' : 'bg-warning/12 text-warning'}`}>
                    {t(plan.verified ? 'workspace.sourceUpgradeVerified' : 'workspace.sourceUpgradeUnverified')}
                  </span>
                  <span className="font-mono text-muted-foreground">{plan.toCommit.slice(0, 12)}</span>
                </div>
              </div>
              <Button type="button" variant="outline" onClick={() => void load()} disabled={loading || applying}><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('workspace.upgradeRefresh')}</Button>
            </div>
          </section>

          {!plan.verified && (
            <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-3 text-sm leading-relaxed text-foreground">
              <div className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle size={15} />{t('workspace.sourceUpgradeUnverifiedTitle')}</div>
              <p className="mt-1 text-muted-foreground">{t('workspace.sourceUpgradeUnverifiedDescription')}</p>
            </div>
          )}

          {plan.blockers.length > 0 && (
            <div className="rounded-lg border border-warning/35 bg-warning/8 px-3 py-3 text-sm leading-5">
              <div className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle size={15} />{t('workspace.upgradeBlockedTitle')}</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {plan.blockers.map((blocker) => <li key={blocker}>{blockerLabels[blocker] ?? blocker}</li>)}
              </ul>
            </div>
          )}

          <section className="rounded-lg border border-border bg-secondary/20 p-4">
            <h4 className="text-sm leading-5 font-semibold">{t('workspace.sourceUpgradeChanges', { count: plan.changedPaths.length })}</h4>
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border bg-background/55 p-3 font-mono text-sm leading-5 text-muted-foreground">
              {plan.changedPaths.map((path) => <div key={path} className="truncate">{path}</div>)}
            </div>
          </section>

          <Button type="button" className="h-10 w-full" onClick={() => void apply()} disabled={current || plan.blocked || applying || loading || !!shared.error}>
            {applying && <LoaderCircle size={15} className="animate-spin" />}
            {t(current ? 'settings.versions.current' : plan.verified ? 'workspace.sourceUpgradeApply' : 'workspace.sourceUpgradeApplyUnverified')}
          </Button>
        </div>
      )}
      {!plan && error && <Button variant="outline" disabled={loading} onClick={() => void load()}><RefreshCw size={13}/>{t('workspace.upgradeRefresh')}</Button>}
      {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm leading-5 text-destructive">{error}</p>}
    </div>
  )
}
