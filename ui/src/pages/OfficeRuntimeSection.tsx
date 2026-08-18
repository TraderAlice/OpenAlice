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
  'dev.sonner_test': 'bg-secondary text-muted-foreground',
}

function eventLabel(type: AgentRuntimeEventType): string {
  if (type === 'runtime.turn.text') return 'text'
  if (type === 'runtime.turn.tool') return 'tool'
  if (type === 'runtime.turn.error') return 'error'
  if (type === 'dev.sonner_test') return 'Sonner test'
  return type.replace('runtime.', '').replace('session.', '')
}

function eventDetail(event: AgentRuntimeEvent): string | null {
  const payload = event.payload
  if (event.type === 'runtime.turn.text') return payload.text ?? null
  if (event.type === 'runtime.turn.tool') {
    return [payload.toolName, payload.toolStatus].filter(Boolean).join(' · ') || null
  }
  if (event.type === 'runtime.turn.error') return payload.message ?? payload.error ?? null
  if (event.type === 'dev.sonner_test') return payload.message ?? null
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
    return <div className="oa-office-runtime__empty">{t('office.loading')}</div>
  }

  if (error && entries.length === 0) {
    return (
      <div role="alert" className="oa-office-runtime__error">
        {t('office.loadFailed')}: {error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="oa-office-runtime__empty">
        {t('office.empty')}
      </div>
    )
  }

  return (
    <div className="oa-office-runtime">
      {error && (
        <div role="status" className="oa-office-runtime__error">
          {t('office.paused')}: {error}
        </div>
      )}
      <div data-testid="runtime-log" className="oa-office-runtime__log">
        {entries.map((event) => {
          const payload = event.payload
          const detail = eventDetail(event)
          return (
            <article key={event.seq} className="oa-office-runtime__event">
              <span className={`inline-flex max-w-full rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] ${STATUS_STYLE[event.type]}`}>
                {eventLabel(event.type)}
              </span>
              <div className="min-w-0">
                <div className="break-words text-sm text-foreground">
                  <span className="font-medium">@{payload.resumeId || '—'}</span>
                  <span className="text-muted-foreground"> · {payload.agent || '—'} · {payload.workspaceId || '—'}</span>
                </div>
                {detail && (
                  <p className="oa-office-runtime__detail">
                    {detail}
                  </p>
                )}
                <div className="oa-office-runtime__meta">
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
                  className="oa-office-runtime__open"
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
