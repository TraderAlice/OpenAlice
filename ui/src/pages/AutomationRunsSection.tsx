import { useCallback, useEffect, useState } from 'react'

import { api } from '../api'
import type { HeadlessTaskRecord, HeadlessTaskStatus } from '../api/headless'
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
 * Headless runs — the management panel over GET /api/headless. Read-only table
 * of every headless (automation) dispatch across workspaces: who's running
 * what, status, how long. Low-frequency passive surface → simple polling.
 */
export function AutomationRunsSection() {
  const [tasks, setTasks] = useState<HeadlessTaskRecord[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
  if (!tasks) return <div className="text-sm text-muted">Loading…</div>
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
          {tasks.map((t) => (
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
                  title={expanded.has(t.taskId) ? 'Collapse' : 'Expand'}
                >
                  <span className={expanded.has(t.taskId) ? 'whitespace-pre-wrap break-words' : 'line-clamp-2'}>
                    {t.prompt}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted">
                    {expanded.has(t.taskId) ? '▴ collapse' : '▾ expand'}
                  </span>
                </button>
                {t.error ? <div className="mt-0.5 text-xs text-red-400">{t.error}</div> : null}
              </td>
              <td className="whitespace-nowrap py-2 pr-4 font-mono text-xs text-muted">
                {t.wsId.slice(0, 8)}
              </td>
              <td className="whitespace-nowrap py-2 pr-4 text-muted">
                {formatRelativeTime(t.startedAt)}
              </td>
              <td className="whitespace-nowrap py-2 pr-4 text-muted">{fmtDuration(t.durationMs)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
