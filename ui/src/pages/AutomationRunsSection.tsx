import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  ListChecks,
  MessageSquareText,
  TerminalSquare,
  Wrench,
} from 'lucide-react'

import { api } from '../api'
import type {
  HeadlessListSnapshot,
  HeadlessMessageBlock,
  HeadlessOutput,
  HeadlessTaskRecord,
  HeadlessTaskStatus,
} from '../api/headless'
import { MarkdownContent } from '../components/MarkdownContent'
import { Skeleton } from '../components/StateViews'
import { useWorkspaces } from '../contexts/workspaces-context'
import { useIssues } from '../hooks/useIssues'
import { formatRelativeTime } from '../lib/intl'
import { useWorkspace } from '../tabs/store'

const STATUS_STYLE: Record<HeadlessTaskStatus, string> = {
  running: 'bg-info/15 text-info',
  done: 'bg-success/15 text-success',
  failed: 'bg-destructive/15 text-destructive',
  interrupted: 'bg-warning/15 text-warning',
}

const RUNS_PAGE_SIZE = 25
const RUN_PROMPT_SUMMARY_LENGTH = 96

function fmtDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

function formatValue(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function summarizeRunPrompt(prompt: string): string {
  const normalized = prompt.replace(/\s+/g, ' ').trim()
  if (!normalized) return 'Untitled task'

  const characters = Array.from(normalized)
  if (characters.length <= RUN_PROMPT_SUMMARY_LENGTH) return normalized
  return `${characters.slice(0, RUN_PROMPT_SUMMARY_LENGTH - 1).join('').trimEnd()}…`
}

function ToolBlock({ block }: { block: Extract<HeadlessMessageBlock, { type: 'tool' }> }) {
  const hasDetails = block.input !== undefined || block.output !== undefined
  const statusClass = block.status === 'failed'
    ? 'text-destructive'
    : block.status === 'completed'
      ? 'text-success'
      : 'text-info'
  return (
    <details className="group/tool rounded-lg border border-border/60 bg-secondary/35" open={block.status === 'failed'}>
      <summary className={`flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs sm:min-h-0 ${statusClass}`}>
        <Wrench size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium text-foreground">{block.name}</span>
        <span className="shrink-0 uppercase tracking-wide">{block.status}</span>
        {hasDetails && <ChevronRight size={12} className="shrink-0 transition-transform group-open/tool:rotate-90" />}
      </summary>
      {hasDetails && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2">
          {block.input !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Input</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                {formatValue(block.input)}
              </pre>
            </div>
          )}
          {block.output !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">Output</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                {formatValue(block.output)}
              </pre>
            </div>
          )}
        </div>
      )}
    </details>
  )
}

/** Parsed response/tool timeline with bounded runtime diagnostics as fallback. */
function RunOutput({ task }: { task: HeadlessTaskRecord }) {
  const [output, setOutput] = useState<HeadlessOutput | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retryKey, setRetryKey] = useState(0)
  const running = task.status === 'running'

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const out = await api.headless.output(task.taskId)
        if (!cancelled) {
          setOutput(out)
          setError(null)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e))
      }
    }
    void load()
    if (!running) return () => { cancelled = true }
    const id = setInterval(() => void load(), 4000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [task.taskId, retryKey, running])

  if (error && !output) {
    return (
      <div role="alert" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-destructive/60 bg-destructive/5 px-3 py-2 text-xs text-destructive">
        <span>Output unavailable: {error}</span>
        <button
          type="button"
          className="min-h-10 rounded-md border border-destructive/30 px-2.5 py-1 font-medium hover:bg-destructive/10 sm:min-h-0"
          onClick={() => setRetryKey((key) => key + 1)}
        >
          Retry output
        </button>
      </div>
    )
  }
  if (!output) return <div className="text-xs text-muted-foreground">Loading structured output…</div>

  const tools = output.structured.blocks.filter(
    (block): block is Extract<HeadlessMessageBlock, { type: 'tool' }> => block.type === 'tool',
  )
  const errors = output.structured.blocks.filter(
    (block): block is Extract<HeadlessMessageBlock, { type: 'error' }> => block.type === 'error',
  )

  return (
    <div className="space-y-3">
      {error && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-l-2 border-warning/60 bg-warning/5 px-3 py-2 text-xs text-warning">
          <span>Live update paused: {error}. Showing the last available output.</span>
          <button
            type="button"
            className="min-h-10 rounded-md border border-warning/30 px-2.5 py-1 font-medium hover:bg-warning/10 sm:min-h-0"
            onClick={() => setRetryKey((key) => key + 1)}
          >
            Retry now
          </button>
        </div>
      )}
      <section className="border-l-2 border-primary/30 pl-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
          <MessageSquareText size={14} />
          Reply
        </div>
        {output.structured.assistantText ? (
          <MarkdownContent text={output.structured.assistantText} className="text-[13px] leading-relaxed" />
        ) : (
          <p className="text-xs text-muted-foreground">
            {running ? 'Waiting for an assistant reply…' : 'This run produced no assistant reply.'}
          </p>
        )}
      </section>

      {(tools.length > 0 || errors.length > 0) && (
        <section>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
            <Wrench size={13} />
            Activity · {tools.length} tool{tools.length === 1 ? '' : 's'}
          </div>
          <div className="space-y-1.5">
            {tools.map((block) => <ToolBlock key={block.id} block={block} />)}
            {errors.map((block, index) => (
              <div key={`${block.message}-${index}`} className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                <CircleAlert size={13} className="mt-0.5 shrink-0" />
                <span className="whitespace-pre-wrap break-words">{block.message}</span>
              </div>
            ))}
          </div>
          {output.structured.truncated && (
            <p className="mt-2 text-[11px] text-warning">Earlier activity was truncated; runtime diagnostics remain available below.</p>
          )}
        </section>
      )}

      <details className="border-y border-border/60">
        <summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-muted-foreground hover:text-foreground sm:min-h-0">
          <TerminalSquare size={13} />
          Runtime diagnostics
        </summary>
        <div className="space-y-2 border-t border-border/50 p-2">
          {output.stdout && (
            <pre className="max-h-64 overflow-auto rounded bg-code-background p-2 text-[11px] leading-snug text-muted-foreground whitespace-pre-wrap break-all">
              {output.stdout.truncated ? '… (tail)\n' : ''}
              {output.stdout.text || '(empty)'}
            </pre>
          )}
          {output.stderr && output.stderr.text.length > 0 && (
            <pre className="max-h-32 overflow-auto rounded bg-destructive/20 p-2 text-[11px] leading-snug text-destructive/80 whitespace-pre-wrap break-all">
              {output.stderr.truncated ? '… (tail)\n' : ''}
              {output.stderr.text}
            </pre>
          )}
          {!output.stdout && !output.stderr && <div className="text-xs text-muted-foreground">No runtime diagnostics for this run.</div>}
        </div>
      </details>
    </div>
  )
}

function SummaryMetric({
  label,
  mobileLabel = label,
  value,
  detail,
  mobileDetail = detail,
}: {
  label: string
  mobileLabel?: string
  value: string
  detail: string
  mobileDetail?: string
}) {
  return (
    <div className="min-w-0 flex-1 px-2.5 py-2.5 first:pl-0 last:pr-0 sm:px-4">
      <div className="truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70 sm:tracking-[0.1em]">
        <span className="sm:hidden">{mobileLabel}</span>
        <span className="hidden sm:inline">{label}</span>
      </div>
      <div className="mt-0.5 text-base font-semibold tabular-nums text-foreground sm:text-lg">{value}</div>
      <div className="truncate text-[10px] text-muted-foreground sm:overflow-visible sm:text-clip sm:whitespace-normal sm:text-[11px]">
        <span className="sm:hidden">{mobileDetail}</span>
        <span className="hidden sm:inline">{detail}</span>
      </div>
    </div>
  )
}

interface IssueRunIdentity {
  title: string
  workspaceTag: string
}

interface IssueRunSource {
  workspaceId: string
  issueId: string
  label: 'Issue' | 'Reply'
}

function issueIdentityKey(workspaceId: string, issueId: string): string {
  return `${workspaceId}\u0000${issueId}`
}

function issueRunSource(task: HeadlessTaskRecord): IssueRunSource | null {
  if (task.trigger) {
    return { ...task.trigger, label: 'Issue' }
  }
  if (task.inquiry?.subject.kind === 'issue') {
    return {
      workspaceId: task.inquiry.subject.workspaceId,
      issueId: task.inquiry.subject.issueId,
      label: 'Reply',
    }
  }
  return null
}

function AutomationRunTitle({
  task,
  source,
  issue,
}: {
  task: HeadlessTaskRecord
  source: IssueRunSource | null
  issue?: IssueRunIdentity
}) {
  if (!source) {
    return (
      <span className="block max-h-10 overflow-hidden text-[13px] leading-5 text-foreground">
        {task.prompt}
      </span>
    )
  }

  const issueTitle = issue?.title ?? source.issueId
  const issueWorkspace = issue?.workspaceTag ?? source.workspaceId
  const crossWorkspace = source.workspaceId !== task.wsId

  return (
    <>
      <span className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 rounded border border-primary/25 bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-primary">
          {source.label}
        </span>
        <span
          className={`truncate text-[13px] font-medium text-foreground${issue ? '' : ' font-mono'}`}
          title={`Issue: ${issueTitle} · ${issueWorkspace}`}
        >
          {issueTitle}
        </span>
        {crossWorkspace && (
          <span className="shrink-0 truncate text-[10px] text-muted-foreground" title={issueWorkspace}>
            · {issueWorkspace}
          </span>
        )}
      </span>
      <span className="mt-0.5 block truncate text-[12px] leading-5 text-muted-foreground">
        {task.prompt}
      </span>
    </>
  )
}

/** Cross-workspace control plane for concurrent native-agent runs. */
export function AutomationRunsSection() {
  const [snapshot, setSnapshot] = useState<HeadlessListSnapshot | null>(null)
  const [listError, setListError] = useState<string | null>(null)
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [opening, setOpening] = useState<Set<string>>(new Set())
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({})
  const openingRef = useRef(new Set<string>())
  const { openHeadlessRun, workspaces } = useWorkspaces()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const { data: issueSnapshot } = useIssues()
  const workspaceLabels = useMemo(() => new Map(
    workspaces.map((workspace) => {
      const displayName = workspace.displayName?.trim()
      return [
        workspace.id,
        {
          label: workspace.tag,
          title: displayName ? `${displayName} (${workspace.tag})` : workspace.tag,
        },
      ] as const
    }),
  ), [workspaces])
  const issueIdentities = useMemo(() => {
    const identities = new Map<string, IssueRunIdentity>()
    for (const workspace of issueSnapshot?.workspaces ?? []) {
      for (const issue of workspace.issues) {
        identities.set(
          issueIdentityKey(workspace.wsId, issue.id),
          { title: issue.title, workspaceTag: workspace.tag },
        )
      }
    }
    return identities
  }, [issueSnapshot])

  const toggle = (id: string) => setExpanded((prev) => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  })

  const load = useCallback(async () => {
    try {
      const fresh = await api.headless.snapshot({ limit: RUNS_PAGE_SIZE })
      setSnapshot((previous) => {
        if (!previous) {
          return fresh
        }
        // Poll only the cheap first page, then retain already-loaded older
        // pages. Cursor pagination stays stable even when new runs arrive at
        // the top between refreshes.
        const seen = new Set<string>()
        const tasks = [...fresh.tasks, ...previous.tasks].filter((task) => {
          if (seen.has(task.taskId)) return false
          seen.add(task.taskId)
          return true
        }).slice(0, fresh.page.total)
        const hasMore = tasks.length < fresh.page.total
        return {
          ...fresh,
          tasks,
          page: {
            ...fresh.page,
            hasMore,
            nextCursor: hasMore ? tasks.at(-1)?.taskId ?? null : null,
          },
        }
      })
      setListError(null)
    } catch (e) {
      setListError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 4000)
    return () => clearInterval(id)
  }, [load])

  const loadMore = async () => {
    const cursor = snapshot?.page.nextCursor
    if (!snapshot || !cursor || loadingMore) return
    setLoadingMore(true)
    setLoadMoreError(null)
    try {
      const older = await api.headless.snapshot({ limit: RUNS_PAGE_SIZE, cursor })
      setSnapshot((previous) => {
        if (!previous) return older
        const seen = new Set(previous.tasks.map((task) => task.taskId))
        const tasks = [...previous.tasks, ...older.tasks.filter((task) => !seen.has(task.taskId))]
        return {
          ...older,
          tasks,
          page: {
            ...older.page,
            hasMore: older.page.hasMore,
            nextCursor: older.page.hasMore ? tasks.at(-1)?.taskId ?? null : null,
          },
        }
      })
    } catch (e) {
      setLoadMoreError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  const openAsSession = async (task: HeadlessTaskRecord) => {
    if (openingRef.current.has(task.taskId)) return
    openingRef.current.add(task.taskId)
    setOpening((previous) => new Set(previous).add(task.taskId))
    setOpenErrors((previous) => {
      const next = { ...previous }
      delete next[task.taskId]
      return next
    })
    try {
      await openHeadlessRun(task.wsId, task.resumeId, { title: task.prompt })
    } catch (e) {
      setOpenErrors((previous) => ({
        ...previous,
        [task.taskId]: e instanceof Error ? e.message : String(e),
      }))
    } finally {
      openingRef.current.delete(task.taskId)
      setOpening((previous) => {
        const next = new Set(previous)
        next.delete(task.taskId)
        return next
      })
    }
  }

  if (listError && !snapshot) return <div className="text-sm text-destructive">Failed to load runs: {listError}</div>
  if (!snapshot) {
    return (
      <div className="space-y-3" aria-hidden="true">
        <div className="flex divide-x divide-border/60 border-y border-border/70">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="mx-3 my-3 h-12 flex-1 rounded" />)}
        </div>
        <div className="divide-y divide-border/60 border-y border-border/70">
          {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="my-3 h-14 rounded" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-6xl space-y-5">
      <div data-testid="runs-summary" className="flex divide-x divide-border/60 border-y border-border/70">
        <SummaryMetric
          label="Concurrency"
          mobileLabel="Workers"
          value={`${snapshot.capacity.running} / ${snapshot.capacity.limit}`}
          detail={snapshot.capacity.running === 0 ? 'No workers active' : 'Native agent workers active'}
          mobileDetail={snapshot.capacity.running === 0 ? 'Idle' : `${snapshot.capacity.running} active`}
        />
        <SummaryMetric
          label="Runs"
          value={String(snapshot.page.total)}
          detail={`Showing ${snapshot.tasks.length} · ${snapshot.summary.done} completed · ${snapshot.summary.needsAttention} need attention`}
          mobileDetail={snapshot.summary.needsAttention === 0 ? 'All clear' : `${snapshot.summary.needsAttention} attention`}
        />
        <SummaryMetric
          label="Runtime parsers"
          mobileLabel="Parsers"
          value="4"
          detail="Claude · Codex · OpenCode · Pi"
          mobileDetail="CLI formats"
        />
      </div>

      {snapshot.tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          No headless runs yet. Dispatch one with <code className="text-xs">POST /api/workspaces/:id/headless</code>.
        </div>
      ) : (
        <div className="space-y-3">
          {listError && (
            <div role="status" className="border-l-2 border-warning/60 bg-warning/5 px-3 py-2 text-xs text-warning">
              Live updates paused: {listError}. Showing the last available run list.
            </div>
          )}
          <div data-testid="runs-list" className="divide-y divide-border/60 border-y border-border/70">
            {snapshot.tasks.map((task) => {
              const isExpanded = expanded.has(task.taskId)
              const openable = task.status !== 'running' && task.resumable
              const isOpening = opening.has(task.taskId)
              const openError = openErrors[task.taskId]
              const workspaceLabel = workspaceLabels.get(task.wsId)
              const issueSource = issueRunSource(task)
              const issueIdentity = issueSource
                ? issueIdentities.get(issueIdentityKey(issueSource.workspaceId, issueSource.issueId))
                : undefined
              const workspaceName = workspaceLabel?.label ?? task.wsId
              const runSubject = issueIdentity?.title
                ?? issueSource?.issueId
                ?? summarizeRunPrompt(task.prompt)
              const runLabel = `Run details, ${task.status}: ${runSubject}. ${task.agent} in ${workspaceName}.`
              const toolSummary = task.output?.toolCalls
                ? `${task.output.toolCalls} tool${task.output.toolCalls === 1 ? '' : 's'}`
                : task.output
                  ? 'No tools used'
                  : 'Parse on open'
              return (
                <article
                  key={task.taskId}
                  data-task-id={task.taskId}
                  className={isExpanded ? 'bg-secondary/20' : 'bg-transparent'}
                >
                  <button
                    type="button"
                    onClick={() => toggle(task.taskId)}
                    className="group flex w-full items-start gap-3 px-1 py-3 text-left hover:bg-muted/30 sm:px-2"
                    aria-expanded={isExpanded}
                    aria-label={runLabel}
                  >
                    <span className={`mt-1 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${STATUS_STYLE[task.status]}`}>
                      {task.status}
                    </span>
                    <Bot size={14} className="mt-1 shrink-0 text-muted-foreground/70" />
                    <span className="min-w-0 flex-1">
                      <AutomationRunTitle task={task} source={issueSource} issue={issueIdentity} />
                      <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                        <span>{task.agent}</span>
                        <span
                          className={workspaceLabel ? undefined : 'font-mono'}
                          title={workspaceLabel?.title ?? task.wsId}
                        >
                          {workspaceLabel?.label ?? task.wsId}
                        </span>
                        <span>{formatRelativeTime(task.startedAt)}</span>
                        <span>{fmtDuration(task.durationMs)}</span>
                        <span>{toolSummary}</span>
                      </span>
                    </span>
                    {isExpanded ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-muted-foreground" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-muted-foreground" />}
                  </button>

                  {isExpanded && (
                    <div className="space-y-3 border-t border-border/50 px-1 py-3 sm:px-2">
                      <details className="border-b border-border/60">
                        <summary className="flex min-h-10 cursor-pointer items-center px-3 py-2 text-xs font-medium text-muted-foreground hover:text-foreground sm:min-h-0">
                          Task instructions
                        </summary>
                        <pre className="max-h-64 overflow-auto border-t border-border/50 px-3 py-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
                          {task.prompt}
                        </pre>
                      </details>
                      {task.error && (
                        <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          <CircleAlert size={13} className="mt-0.5 shrink-0" />
                          {task.error}
                        </div>
                      )}
                      {(issueSource || openable) && (
                        <div className="flex flex-wrap items-center gap-2">
                          {issueSource && (
                            <button
                              type="button"
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-primary hover:bg-primary/10 sm:min-h-0"
                              onClick={() => openOrFocus({
                                kind: 'issue-detail',
                                params: {
                                  wsId: issueSource.workspaceId,
                                  id: issueSource.issueId,
                                },
                              })}
                            >
                              <ListChecks size={12} />
                              Open Issue
                            </button>
                          )}
                          {openable && (
                            <button
                              type="button"
                              disabled={isOpening}
                              aria-busy={isOpening}
                              className="inline-flex min-h-10 items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-success hover:bg-success/10 disabled:cursor-wait disabled:opacity-60 sm:min-h-0"
                              title="Resume this run's conversation in an interactive session"
                              onClick={() => void openAsSession(task)}
                            >
                              <ExternalLink size={12} />
                              {isOpening ? 'Opening…' : 'Open as session'}
                            </button>
                          )}
                        </div>
                      )}
                      {openError && (
                        <div role="alert" className="border-l-2 border-destructive/60 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                          Could not open this run as a session: {openError}
                        </div>
                      )}
                      <RunOutput task={task} />
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          {snapshot.page.hasMore && (
            <div className="flex flex-col items-center gap-1 pt-2">
              <button
                type="button"
                data-testid="runs-load-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="min-h-10 rounded-lg border border-border bg-secondary/35 px-4 py-2 text-xs font-medium text-foreground hover:bg-muted disabled:cursor-wait disabled:opacity-60 sm:min-h-0"
              >
                {loadingMore ? 'Loading older runs…' : `Load ${Math.min(RUNS_PAGE_SIZE, snapshot.page.total - snapshot.tasks.length)} older runs`}
              </button>
              <span className="text-[11px] text-muted-foreground">
                {snapshot.tasks.length} of {snapshot.page.total} loaded
              </span>
              {loadMoreError && (
                <span role="alert" className="text-[11px] text-destructive">
                  Could not load older runs: {loadMoreError}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
