import { useCallback, useEffect, useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  ExternalLink,
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
import { formatRelativeTime } from '../lib/intl'

const STATUS_STYLE: Record<HeadlessTaskStatus, string> = {
  running: 'bg-[var(--color-automation-runs-section-info-bg-subtle)] text-[var(--color-automation-runs-section-info-text)]',
  done: 'bg-[var(--color-automation-runs-section-success-bg-subtle-alpha-15)] text-[var(--color-automation-runs-section-success-text)]',
  failed: 'bg-[var(--color-automation-runs-section-danger-bg-subtle-alpha-15)] text-[var(--color-automation-runs-section-danger-text)]',
  interrupted: 'bg-[var(--color-automation-runs-section-warning-bg-subtle)] text-[var(--color-automation-runs-section-warning-text)]',
}

const RUNS_PAGE_SIZE = 25

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

function ToolBlock({ block }: { block: Extract<HeadlessMessageBlock, { type: 'tool' }> }) {
  const hasDetails = block.input !== undefined || block.output !== undefined
  const statusClass = block.status === 'failed'
    ? 'text-[var(--color-automation-runs-section-danger-text)]'
    : block.status === 'completed'
      ? 'text-[var(--color-automation-runs-section-success-text)]'
      : 'text-[var(--color-automation-runs-section-info-text)]'
  return (
    <details className="group/tool rounded-lg border border-border/60 bg-bg-secondary/35" open={block.status === 'failed'}>
      <summary className={`flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs ${statusClass}`}>
        <Wrench size={13} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate font-medium text-text">{block.name}</span>
        <span className="shrink-0 uppercase tracking-wide">{block.status}</span>
        {hasDetails && <ChevronRight size={12} className="shrink-0 transition-transform group-open/tool:rotate-90" />}
      </summary>
      {hasDetails && (
        <div className="space-y-2 border-t border-border/50 px-3 py-2">
          {block.input !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted/70">Input</div>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-muted">
                {formatValue(block.input)}
              </pre>
            </div>
          )}
          {block.output !== undefined && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-text-muted/70">Output</div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-muted">
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
  }, [task.taskId, running])

  if (error) return <div className="text-xs text-[var(--color-automation-runs-section-danger-text)]">Output unavailable: {error}</div>
  if (!output) return <div className="text-xs text-text-muted">Loading structured output…</div>

  const tools = output.structured.blocks.filter(
    (block): block is Extract<HeadlessMessageBlock, { type: 'tool' }> => block.type === 'tool',
  )
  const errors = output.structured.blocks.filter(
    (block): block is Extract<HeadlessMessageBlock, { type: 'error' }> => block.type === 'error',
  )

  return (
    <div className="space-y-3">
      <section className="rounded-lg border border-border/70 bg-bg-secondary/25 p-3">
        <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
          <MessageSquareText size={14} />
          Reply
        </div>
        {output.structured.assistantText ? (
          <MarkdownContent text={output.structured.assistantText} className="text-[13px] leading-relaxed" />
        ) : (
          <p className="text-xs text-text-muted">
            {running ? 'Waiting for an assistant reply…' : 'This run produced no assistant reply.'}
          </p>
        )}
      </section>

      {(tools.length > 0 || errors.length > 0) && (
        <section>
          <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-text-muted">
            <Wrench size={13} />
            Activity · {tools.length} tool{tools.length === 1 ? '' : 's'}
          </div>
          <div className="space-y-1.5">
            {tools.map((block) => <ToolBlock key={block.id} block={block} />)}
            {errors.map((block, index) => (
              <div key={`${block.message}-${index}`} className="flex gap-2 rounded-lg border border-[var(--color-automation-runs-section-danger-border-subtle)] bg-[var(--color-automation-runs-section-danger-bg-subtle-alpha-5)] px-3 py-2 text-xs text-[var(--color-automation-runs-section-danger-text)]">
                <CircleAlert size={13} className="mt-0.5 shrink-0" />
                <span className="whitespace-pre-wrap break-words">{block.message}</span>
              </div>
            ))}
          </div>
          {output.structured.truncated && (
            <p className="mt-2 text-[11px] text-[var(--color-automation-runs-section-warning-text)]">Earlier activity was truncated; runtime diagnostics remain available below.</p>
          )}
        </section>
      )}

      <details className="rounded-lg border border-border/60">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text">
          <TerminalSquare size={13} />
          Runtime diagnostics
        </summary>
        <div className="space-y-2 border-t border-border/50 p-2">
          {output.stdout && (
            <pre className="max-h-64 overflow-auto rounded bg-[var(--color-automation-runs-section-neutral-dark-bg-subtle)] p-2 text-[11px] leading-snug text-text-muted whitespace-pre-wrap break-all">
              {output.stdout.truncated ? '… (tail)\n' : ''}
              {output.stdout.text || '(empty)'}
            </pre>
          )}
          {output.stderr && output.stderr.text.length > 0 && (
            <pre className="max-h-32 overflow-auto rounded bg-red-950/20 p-2 text-[11px] leading-snug text-[var(--color-automation-runs-section-danger-text-subtle)] whitespace-pre-wrap break-all">
              {output.stderr.truncated ? '… (tail)\n' : ''}
              {output.stderr.text}
            </pre>
          )}
          {!output.stdout && !output.stderr && <div className="text-xs text-text-muted">No runtime diagnostics for this run.</div>}
        </div>
      </details>
    </div>
  )
}

function SummaryCard({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border/60 bg-bg-secondary/25 px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-text-muted/70">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-text">{value}</div>
      <div className="text-[11px] text-text-muted">{detail}</div>
    </div>
  )
}

/** Cross-workspace control plane for concurrent native-agent runs. */
export function AutomationRunsSection() {
  const [snapshot, setSnapshot] = useState<HeadlessListSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { openHeadlessRun } = useWorkspaces()

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
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
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
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoadingMore(false)
    }
  }

  if (error && !snapshot) return <div className="text-sm text-[var(--color-automation-runs-section-danger-text)]">Failed to load runs: {error}</div>
  if (!snapshot) {
    return (
      <div className="space-y-3" aria-hidden="true">
        <div className="grid grid-cols-3 gap-2">
          {Array.from({ length: 3 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)}
        </div>
        {Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20 rounded-lg" />)}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <SummaryCard
          label="Concurrency"
          value={`${snapshot.capacity.running} / ${snapshot.capacity.limit}`}
          detail={snapshot.capacity.running === 0 ? 'No workers active' : 'Native agent workers active'}
        />
        <SummaryCard
          label="Runs"
          value={String(snapshot.page.total)}
          detail={`Showing ${snapshot.tasks.length} · ${snapshot.summary.done} completed · ${snapshot.summary.needsAttention} need attention`}
        />
        <SummaryCard label="Runtime parsers" value="4" detail="Claude · Codex · OpenCode · Pi" />
      </div>

      {snapshot.tasks.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border p-5 text-sm text-text-muted">
          No headless runs yet. Dispatch one with <code className="text-xs">POST /api/workspaces/:id/headless</code>.
        </div>
      ) : (
        <div className="space-y-2">
          {error && (
            <div className="rounded-lg border border-[var(--color-automation-runs-section-danger-border-subtle)] bg-[var(--color-automation-runs-section-danger-bg-subtle-alpha-5)] px-3 py-2 text-xs text-[var(--color-automation-runs-section-danger-text)]">
              Refresh failed: {error}
            </div>
          )}
          {snapshot.tasks.map((task) => {
            const isExpanded = expanded.has(task.taskId)
            const openable = task.status !== 'running' && task.resumable
            const toolSummary = task.output?.toolCalls
              ? `${task.output.toolCalls} tool${task.output.toolCalls === 1 ? '' : 's'}`
              : task.output
                ? 'No tools used'
                : 'Parse on open'
            return (
              <article
                key={task.taskId}
                data-task-id={task.taskId}
                className="overflow-hidden rounded-xl border border-border/70 bg-bg-secondary/15"
              >
                <button
                  type="button"
                  onClick={() => toggle(task.taskId)}
                  className="flex w-full items-start gap-3 px-3 py-3 text-left hover:bg-bg-tertiary/35"
                  aria-expanded={isExpanded}
                >
                  <span className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_STYLE[task.status]}`}>
                    {task.status}
                  </span>
                  <Bot size={15} className="mt-0.5 shrink-0 text-text-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block max-h-10 overflow-hidden text-[13px] leading-5 text-text">
                      {task.prompt}
                    </span>
                    <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-text-muted">
                      <span>{task.agent}</span>
                      <span className="font-mono">{task.wsId.slice(0, 8)}</span>
                      <span>{formatRelativeTime(task.startedAt)}</span>
                      <span>{fmtDuration(task.durationMs)}</span>
                      <span>{toolSummary}</span>
                    </span>
                  </span>
                  {isExpanded ? <ChevronDown size={15} className="mt-0.5 shrink-0 text-text-muted" /> : <ChevronRight size={15} className="mt-0.5 shrink-0 text-text-muted" />}
                </button>

                {isExpanded && (
                  <div className="space-y-3 border-t border-border/60 px-3 py-3">
                    <details className="rounded-lg border border-border/60 bg-bg-secondary/25">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-text-muted hover:text-text">
                        Task instructions
                      </summary>
                      <pre className="max-h-64 overflow-auto border-t border-border/50 px-3 py-2 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-muted">
                        {task.prompt}
                      </pre>
                    </details>
                    {task.error && (
                      <div className="flex gap-2 rounded-lg border border-[var(--color-automation-runs-section-danger-border-subtle)] bg-[var(--color-automation-runs-section-danger-bg-subtle-alpha-5)] px-3 py-2 text-xs text-[var(--color-automation-runs-section-danger-text)]">
                        <CircleAlert size={13} className="mt-0.5 shrink-0" />
                        {task.error}
                      </div>
                    )}
                    {openable && (
                      <button
                        type="button"
                        className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs text-[var(--color-automation-runs-section-success-text)] hover:bg-[var(--color-automation-runs-section-success-bg-subtle-alpha-10)]"
                        title="Resume this run's conversation in an interactive session"
                        onClick={() => {
                          void openHeadlessRun(task.wsId, task.resumeId, {
                            title: task.prompt,
                          }).catch((e) => setError(e instanceof Error ? e.message : String(e)))
                        }}
                      >
                        <ExternalLink size={12} />
                        Open as session
                      </button>
                    )}
                    <RunOutput task={task} />
                  </div>
                )}
              </article>
            )
          })}
          {snapshot.page.hasMore && (
            <div className="flex flex-col items-center gap-1 pt-2">
              <button
                type="button"
                data-testid="runs-load-more"
                disabled={loadingMore}
                onClick={() => void loadMore()}
                className="rounded-lg border border-border bg-bg-secondary/35 px-4 py-2 text-xs font-medium text-text hover:bg-bg-tertiary disabled:cursor-wait disabled:opacity-60"
              >
                {loadingMore ? 'Loading older runs…' : `Load ${Math.min(RUNS_PAGE_SIZE, snapshot.page.total - snapshot.tasks.length)} older runs`}
              </button>
              <span className="text-[11px] text-text-muted">
                {snapshot.tasks.length} of {snapshot.page.total} loaded
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
