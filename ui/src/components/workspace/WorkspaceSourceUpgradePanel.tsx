import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { AlertTriangle, ArrowRight, GitMerge, LoaderCircle, RefreshCw, ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  applyHarnessSourceUpgrade,
  getHarnessSourceUpgradePlan,
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
  const [plan, setPlan] = useState<HarnessSourceUpgradePlan | null>(null)
  const [result, setResult] = useState<HarnessSourceUpgradeResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const blockerLabels: Record<string, string> = {
    active_runtime: t('workspace.sourceUpgradeBlocker.active_runtime'),
    working_tree_changes: t('workspace.sourceUpgradeBlocker.working_tree_changes'),
    merge_conflicts: t('workspace.sourceUpgradeBlocker.merge_conflicts'),
    incompatible_manifest: t('workspace.sourceUpgradeBlocker.incompatible_manifest'),
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setPlan(await getHarnessSourceUpgradePlan(wsId))
    } catch (err) {
      if (err instanceof HarnessSourceUpgradeApiError && err.plan) setPlan(err.plan)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [wsId])

  useEffect(() => { void load() }, [load])

  const apply = async () => {
    if (!plan || plan.blocked || applying) return
    setApplying(true)
    setError(null)
    try {
      const next = await applyHarnessSourceUpgrade(wsId, plan.planDigest, plan.toVersion)
      setResult(next)
      onWorkspaceChanged()
      setPlan(null)
    } catch (err) {
      if (err instanceof HarnessSourceUpgradeApiError && err.plan) setPlan(err.plan)
      setError((err as Error).message)
    } finally {
      setApplying(false)
    }
  }

  if (loading && !plan) {
    return <div className="flex min-h-[360px] items-center justify-center gap-2 text-[13px] text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />{t('workspace.sourceUpgradeLoading')}</div>
  }

  if (result) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
        <ShieldCheck size={30} className="mb-3 text-success" />
        <h3 className="text-[15px] font-semibold">{t('workspace.sourceUpgradeComplete')}</h3>
        <p className="mt-1 text-[12px] text-muted-foreground">{result.fromVersion} → {result.toVersion}</p>
      </div>
    )
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
      {plan && (
        <div className="space-y-4">
          <section className="rounded-xl border border-border bg-secondary/35 p-4">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"><GitMerge size={14} />{t('workspace.sourceUpgradeTitle')}</div>
                <div className="mt-2 flex items-center gap-2 text-[18px] font-semibold"><span>{plan.fromVersion}</span><ArrowRight size={17} className="text-muted-foreground" /><span className="text-primary">{plan.toVersion}</span></div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
                  <span className={`rounded-full px-2 py-0.5 ${plan.verified ? 'bg-success/10 text-success' : 'bg-warning/12 text-warning'}`}>
                    {t(plan.verified ? 'workspace.sourceUpgradeVerified' : 'workspace.sourceUpgradeUnverified')}
                  </span>
                  <span className="font-mono text-muted-foreground">{plan.toCommit.slice(0, 12)}</span>
                </div>
              </div>
              <button type="button" onClick={() => void load()} disabled={loading || applying} className="oa-pressable inline-flex min-h-9 items-center gap-2 rounded-lg border border-border bg-background px-3 text-[12px] text-muted-foreground"><RefreshCw size={13} className={loading ? 'animate-spin' : ''} />{t('workspace.upgradeRefresh')}</button>
            </div>
          </section>

          {!plan.verified && (
            <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-3 text-[12px] leading-relaxed text-foreground">
              <div className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle size={15} />{t('workspace.sourceUpgradeUnverifiedTitle')}</div>
              <p className="mt-1 text-muted-foreground">{t('workspace.sourceUpgradeUnverifiedDescription')}</p>
            </div>
          )}

          {plan.blockers.length > 0 && (
            <div className="rounded-lg border border-warning/35 bg-warning/8 px-3 py-3 text-[12px]">
              <div className="flex items-center gap-2 font-semibold text-warning"><AlertTriangle size={15} />{t('workspace.upgradeBlockedTitle')}</div>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">
                {plan.blockers.map((blocker) => <li key={blocker}>{blockerLabels[blocker] ?? blocker}</li>)}
              </ul>
            </div>
          )}

          <section className="rounded-xl border border-border bg-secondary/20 p-4">
            <h4 className="text-[13px] font-semibold">{t('workspace.sourceUpgradeChanges', { count: plan.changedPaths.length })}</h4>
            <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t('workspace.sourceUpgradeChangesDescription')}</p>
            <div className="mt-3 max-h-48 overflow-y-auto rounded-lg border border-border bg-background/55 p-3 font-mono text-[11px] text-muted-foreground">
              {plan.changedPaths.map((path) => <div key={path} className="truncate">{path}</div>)}
            </div>
          </section>

          <button type="button" onClick={() => void apply()} disabled={plan.blocked || applying} className="oa-pressable inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-[13px] font-semibold text-primary-foreground disabled:opacity-45">
            {applying && <LoaderCircle size={15} className="animate-spin" />}
            {t(plan.verified ? 'workspace.sourceUpgradeApply' : 'workspace.sourceUpgradeApplyUnverified')}
          </button>
        </div>
      )}
      {error && <p className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[12px] text-destructive">{error}</p>}
    </div>
  )
}
