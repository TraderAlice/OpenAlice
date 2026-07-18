import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileDiff,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'

import {
  applyTemplateUpgrade,
  getTemplateUpgradePlan,
  TemplateUpgradeApiError,
  type TemplateUpgradeFilePlan,
  type TemplateUpgradePlan,
  type TemplateUpgradeResolution,
  type TemplateUpgradeResult,
} from './api'

interface Props {
  readonly wsId: string
  readonly onWorkspaceChanged: () => void
  readonly onClose: () => void
}

/**
 * A review surface, not an "update everything" button. It makes the three-way
 * contract visible in user language: safe template-only changes, protected
 * Workspace customizations, and the small set of files needing a decision.
 */
export function WorkspaceTemplateUpgradePanel({
  wsId,
  onWorkspaceChanged,
  onClose,
}: Props): ReactElement {
  const { t } = useTranslation()
  const [plan, setPlan] = useState<TemplateUpgradePlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const [result, setResult] = useState<TemplateUpgradeResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, TemplateUpgradeResolution>>({})

  const load = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setUnsupported(false)
    try {
      const next = await getTemplateUpgradePlan(wsId)
      setPlan(next)
      setResolutions((current) => Object.fromEntries(
        Object.entries(current).filter(([path]) =>
          next.files.some((file) => file.path === path && file.status === 'conflict')),
      ))
    } catch (err) {
      if (err instanceof TemplateUpgradeApiError && err.code === 'unsupported') {
        setUnsupported(true)
      }
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [wsId])

  useEffect(() => { void load() }, [load])

  const conflicts = useMemo(
    () => plan?.files.filter((file) => file.status === 'conflict') ?? [],
    [plan],
  )
  const unresolved = conflicts.filter((file) => !resolutions[file.path]).length
  const current = plan?.fromVersion === plan?.toVersion
  const canApply = !!plan && !current && !plan.blocked && unresolved === 0 && !applying

  const apply = async (): Promise<void> => {
    if (!plan || !canApply) return
    setApplying(true)
    setError(null)
    try {
      const next = await applyTemplateUpgrade(wsId, plan.planDigest, resolutions)
      setResult(next)
      onWorkspaceChanged()
      await load()
    } catch (err) {
      if (err instanceof TemplateUpgradeApiError && err.plan) setPlan(err.plan)
      setError((err as Error).message)
    } finally {
      setApplying(false)
    }
  }

  if (loading && !plan) {
    return (
      <div className="flex min-h-[360px] items-center justify-center gap-2 text-[13px] text-text-muted">
        <LoaderCircle size={16} className="animate-spin" />
        {t('workspace.upgradeLoading')}
      </div>
    )
  }

  if (unsupported) {
    return (
      <div className="flex min-h-[360px] flex-col items-center justify-center px-6 text-center">
        <ShieldCheck size={28} className="mb-3 text-text-muted/60" />
        <h3 className="text-[14px] font-semibold text-text">{t('workspace.upgradeUnavailableTitle')}</h3>
        <p className="mt-1 max-w-md text-[12px] leading-relaxed text-text-muted">{error}</p>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        {plan && (
          <>
            <section className="oa-status-surface overflow-hidden rounded-xl border border-border bg-bg-secondary/35">
              <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-text-muted/75">
                    <FileDiff size={14} />
                    {t('workspace.upgradeManagedAssets')}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[18px] font-semibold text-text">
                    <span>v{plan.fromVersion}</span>
                    <ArrowRight size={17} className="text-text-muted" />
                    <span className={current ? '' : 'text-accent'}>v{plan.toVersion}</span>
                  </div>
                  <p className="mt-1 max-w-xl text-[12px] leading-relaxed text-text-muted">
                    {current
                      ? t('workspace.upgradeCurrentDescription')
                      : t('workspace.upgradeDescription')}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading || applying}
                  className="oa-pressable inline-flex min-h-9 shrink-0 items-center justify-center gap-2 rounded-lg border border-border bg-bg px-3 text-[12px] text-text-muted hover:border-accent/40 hover:text-text disabled:opacity-50"
                >
                  <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
                  {t('workspace.upgradeRefresh')}
                </button>
              </div>
              {!current && (
                <div className="grid grid-cols-3 border-t border-border bg-bg/45">
                  <Metric value={plan.summary.ready} label={t('workspace.upgradeReadyShort')} tone="accent" />
                  <Metric value={plan.summary.preserved} label={t('workspace.upgradePreservedShort')} tone="neutral" />
                  <Metric value={plan.summary.conflicts} label={t('workspace.upgradeConflictsShort')} tone="warning" />
                </div>
              )}
            </section>

            {plan.source === 'legacy-root-commit' && !current && (
              <div className="rounded-lg border border-border/70 bg-bg-secondary/25 px-3 py-2.5 text-[11px] leading-relaxed text-text-muted">
                {t('workspace.upgradeLegacyBaseline')}
              </div>
            )}

            {plan.blockers.length > 0 && (
              <div className="rounded-lg border border-[var(--color-workspace-template-upgrade-panel-warning-border-subtle)] bg-[var(--color-workspace-template-upgrade-panel-warning-bg-subtle-alpha-8)] px-3 py-3 text-[12px] text-text">
                <div className="flex items-center gap-2 font-semibold text-[var(--color-workspace-template-upgrade-panel-warning-text)] dark:text-[var(--color-workspace-template-upgrade-panel-warning-text)]">
                  <AlertTriangle size={15} />
                  {t('workspace.upgradeBlockedTitle')}
                </div>
                <ul className="mt-2 space-y-1.5 pl-5 text-text-muted">
                  {plan.blockers.includes('active_sessions') && plan.activity.sessions.length === 0 && plan.activity.headless.length === 0 && (
                    <li>{t('workspace.upgradeBlockedSessions')}</li>
                  )}
                  {plan.activity.sessions.map((session) => (
                    <li key={session.sessionId}>
                      {t('workspace.upgradeBlockedSessionItem', {
                        name: session.name,
                        agent: session.agent,
                        surface: session.surface === 'webpi' ? 'WebPi' : 'TUI',
                      })}
                    </li>
                  ))}
                  {plan.activity.headless.map((run, index) => (
                    <li key={run.taskId ?? `${run.agent}-${run.startedAt}-${index}`}>
                      {t('workspace.upgradeBlockedHeadlessItem', {
                        agent: run.agent,
                        run: run.taskId ?? t('workspace.upgradeSynchronousRun'),
                      })}
                    </li>
                  ))}
                  {plan.blockers.includes('staged_changes') && <li>{t('workspace.upgradeBlockedStaged')}</li>}
                </ul>
              </div>
            )}

            {!current && plan.summary.ready > 0 && (
              <FileGroup
                title={t('workspace.upgradeReadyTitle')}
                description={t('workspace.upgradeReadyDescription')}
                files={plan.files.filter((file) => file.status === 'ready')}
                defaultOpen
                tone="accent"
              />
            )}

            {!current && plan.summary.preserved > 0 && (
              <FileGroup
                title={t('workspace.upgradePreservedTitle')}
                description={t('workspace.upgradePreservedDescription')}
                files={plan.files.filter((file) => file.status === 'preserved')}
                tone="neutral"
              />
            )}

            {!current && conflicts.length > 0 && (
              <section className="rounded-xl border border-[var(--color-workspace-template-upgrade-panel-warning-border-subtle)] bg-bg-secondary/20">
                <div className="border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
                    <AlertTriangle size={15} className="text-[var(--color-workspace-template-upgrade-panel-warning-text)] dark:text-[var(--color-workspace-template-upgrade-panel-warning-text)]" />
                    {t('workspace.upgradeConflictTitle')}
                    <span className="rounded-full bg-[var(--color-workspace-template-upgrade-panel-warning-bg-subtle-alpha-12)] px-2 py-0.5 text-[10px] text-[var(--color-workspace-template-upgrade-panel-warning-text)] dark:text-[var(--color-workspace-template-upgrade-panel-warning-text)]">
                      {conflicts.length}
                    </span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-text-muted">
                    {t('workspace.upgradeConflictDescription')}
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {conflicts.map((file) => (
                    <ConflictFile
                      key={file.path}
                      file={file}
                      value={resolutions[file.path]}
                      onChange={(value) => setResolutions((currentResolutions) => ({
                        ...currentResolutions,
                        [file.path]: value,
                      }))}
                    />
                  ))}
                </div>
              </section>
            )}

            {result && current && (
              <div className="oa-disclosure-enter rounded-xl border border-green/35 bg-green/8 px-4 py-3">
                <div className="flex items-center gap-2 text-[13px] font-semibold text-green">
                  <Check size={16} />
                  {t('workspace.upgradeCompleteTitle')}
                </div>
                <p className="mt-1 text-[11px] text-text-muted">
                  {t('workspace.upgradeCompleteDescription', {
                    count: result.changedPaths.length,
                    commit: result.commit.slice(0, 8),
                  })}
                </p>
              </div>
            )}
          </>
        )}

        {error && !unsupported && (
          <div className="rounded-lg border border-red/35 bg-red/8 px-3 py-2.5 text-[12px] text-red" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-bg-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-[11px] text-text-muted">
          {plan && !current && conflicts.length > 0 && (
            unresolved > 0
              ? t('workspace.upgradeUnresolved', { count: unresolved })
              : t('workspace.upgradeAllResolved')
          )}
          {plan && !current && conflicts.length === 0 && t('workspace.upgradeNoConflicts')}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={applying} className="btn-secondary">
            {current ? t('common.close') : t('createWorkspace.cancel')}
          </button>
          {!current && (
            <button
              type="button"
              onClick={() => void apply()}
              disabled={!canApply}
              className="oa-pressable inline-flex min-h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[12px] font-semibold text-[var(--color-workspace-template-upgrade-panel-on-strong-text)] hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {applying ? <LoaderCircle size={14} className="animate-spin" /> : <GitCommitHorizontal size={14} />}
              {applying ? t('workspace.upgradeApplying') : t('workspace.upgradeApply')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
function Metric({ value, label, tone }: {
  value: number
  label: string
  tone: 'accent' | 'neutral' | 'warning'
}): ReactElement {
  const valueClass = tone === 'accent'
    ? 'text-accent'
    : tone === 'warning'
      ? 'text-[var(--color-workspace-template-upgrade-panel-warning-text)] dark:text-[var(--color-workspace-template-upgrade-panel-warning-text)]'
      : 'text-text'
  return (
    <div className="border-r border-border px-3 py-2.5 text-center last:border-r-0">
      <div className={`text-[16px] font-semibold tabular-nums ${valueClass}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-text-muted">{label}</div>
    </div>
  )
}

function FileGroup({ title, description, files, defaultOpen = false, tone }: {
  title: string
  description: string
  files: readonly TemplateUpgradeFilePlan[]
  defaultOpen?: boolean
  tone: 'accent' | 'neutral'
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-xl border border-border bg-bg-secondary/20">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="oa-pressable flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left"
      >
        {open ? <ChevronDown size={15} className="mt-0.5 text-text-muted" /> : <ChevronRight size={15} className="mt-0.5 text-text-muted" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-text">
            {title}
            <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone === 'accent' ? 'bg-accent/10 text-accent' : 'bg-bg-tertiary text-text-muted'}`}>
              {files.length}
            </span>
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{description}</p>
        </div>
      </button>
      {open && (
        <div className="oa-disclosure-enter border-t border-border px-4 py-2">
          {files.map((file) => (
            <div key={file.path} className="flex items-center gap-2 border-b border-border/60 py-2 last:border-b-0">
              {file.status === 'ready'
                ? <Check size={13} className="shrink-0 text-accent" />
                : <ShieldCheck size={13} className="shrink-0 text-text-muted" />}
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-text" title={file.path}>{file.path}</code>
              <span className="shrink-0 text-[10px] capitalize text-text-muted">{file.operation}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ConflictFile({ file, value, onChange }: {
  file: TemplateUpgradeFilePlan
  value?: TemplateUpgradeResolution
  onChange: (value: TemplateUpgradeResolution) => void
}): ReactElement {
  const { t } = useTranslation()
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <code className="block truncate font-mono text-[11px] font-semibold text-text" title={file.path}>{file.path}</code>
          <p className="mt-1 text-[11px] leading-relaxed text-text-muted">{file.note}</p>
        </div>
        <div className="flex shrink-0 rounded-lg border border-border bg-bg p-0.5" role="radiogroup" aria-label={file.path}>
          <Choice active={value === 'workspace'} onClick={() => onChange('workspace')}>
            {t('workspace.upgradeKeepWorkspace')}
          </Choice>
          <Choice
            active={value === 'template'}
            disabled={!file.canUseTemplate}
            onClick={() => onChange('template')}
          >
            {t('workspace.upgradeUseTemplate')}
          </Choice>
        </div>
      </div>
      <button
        type="button"
        onClick={() => setPreviewOpen((open) => !open)}
        className="oa-pressable mt-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[11px] text-text-muted hover:text-text"
        aria-expanded={previewOpen}
      >
        {previewOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {t('workspace.upgradeCompare')}
      </button>
      {previewOpen && (
        <div className="oa-disclosure-enter mt-2 grid gap-2 lg:grid-cols-2">
          <Preview title={t('workspace.upgradeWorkspaceCopy')} value={file.currentPreview} truncated={file.currentTruncated} />
          <Preview title={t('workspace.upgradeTemplateCopy')} value={file.templatePreview} truncated={file.templateTruncated} />
        </div>
      )}
    </div>
  )
}

function Choice({ active, disabled = false, onClick, children }: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}): ReactElement {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={`oa-pressable rounded-md px-2.5 py-1.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35 ${
        active ? 'bg-accent text-[var(--color-workspace-template-upgrade-panel-on-strong-text)] shadow-sm' : 'text-text-muted hover:text-text'
      }`}
    >
      {children}
    </button>
  )
}

function Preview({ title, value, truncated }: {
  title: string
  value: string | null
  truncated: boolean
}): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-[10px] font-semibold text-text-muted">
        <span>{title}</span>
        {truncated && <span>{t('workspace.upgradePreviewTruncated')}</span>}
      </div>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[10px] leading-relaxed text-text">
        {value ?? t('workspace.upgradeFileMissing')}
      </pre>
    </div>
  )
}
