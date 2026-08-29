import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api'
import type { AgentRuntimeEvent, AgentRuntimeEventType } from '../api/agentRuntimeLog'
import { formatRelativeTime } from '../lib/intl'
import { OFFICE_LOG_ASSETS, officeLogAssetKind } from '../office/log-assets'
import { useWorkspace } from '../tabs/store'

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
          const kind = officeLogAssetKind(event.type)
          const meta = [
            payload.surface,
            causeLabel(event),
            payload.status,
            payload.metrics
              ? `${payload.metrics.textBlocks} text · ${payload.metrics.toolCalls} tools${payload.metrics.toolFailures > 0 ? ` · ${payload.metrics.toolFailures} failed` : ''}`
              : null,
            payload.reason,
            payload.launchErrorCode,
          ].filter((value): value is string => Boolean(value))
          return (
            <article key={event.seq} className="oa-office-runtime__event" data-kind={kind}>
              <div className="oa-office-runtime__badge" aria-hidden>
                <img src={OFFICE_LOG_ASSETS[kind]} alt="" />
              </div>
              <div className="oa-office-runtime__content">
                <header className="oa-office-runtime__heading">
                  <span className="oa-office-runtime__type">{eventLabel(event.type)}</span>
                  <span className="oa-office-runtime__seq">#{String(event.seq).padStart(4, '0')}</span>
                  <time dateTime={new Date(event.ts).toISOString()}>{formatRelativeTime(event.ts)}</time>
                </header>
                <div className="oa-office-runtime__identity">
                  <strong>@{payload.resumeId || '—'}</strong>
                  <span>{payload.agent || '—'} · {payload.workspaceId || '—'}</span>
                </div>
                {detail && (
                  <p className="oa-office-runtime__detail">
                    {detail}
                  </p>
                )}
                <ul className="oa-office-runtime__meta" aria-label={t('office.eventDetails')}>
                  {meta.map((item, index) => <li key={`${item}-${index}`}>{item}</li>)}
                </ul>
              </div>
              {payload.taskId && (
                <button
                  type="button"
                  className="oa-office-runtime__open"
                  onClick={() => openOrFocus({ kind: 'automation', params: { section: 'runs' } })}
                >
                  <span aria-hidden>A</span>
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
