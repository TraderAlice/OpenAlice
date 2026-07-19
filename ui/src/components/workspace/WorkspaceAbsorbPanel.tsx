import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  AlertTriangle,
  Archive,
  ArrowRight,
  Check,
  ChevronDown,
  ChevronRight,
  FileInput,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react'

import {
  applyWorkspaceAbsorb,
  getWorkspaceAbsorbPlan,
  WorkspaceAbsorbApiError,
  type Workspace,
  type WorkspaceAbsorbFilePlan,
  type WorkspaceAbsorbPlan,
  type WorkspaceAbsorbResolution,
  type WorkspaceAbsorbResult,
} from './api'

interface Props {
  readonly target: Workspace
  readonly workspaces: readonly Workspace[]
  readonly onWorkspaceChanged: () => void
  readonly onClose: () => void
}

/**
 * Directional consolidation: the open Workspace survives, the selected source
 * leaves the active list. The surface repeats that direction at every risky
 * step so “merge” can never mean an ambiguous two-way filesystem operation.
 */
export function WorkspaceAbsorbPanel({
  target,
  workspaces,
  onWorkspaceChanged,
  onClose,
}: Props): ReactElement {
  const candidates = useMemo(
    () => workspaces.filter((workspace) => workspace.id !== target.id),
    [target.id, workspaces],
  )
  const [sourceId, setSourceId] = useState('')
  const [plan, setPlan] = useState<WorkspaceAbsorbPlan | null>(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<WorkspaceAbsorbResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, WorkspaceAbsorbResolution>>({})

  const load = useCallback(async (): Promise<void> => {
    if (!sourceId) {
      setPlan(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const next = await getWorkspaceAbsorbPlan(target.id, sourceId)
      setPlan(next)
      // Keeping both is the loss-minimizing default. A user still reviews each
      // collision, but merely opening the page can never discard either copy.
      setResolutions(Object.fromEntries(
        next.files
          .filter((file) => file.status === 'conflict')
          .map((file) => [file.path, 'both' as const]),
      ))
    } catch (err) {
      if (err instanceof WorkspaceAbsorbApiError && err.plan) setPlan(err.plan)
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [sourceId, target.id])

  useEffect(() => { void load() }, [load])

  const conflicts = plan?.files.filter((file) => file.status === 'conflict') ?? []
  const unresolved = conflicts.filter((file) => !resolutions[file.path]).length
  const canApply = !!plan && !plan.blocked && unresolved === 0 && !applying

  const apply = async (): Promise<void> => {
    if (!plan || !canApply) return
    setApplying(true)
    setError(null)
    try {
      const next = await applyWorkspaceAbsorb(
        target.id,
        plan.source.id,
        plan.planDigest,
        resolutions,
      )
      setResult(next)
      onWorkspaceChanged()
    } catch (err) {
      if (err instanceof WorkspaceAbsorbApiError && err.plan) {
        setPlan(err.plan)
        setResolutions(Object.fromEntries(
          err.plan.files
            .filter((file) => file.status === 'conflict')
            .map((file) => [file.path, resolutions[file.path] ?? 'both']),
        ))
      }
      setError((err as Error).message)
    } finally {
      setApplying(false)
    }
  }

  if (result) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-1 items-center justify-center overflow-y-auto p-6 text-center">
          <div className="max-w-md">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success/10 text-success">
              <Check size={24} />
            </div>
            <h3 className="mt-4 text-[16px] font-semibold text-foreground">Workspace absorbed</h3>
            <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">
              The source desk is archived intact. {result.changedPaths.length} reviewed file{result.changedPaths.length === 1 ? '' : 's'} landed in this Workspace.
            </p>
            <div className="mt-4 rounded-lg border border-border bg-secondary/35 px-3 py-2 text-left">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Audit commit</div>
              <code className="mt-1 block font-mono text-[12px] text-foreground">{result.commit}</code>
            </div>
          </div>
        </div>
        <div className="flex justify-end border-t border-border bg-secondary/30 p-3">
          <button type="button" onClick={onClose} className="btn-primary">Done</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
        <section className="overflow-hidden rounded-xl border border-border bg-secondary/25">
          <div className="p-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/75">
              <FileInput size={14} />
              Absorb another Workspace
            </div>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              Bring reviewed working files into this desk, then archive the source intact. Sessions, credentials, schedules, and authorship never move.
            </p>
            <div className="mt-4 grid items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr] sm:items-center">
              <DirectionCard label="Keep this Workspace" workspace={target} tone="target" />
              <ArrowRight size={16} className="mx-auto rotate-90 text-muted-foreground sm:rotate-0" />
              <label className="flex min-w-0 flex-col justify-center rounded-lg border border-dashed border-border bg-background px-3 py-2.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Archive after absorb</span>
                <select
                  value={sourceId}
                  onChange={(event) => {
                    setSourceId(event.target.value)
                    setPlan(null)
                    setResult(null)
                    setError(null)
                  }}
                  className="mt-1 min-w-0 bg-transparent text-[13px] font-semibold text-foreground outline-none"
                  aria-label="Workspace to absorb"
                >
                  <option value="">Choose a Workspace…</option>
                  {candidates.map((workspace) => (
                    <option key={workspace.id} value={workspace.id}>
                      {workspace.displayName?.trim() || workspace.tag}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        {!sourceId && candidates.length === 0 && (
          <div className="rounded-lg border border-border bg-secondary/25 px-3 py-3 text-[12px] text-muted-foreground">
            There is no other active Workspace to absorb.
          </div>
        )}

        {loading && !plan && (
          <div className="flex min-h-40 items-center justify-center gap-2 text-[12px] text-muted-foreground">
            <LoaderCircle size={15} className="animate-spin" />
            Reviewing both Workspaces…
          </div>
        )}

        {plan && (
          <>
            <section className="overflow-hidden rounded-xl border border-border bg-secondary/25">
              <div className="flex items-center justify-between gap-3 p-3.5">
                <div>
                  <div className="text-[12px] font-semibold text-foreground">What comes over</div>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">Git-tracked and non-ignored working files only.</p>
                </div>
                <button
                  type="button"
                  onClick={() => void load()}
                  disabled={loading || applying}
                  className="oa-pressable inline-flex min-h-8 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 text-[11px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
                  Refresh
                </button>
              </div>
              <div className="grid grid-cols-4 border-t border-border bg-background/45">
                <Metric value={plan.summary.ready} label="New" tone="accent" />
                <Metric value={plan.summary.duplicates} label="Same" tone="neutral" />
                <Metric value={plan.summary.conflicts} label="Decide" tone="warning" />
                <Metric value={plan.summary.excluded} label="Stays behind" tone="neutral" />
              </div>
            </section>

            <RetirementImpact plan={plan} />

            {plan.summary.ready === 0 && plan.summary.conflicts === 0 && (
              <div className="rounded-lg border border-border bg-secondary/25 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                No source working files need copying. Continuing will only archive the source desk and preserve its history.
              </div>
            )}

            {plan.blocked && <ActivityBlockers plan={plan} />}

            {plan.summary.ready > 0 && (
              <FileGroup
                title="Ready to bring over"
                description="These paths are free in the target Workspace."
                files={plan.files.filter((file) => file.status === 'ready')}
                icon="ready"
                defaultOpen
              />
            )}

            {plan.summary.duplicates > 0 && (
              <FileGroup
                title="Already identical"
                description="No second copy or rewrite is needed."
                files={plan.files.filter((file) => file.status === 'duplicate')}
                icon="same"
              />
            )}

            {conflicts.length > 0 && (
              <section className="overflow-hidden rounded-xl border border-warning/35 bg-secondary/20">
                <div className="border-b border-border px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                    <AlertTriangle size={15} className="text-warning" />
                    Paths that need a decision
                    <span className="rounded-full bg-warning/12 px-2 py-0.5 text-[10px] text-warning">{conflicts.length}</span>
                  </div>
                  <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                    Keep both is selected by default and places the source copy below <code className="font-mono">{plan.importRoot}</code>.
                  </p>
                </div>
                <div className="divide-y divide-border">
                  {conflicts.map((file) => (
                    <ConflictFile
                      key={file.path}
                      file={file}
                      value={resolutions[file.path]}
                      onChange={(value) => setResolutions((current) => ({ ...current, [file.path]: value }))}
                    />
                  ))}
                </div>
              </section>
            )}
          </>
        )}

        {error && (
          <div className="rounded-lg border border-destructive/35 bg-destructive/8 px-3 py-2.5 text-[12px] text-destructive" role="alert">
            {error}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border bg-secondary/30 p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-h-5 text-[11px] text-muted-foreground">
          {plan && !plan.blocked && unresolved === 0 && (
            <>The source will leave the active Workspace list but remain restorable.</>
          )}
          {plan && unresolved > 0 && <>Resolve {unresolved} path collision{unresolved === 1 ? '' : 's'} first.</>}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={applying} className="btn-secondary">Cancel</button>
          <button
            type="button"
            onClick={() => void apply()}
            disabled={!canApply}
            className="oa-pressable inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {applying ? <LoaderCircle size={14} className="animate-spin" /> : <Archive size={14} />}
            {applying ? 'Absorbing…' : plan ? 'Absorb and archive source' : 'Choose a Workspace'}
          </button>
        </div>
      </div>
    </div>
  )
}

function DirectionCard({ label, workspace, tone }: {
  label: string
  workspace: Workspace
  tone: 'target'
}): ReactElement {
  return (
    <div className={`min-w-0 rounded-lg border px-3 py-2.5 ${tone === 'target' ? 'border-primary/35 bg-primary/6' : 'border-border bg-background'}`}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-[13px] font-semibold text-foreground">{workspace.displayName?.trim() || workspace.tag}</div>
      <code className="mt-0.5 block truncate font-mono text-[10px] text-muted-foreground">{workspace.tag}</code>
    </div>
  )
}

function Metric({ value, label, tone }: {
  value: number
  label: string
  tone: 'accent' | 'neutral' | 'warning'
}): ReactElement {
  const color = tone === 'accent' ? 'text-primary' : tone === 'warning' ? 'text-warning' : 'text-foreground'
  return (
    <div className="border-r border-border px-2 py-2.5 text-center last:border-r-0">
      <div className={`text-[16px] font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-0.5 truncate text-[10px] text-muted-foreground">{label}</div>
    </div>
  )
}

function RetirementImpact({ plan }: { plan: WorkspaceAbsorbPlan }): ReactElement {
  const inventory = plan.sourceInventory
  const facts = [
    `${inventory.sessions} Session record${inventory.sessions === 1 ? '' : 's'}`,
    `${inventory.resumeIds} signed conversation${inventory.resumeIds === 1 ? '' : 's'}`,
    `${inventory.openIssues.length} open Issue${inventory.openIssues.length === 1 ? '' : 's'}`,
    `${inventory.scheduledIssues.length} schedule${inventory.scheduledIssues.length === 1 ? '' : 's'} stopped`,
  ]
  return (
    <section className="rounded-xl border border-border bg-secondary/20 px-4 py-3">
      <div className="flex items-start gap-3">
        <Users size={16} className="mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-foreground">What retires with {plan.source.tag}</div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {facts.join(' · ')}. They remain in the archived desk for audit and restore; they do not become target identities.
          </p>
        </div>
      </div>
    </section>
  )
}

function ActivityBlockers({ plan }: { plan: WorkspaceAbsorbPlan }): ReactElement {
  const activities = [
    ...plan.activity.source.sessions.map((item) => `${plan.source.tag}: ${item.name} (${item.agent}, ${item.surface})`),
    ...plan.activity.source.headless.map((item) => `${plan.source.tag}: ${item.taskId ?? 'synchronous run'} (${item.agent})`),
    ...plan.activity.target.sessions.map((item) => `${plan.target.tag}: ${item.name} (${item.agent}, ${item.surface})`),
    ...plan.activity.target.headless.map((item) => `${plan.target.tag}: ${item.taskId ?? 'synchronous run'} (${item.agent})`),
  ]
  return (
    <div className="rounded-lg border border-warning/35 bg-warning/8 px-3 py-3 text-[12px] text-foreground">
      <div className="flex items-center gap-2 font-semibold text-warning">
        <AlertTriangle size={15} />
        Finish the real work listed below before absorbing
      </div>
      <ul className="mt-2 space-y-1.5 pl-5 text-muted-foreground">
        {activities.map((item) => <li key={item}>{item}</li>)}
        {plan.blockers.includes('target_staged_changes') && <li>The target has staged Git changes. Commit or unstage them first.</li>}
      </ul>
    </div>
  )
}

function FileGroup({ title, description, files, icon, defaultOpen = false }: {
  title: string
  description: string
  files: readonly WorkspaceAbsorbFilePlan[]
  icon: 'ready' | 'same'
  defaultOpen?: boolean
}): ReactElement {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <section className="rounded-xl border border-border bg-secondary/20">
      <button type="button" onClick={() => setOpen((value) => !value)} className="oa-pressable flex w-full items-start gap-3 rounded-xl px-4 py-3 text-left" aria-expanded={open}>
        {open ? <ChevronDown size={15} className="mt-0.5 text-muted-foreground" /> : <ChevronRight size={15} className="mt-0.5 text-muted-foreground" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            {title}
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">{files.length}</span>
          </div>
          <p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
        </div>
      </button>
      {open && (
        <div className="oa-disclosure-enter border-t border-border px-4 py-2">
          {files.map((file) => (
            <div key={file.path} className="flex items-center gap-2 border-b border-border/60 py-2 last:border-b-0">
              {icon === 'ready' ? <Check size={13} className="text-primary" /> : <ShieldCheck size={13} className="text-muted-foreground" />}
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-foreground" title={file.path}>{file.path}</code>
              <span className="text-[10px] text-muted-foreground">{formatBytes(file.sourceSize)}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function ConflictFile({ file, value, onChange }: {
  file: WorkspaceAbsorbFilePlan
  value?: WorkspaceAbsorbResolution
  onChange: (value: WorkspaceAbsorbResolution) => void
}): ReactElement {
  const [previewOpen, setPreviewOpen] = useState(false)
  return (
    <div className="px-4 py-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <code className="block truncate font-mono text-[11px] font-semibold text-foreground" title={file.path}>{file.path}</code>
          <p className="mt-1 text-[10px] text-muted-foreground">Source {formatBytes(file.sourceSize)} · Target {file.targetSize === null ? 'non-file path' : formatBytes(file.targetSize)}</p>
        </div>
        <div className="flex shrink-0 flex-wrap rounded-lg border border-border bg-background p-0.5" role="radiogroup" aria-label={file.path}>
          <Choice active={value === 'target'} onClick={() => onChange('target')}>Keep target</Choice>
          <Choice active={value === 'source'} disabled={!file.canUseSource} onClick={() => onChange('source')}>Use source</Choice>
          <Choice active={value === 'both'} onClick={() => onChange('both')}>Keep both</Choice>
        </div>
      </div>
      <button type="button" onClick={() => setPreviewOpen((open) => !open)} className="oa-pressable mt-2 inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-[11px] text-muted-foreground hover:text-foreground" aria-expanded={previewOpen}>
        {previewOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        Compare
      </button>
      {previewOpen && (
        <div className="oa-disclosure-enter mt-2 grid gap-2 lg:grid-cols-2">
          <Preview title="Target copy" value={file.targetPreview} truncated={file.targetTruncated} />
          <Preview title="Source copy" value={file.sourcePreview} truncated={file.sourceTruncated} />
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
    <button type="button" role="radio" aria-checked={active} disabled={disabled} onClick={onClick} className={`oa-pressable rounded-md px-2.5 py-1.5 text-[10px] font-medium disabled:cursor-not-allowed disabled:opacity-35 ${active ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
      {children}
    </button>
  )
}

function Preview({ title, value, truncated }: { title: string; value: string | null; truncated: boolean }): ReactElement {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border px-2.5 py-1.5 text-[10px] font-semibold text-muted-foreground">
        <span>{title}</span>
        {truncated && <span>Preview truncated</span>}
      </div>
      <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[10px] leading-relaxed text-foreground">
        {value ?? 'Binary file or non-file path'}
      </pre>
    </div>
  )
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(value < 10 * 1024 ? 1 : 0)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}
