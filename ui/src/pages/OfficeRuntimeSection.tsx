import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api'
import type { AgentRuntimeEvent, AgentRuntimeEventType } from '../api/agentRuntimeLog'
import { formatRelativeTime } from '../lib/intl'
import { useWorkspace } from '../tabs/store'

const STATUS_STYLE: Record<AgentRuntimeEventType, string> = {
  'session.born': 'bg-muted text-muted-foreground',
  'runtime.started': 'bg-info/15 text-info',
  'runtime.spawn_failed': 'bg-destructive/15 text-destructive',
  'runtime.stopped': 'bg-secondary text-foreground',
  'runtime.rejected': 'bg-warning/15 text-warning',
  'runtime.turn.text': 'bg-primary/10 text-foreground',
  'runtime.turn.tool': 'bg-info/10 text-info',
  'runtime.turn.error': 'bg-destructive/15 text-destructive',
}

function eventLabel(type: AgentRuntimeEventType): string {
  if (type === 'runtime.turn.text') return 'text'
  if (type === 'runtime.turn.tool') return 'tool'
  if (type === 'runtime.turn.error') return 'error'
  return type.replace('runtime.', '').replace('session.', '')
}

function eventDetail(event: AgentRuntimeEvent): string | null {
  const payload = event.payload
  if (event.type === 'runtime.turn.text') return payload.text ?? null
  if (event.type === 'runtime.turn.tool') {
    return [payload.toolName, payload.toolStatus].filter(Boolean).join(' · ') || null
  }
  if (event.type === 'runtime.turn.error') return payload.message ?? payload.error ?? null
  if (event.type === 'runtime.stopped' && payload.assistantText) return payload.assistantText
  return null
}

function causeLabel(event: AgentRuntimeEvent): string {
  const cause = event.payload.cause
  if (!cause) return '—'
  if (cause.kind === 'issue') return `issue ${cause.issueId}`
  if (cause.kind === 'conversation') {
    const from = cause.from?.kind === 'session'
      ? `@${cause.from.resumeId}`
      : cause.from?.kind === 'workspace'
        ? cause.from.workspaceId
        : cause.from?.kind ?? 'human'
    return `ask ${from}`
  }
  return cause.kind
}

export function OfficeRuntimeSection() {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [entries, setEntries] = useState<AgentRuntimeEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const page = await api.agentRuntime.query({ page: 1, pageSize: 50 })
      setEntries(page.entries)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const id = setInterval(() => void load(), 4000)
    return () => clearInterval(id)
  }, [load])

  if (loading && entries.length === 0) {
    return <div className="text-sm text-muted-foreground">{t('office.loading')}</div>
  }

  if (error && entries.length === 0) {
    return (
      <div role="alert" className="text-sm text-destructive">
        {t('office.loadFailed')}: {error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
        {t('office.empty')}
      </div>
    )
  }

  return (
    <div className="max-w-6xl space-y-3">
      {error && (
        <div role="status" className="border-l-2 border-warning/60 bg-warning/5 px-3 py-2 text-xs text-warning">
          {t('office.paused')}: {error}
        </div>
      )}
      <div data-testid="runtime-log" className="divide-y divide-border/60 border-y border-border/70">
        {entries.map((event) => {
          const payload = event.payload
          const detail = eventDetail(event)
          return (
            <article key={event.seq} className="flex flex-wrap items-start gap-3 px-1 py-3 sm:px-2">
              <span className={`mt-0.5 inline-flex rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${STATUS_STYLE[event.type]}`}>
                {eventLabel(event.type)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-sm text-foreground">
                  <span className="font-medium">@{payload.resumeId || '—'}</span>
                  <span className="text-muted-foreground"> · {payload.agent || '—'} · {payload.workspaceId || '—'}</span>
                </div>
                {detail && (
                  <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[13px] text-foreground/90">
                    {detail}
                  </p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span>{formatRelativeTime(event.ts)}</span>
                  {payload.surface && <span>{payload.surface}</span>}
                  <span>{causeLabel(event)}</span>
                  {payload.status && <span>{payload.status}</span>}
                  {payload.metrics && (
                    <span>
                      {payload.metrics.textBlocks} text · {payload.metrics.toolCalls} tools
                      {payload.metrics.toolFailures > 0 ? ` · ${payload.metrics.toolFailures} failed` : ''}
                    </span>
                  )}
                  {payload.reason && <span>{payload.reason}</span>}
                  {payload.launchErrorCode && <span>{payload.launchErrorCode}</span>}
                </div>
              </div>
              {payload.taskId && (
                <button
                  type="button"
                  className="oa-pressable rounded-md border border-border px-2 py-1 text-xs text-primary hover:bg-primary/10"
                  onClick={() => openOrFocus({ kind: 'automation', params: { section: 'runs' } })}
                >
                  {t('office.openRun')}
                </button>
              )}
            </article>
          )
        })}
      </div>
    </div>
  )
}
