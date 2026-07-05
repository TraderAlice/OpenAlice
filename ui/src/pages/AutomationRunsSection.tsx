import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import type { HeadlessOutput, HeadlessTaskRecord, HeadlessTaskStatus } from '../api/headless'
import { Skeleton } from '../components/StateViews'
import { useWorkspaces } from '../contexts/workspaces-context'
import { formatRelativeTime } from '../lib/intl'

const STATUS_STYLE: Record<HeadlessTaskStatus, string> = {
  running: 'bg-blue-500/15 text-blue-400',
  done: 'bg-emerald-500/15 text-emerald-400',
  failed: 'bg-red-500/15 text-red-400',
  interrupted: 'bg-amber-500/15 text-amber-400',
}

function fmtDuration(ms?: number): string {
  if (ms == null) return '—'
  if (ms < 1000) return `${ms}ms`
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${s % 60}s`
}

/**
 * The expanded row's output log: tail of the run's on-disk stdout/stderr,
 * polled while the run is still going. stdout is the agent's structured
 * event stream (JSONL); shown raw — this is an operator surface.
 */
function OutputLog({ task }: { task: HeadlessTaskRecord }) {
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

  if (error) return <div className="mt-1 text-xs text-red-400">output unavailable: {error}</div>
  if (!output) return <div className="mt-1 text-xs text-muted">loading output…</div>
  if (!output.stdout && !output.stderr) {
    return <div className="mt-1 text-xs text-muted">no output log for this run</div>
  }
  return (
    <div className="mt-2 space-y-2">
      {output.stdout && (
        <pre className="max-h-64 overflow-auto rounded bg-black/30 p-2 text-[11px] leading-snug text-muted whitespace-pre-wrap break-all">
          {output.stdout.truncated ? '… (tail)\n' : ''}
          {output.stdout.text || '(empty)'}
        </pre>
      )}
      {output.stderr && output.stderr.text.length > 0 && (
        <pre className="max-h-32 overflow-auto rounded bg-red-950/20 p-2 text-[11px] leading-snug text-red-300/80 whitespace-pre-wrap break-all">
          {output.stderr.truncated ? '… (tail)\n' : ''}
          {output.stderr.text}
        </pre>
      )}
    </div>
  )
}

/**
 * Headless runs — the management panel over GET /api/headless. Every headless
 * (automation) dispatch across workspaces: who's running what, status, how
 * long. Expanding a row shows the full prompt + the run's output log; a
 * finished run with a captured agent session id can be reopened as a normal
 * interactive session for inspection/takeover. Low-frequency passive surface
 * → simple polling.
 */
export function AutomationRunsSection() {
  const [tasks, setTasks] = useState<HeadlessTaskRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const { spawn } = useWorkspaces()

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const load = useCallback(async () => {
    try {
      setTasks(await api.headless.list({ limit: 100 }))
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

  if (error) return <div className="text-sm text-red-400">Failed to load runs: {error}</div>
  if (!tasks)
    return (
      <div className="space-y-2" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/50 py-2">
            <Skeleton className="h-5 w-16 rounded" />
            <Skeleton className="h-4 w-20 rounded" />
            <Skeleton className="h-4 flex-1 rounded" />
            <Skeleton className="h-4 w-24 rounded" />
            <Skeleton className="h-4 w-16 rounded" />
          </div>
        ))}
      </div>
    )
  if (tasks.length === 0) {
    return (
      <div className="text-sm text-muted">
        No headless runs yet. Dispatch one with{' '}
        <code className="text-xs">POST /api/workspaces/:id/headless</code>.
      </div>
    )
  }

  return (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border text-left text-xs text-muted">
            <th className="py-2 pr-4 font-medium">Status</th>
            <th className="py-2 pr-4 font-medium">Agent</th>
            <th className="py-2 pr-4 font-medium">Task</th>
            <th className="py-2 pr-4 font-medium">Workspace</th>
            <th className="py-2 pr-4 font-medium">Started</th>
            <th className="py-2 pr-4 font-medium">Duration</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((t) => {
            const isExpanded = expanded.has(t.taskId)
            const openable = t.status !== 'running' && !!t.agentSessionId
            return (
              <tr key={t.taskId} className="border-b border-border/50 align-top">
                <td className="py-2 pr-4">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_STYLE[t.status]}`}
                  >
                    {t.status}
                  </span>
                </td>
                <td className="whitespace-nowrap py-2 pr-4">{t.agent}</td>
                <td className="max-w-xl py-2 pr-4">
                  <button
                    type="button"
                    onClick={() => toggle(t.taskId)}
                    className="block w-full cursor-pointer text-left"
                    title={isExpanded ? 'Collapse' : 'Expand'}
                  >
                    <span className={isExpanded ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}>
                      {t.prompt}
                    </span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {isExpanded ? '▴ collapse' : '▾ expand'}
                    </span>
                  </button>
                  {t.error ? <div className="mt-0.5 text-xs text-red-400">{t.error}</div> : null}
                  {isExpanded && (
                    <>
                      {openable && (
                        <button
                          type="button"
                          className="mt-2 rounded border border-border px-2 py-0.5 text-xs text-emerald-400 hover:bg-emerald-500/10"
                          title="resume this run's conversation in an interactive session"
                          onClick={() =>
                            void spawn(t.wsId, { resume: t.agentSessionId!, agent: t.agent })
                          }
                        >
                          ▸ Open as session
                        </button>
                      )}
                      <OutputLog task={t} />
                    </>
                  )}
                </td>
                <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-muted">
                  {t.wsId.slice(0, 8)}
                </td>
                <td className="whitespace-nowrap py-2 pr-4 text-muted">
                  {formatRelativeTime(t.startedAt)}
                </td>
                <td className="whitespace-nowrap py-2 pr-4 text-muted">{fmtDuration(t.durationMs)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
