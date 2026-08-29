import { useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api'
import type { AgentRuntimeEvent, AgentRuntimeEventType } from '../api/agentRuntimeLog'
import { formatRelativeTime } from '../lib/intl'
import { officePixelImg } from '../office/furniture'
import { OFFICE_HUD_ASSETS } from '../office/hud-assets'
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

function causeLabel(event: AgentRuntimeEvent): string | null {
  const cause = event.payload.cause
  if (!cause) return null
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
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
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

  useEffect(() => {
    if (entries.length === 0) {
      setSelectedSeq(null)
      return
    }
    setSelectedSeq((current) => entries.some((event) => event.seq === current)
      ? current
      : entries[0].seq)
  }, [entries])

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

  const selectedEvent = entries.find((event) => event.seq === selectedSeq) ?? entries[0]
  const selectedPayload = selectedEvent.payload
  const selectedDetail = eventDetail(selectedEvent)
  const selectedKind = officeLogAssetKind(selectedEvent.type)
  const selectedMeta: Array<{ label: string; value: string }> = []
  const addMeta = (label: string, value: string | null | undefined) => {
    if (value) selectedMeta.push({ label, value })
  }
  addMeta(t('office.surface'), selectedPayload.surface)
  addMeta(t('office.eventCause'), causeLabel(selectedEvent))
  addMeta(t('office.status'), selectedPayload.status)
  if (selectedPayload.metrics) {
    const metrics: string[] = [
      t('office.eventTextBlocks', { count: selectedPayload.metrics.textBlocks }),
      t('office.eventToolCalls', { count: selectedPayload.metrics.toolCalls }),
    ]
    if (selectedPayload.metrics.toolFailures > 0) {
      metrics.push(t('office.eventToolFailures', { count: selectedPayload.metrics.toolFailures }))
    }
    addMeta(t('office.eventOutput'), metrics.join(' · '))
  }
  addMeta(t('office.eventReason'), selectedPayload.reason)
  addMeta(t('office.eventErrorCode'), selectedPayload.launchErrorCode)
  const moveJournalSelection = (keyboardEvent: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = Array.from(
      keyboardEvent.currentTarget.closest('ol')
        ?.querySelectorAll<HTMLButtonElement>('button') ?? [],
    )
    const index = buttons.indexOf(keyboardEvent.currentTarget)
    const nextIndex = keyboardEvent.key === 'ArrowDown'
      ? Math.min(buttons.length - 1, index + 1)
      : keyboardEvent.key === 'ArrowUp'
        ? Math.max(0, index - 1)
        : keyboardEvent.key === 'Home'
          ? 0
          : keyboardEvent.key === 'End'
            ? buttons.length - 1
            : null
    if (nextIndex == null || nextIndex === index) return
    keyboardEvent.preventDefault()
    const next = buttons[nextIndex]
    next.focus()
    setSelectedSeq(Number(next.dataset.seq))
  }

  return (
    <div className="oa-office-runtime">
      {error && (
        <div role="status" className="oa-office-runtime__error">
          {t('office.paused')}: {error}
        </div>
      )}
      <div data-testid="runtime-log" className="oa-office-runtime__journal">
        <ol className="oa-office-runtime__index" aria-label={t('office.timeline')}>
          {entries.map((event) => {
            const payload = event.payload
            const kind = officeLogAssetKind(event.type)
            const active = event.seq === selectedEvent.seq
            return (
              <li key={event.seq}>
                <button
                  type="button"
                  aria-pressed={active}
                  data-kind={kind}
                  data-seq={event.seq}
                  onClick={() => setSelectedSeq(event.seq)}
                  onKeyDown={moveJournalSelection}
                >
                  <img src={OFFICE_LOG_ASSETS[kind]} alt="" aria-hidden style={officePixelImg} />
                  <span className="oa-office-runtime__index-copy">
                    <strong>{eventLabel(event.type)}</strong>
                    <small>@{payload.resumeId || '—'}</small>
                  </span>
                  <span className="oa-office-runtime__index-meta">
                    <b>#{String(event.seq).padStart(4, '0')}</b>
                    <time dateTime={new Date(event.ts).toISOString()}>{formatRelativeTime(event.ts)}</time>
                  </span>
                  <img
                    className="oa-office-runtime__cursor"
                    src={OFFICE_HUD_ASSETS.journalCursor}
                    alt=""
                    aria-hidden
                    style={officePixelImg}
                  />
                </button>
              </li>
            )
          })}
        </ol>

        <article className="oa-office-runtime__event" data-kind={selectedKind}>
          <div className="oa-office-runtime__badge" aria-hidden>
            <img src={OFFICE_LOG_ASSETS[selectedKind]} alt="" style={officePixelImg} />
          </div>
          <div className="oa-office-runtime__content">
            <header className="oa-office-runtime__heading">
              <span className="oa-office-runtime__type">{eventLabel(selectedEvent.type)}</span>
              <span className="oa-office-runtime__seq">#{String(selectedEvent.seq).padStart(4, '0')}</span>
              <time dateTime={new Date(selectedEvent.ts).toISOString()}>{formatRelativeTime(selectedEvent.ts)}</time>
            </header>
            <div className="oa-office-runtime__identity">
              <strong>@{selectedPayload.resumeId || '—'}</strong>
              <span>{selectedPayload.agent || '—'} · {selectedPayload.workspaceId || '—'}</span>
            </div>
            {selectedDetail && (
              <p className="oa-office-runtime__detail">{selectedDetail}</p>
            )}
            <ul className="oa-office-runtime__meta" aria-label={t('office.eventDetails')}>
              {selectedMeta.map((item) => (
                <li key={item.label}>
                  <small>{item.label}</small>
                  <span>{item.value}</span>
                </li>
              ))}
            </ul>
          </div>
          {selectedPayload.taskId && (
            <button
              type="button"
              className="oa-office-runtime__open"
              onClick={() => openOrFocus({ kind: 'automation', params: { section: 'runs' } })}
            >
              <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
              {t('office.openRun')}
            </button>
          )}
        </article>
      </div>
    </div>
  )
}
