import { useCallback, useEffect, useMemo, useState, type KeyboardEvent } from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { api } from '../api'
import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { formatRelativeTime } from '../lib/intl'
import {
  officeActivityFallbackLabel,
  type OfficeActivityActor,
} from '../office/activity-actors'
import { officeActivityBeats, officeActivityBeatSeq } from '../office/activity-beats'
import { OfficeCoworkerSprite } from '../office/OfficeCoworkerSprite'
import { officePixelImg } from '../office/furniture'
import { OFFICE_HUD_ASSETS } from '../office/hud-assets'
import { OFFICE_LOG_ASSETS, officeLogAssetKind } from '../office/log-assets'
import { officeReplayFocusForEvent, type OfficeReplayFocus } from '../office/replay-focus'
import { useWorkspace } from '../tabs/store'

type OfficeLogChannel = 'all' | 'agent' | 'inbox' | 'news'
type OfficeLogFamily = Exclude<OfficeLogChannel, 'all'>

const OFFICE_LOG_CHANNELS: readonly OfficeLogChannel[] = ['all', 'agent', 'inbox', 'news']
const OFFICE_LOG_FAMILIES: readonly OfficeLogFamily[] = ['agent', 'inbox', 'news']
const OFFICE_LOG_CHANNEL_LABEL_KEYS = {
  all: 'office.logChannelAll',
  agent: 'office.logChannelAgent',
  inbox: 'office.logChannelInbox',
  news: 'office.logChannelNews',
} as const satisfies Record<OfficeLogChannel, string>

function eventLabel(event: AgentRuntimeEvent, t: TFunction): string {
  if (event.type === 'session.born') return t('office.logEventBorn')
  if (event.type === 'runtime.started') return t('office.logEventStarted')
  if (event.type === 'runtime.spawn_failed') return t('office.logEventSpawnFailed')
  if (event.type === 'runtime.stopped') {
    if (event.payload.status === 'done') return t('office.logEventCompleted')
    if (event.payload.status === 'failed') return t('office.logEventFailed')
    if (event.payload.status === 'interrupted') return t('office.logEventInterrupted')
    if (event.payload.status === 'paused') return t('office.logEventPaused')
    return t('office.logEventStopped')
  }
  if (event.type === 'runtime.rejected') return t('office.logEventRejected')
  if (event.type === 'runtime.turn.text') return t('office.logEventReport')
  if (event.type === 'runtime.turn.tool') return t('office.logEventTool')
  if (event.type === 'runtime.turn.error') return t('office.logEventError')
  if (event.type === 'dev.sonner_test') return t('office.logEventTest')
  if (event.type === 'inbox.received') return t('office.logEventInbox')
  if (event.type === 'news.ingested') return t('office.logEventNews')
  return event.type satisfies never
}

function eventStatusLabel(status: AgentRuntimeEvent['payload']['status'], t: TFunction): string | null {
  if (status === 'done') return t('office.logStatusDone')
  if (status === 'failed') return t('office.logStatusFailed')
  if (status === 'interrupted') return t('office.logStatusInterrupted')
  if (status === 'paused') return t('office.logStatusPaused')
  return null
}

function officeRuntimeDialogue(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/```[^\n]*\n([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^>\s?/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '• ')
    .replace(/^\s*(\d+)[.)]\s+/gm, '$1. ')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/~~([^~\n]+)~~/g, '$1')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function eventDetail(event: AgentRuntimeEvent): string | null {
  const payload = event.payload
  if (event.type === 'runtime.turn.text') {
    return payload.text ? officeRuntimeDialogue(payload.text) : null
  }
  if (event.type === 'runtime.turn.tool') {
    return [payload.toolName, payload.toolStatus].filter(Boolean).join(' · ') || null
  }
  if (event.type === 'runtime.turn.error') return payload.message ?? payload.error ?? null
  if (event.type === 'dev.sonner_test') return payload.message ?? null
  if (event.type === 'inbox.received') return payload.summary ?? null
  if (event.type === 'news.ingested') return payload.title ?? null
  if (event.type === 'runtime.stopped' && payload.assistantText) {
    return officeRuntimeDialogue(payload.assistantText)
  }
  return null
}

function actorForEvent(
  event: AgentRuntimeEvent,
  actors: ReadonlyMap<string, OfficeActivityActor>,
): OfficeActivityActor | undefined {
  return event.payload.resumeId ? actors.get(event.payload.resumeId) : undefined
}

function eventActor(
  event: AgentRuntimeEvent,
  actors: ReadonlyMap<string, OfficeActivityActor>,
): string {
  if (event.type === 'inbox.received') {
    return event.payload.workspaceLabel ?? event.payload.workspaceId ?? 'Inbox'
  }
  if (event.type === 'news.ingested') return event.payload.source ?? 'News collector'
  return actorForEvent(event, actors)?.label
    ?? officeActivityFallbackLabel(event.payload.resumeId, event.payload.agent)
}

function eventIdentity(
  event: AgentRuntimeEvent,
  actors: ReadonlyMap<string, OfficeActivityActor>,
): { primary: string; secondary: string } {
  if (event.type === 'inbox.received') {
    return {
      primary: 'Inbox',
      secondary: [event.payload.agent, event.payload.workspaceLabel ?? event.payload.workspaceId]
        .filter(Boolean).join(' · ') || 'OpenAlice',
    }
  }
  if (event.type === 'news.ingested') {
    return {
      primary: event.payload.source ?? 'News collector',
      secondary: 'Market · News',
    }
  }
  const actor = actorForEvent(event, actors)
  return {
    primary: actor?.label ?? officeActivityFallbackLabel(event.payload.resumeId, event.payload.agent),
    secondary: actor?.secondary
      ?? ([event.payload.agent, event.payload.workspaceId].filter(Boolean).join(' · ') || 'OpenAlice'),
  }
}

function causeLabel(
  event: AgentRuntimeEvent,
  actors: ReadonlyMap<string, OfficeActivityActor>,
): string | null {
  const cause = event.payload.cause
  if (!cause) return null
  if (cause.kind === 'issue') return `issue ${cause.issueId}`
  if (cause.kind === 'conversation') {
    const from = cause.from?.kind === 'session'
      ? actors.get(cause.from.resumeId ?? '')?.label
        ?? officeActivityFallbackLabel(cause.from.resumeId, cause.from.agent)
      : cause.from?.kind === 'workspace'
        ? cause.from.workspaceId
        : cause.from?.kind ?? 'human'
    return `ask ${from}`
  }
  return cause.kind
}

function mergeOfficeLogFamilies(
  families: readonly (readonly AgentRuntimeEvent[])[],
): AgentRuntimeEvent[] {
  const bySequence = new Map<number, AgentRuntimeEvent>()
  for (const entries of families) {
    for (const event of entries) bySequence.set(event.seq, event)
  }
  return [...bySequence.values()].sort((a, b) => b.seq - a.seq)
}

export function OfficeRuntimeSection({
  actors = new Map(),
  onReplay,
}: {
  actors?: ReadonlyMap<string, OfficeActivityActor>
  onReplay?: (focus: OfficeReplayFocus) => void
} = {}) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [entriesByChannel, setEntriesByChannel] = useState<Record<OfficeLogChannel, AgentRuntimeEvent[]>>({
    all: [],
    agent: [],
    inbox: [],
    news: [],
  })
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [channel, setChannel] = useState<OfficeLogChannel>('all')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const activityApi = api.productActivity ?? api.agentRuntime
      const pages = await Promise.all(OFFICE_LOG_FAMILIES.map((family) => activityApi.query({
        page: 1,
        pageSize: 50,
        family,
      })))
      const [agent, inbox, news] = pages.map((page) => page.entries)
      setEntriesByChannel({
        all: mergeOfficeLogFamilies([agent, inbox, news]),
        agent,
        inbox,
        news,
      })
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

  const beatsByChannel = useMemo(() => ({
    all: officeActivityBeats(entriesByChannel.all),
    agent: officeActivityBeats(entriesByChannel.agent),
    inbox: officeActivityBeats(entriesByChannel.inbox),
    news: officeActivityBeats(entriesByChannel.news),
  }), [entriesByChannel])
  const channelCounts = useMemo(() => ({
    all: beatsByChannel.all.length,
    agent: beatsByChannel.agent.length,
    inbox: beatsByChannel.inbox.length,
    news: beatsByChannel.news.length,
  }), [beatsByChannel])
  const visibleBeats = beatsByChannel[channel]

  useEffect(() => {
    if (visibleBeats.length === 0) {
      setSelectedSeq(null)
      return
    }
    setSelectedSeq((current) => visibleBeats.some((beat) => beat.event.seq === current)
      ? current
      : visibleBeats[0].event.seq)
  }, [visibleBeats])

  if (loading && entriesByChannel.all.length === 0) {
    return <div className="oa-office-runtime__empty">{t('office.loading')}</div>
  }

  if (error && entriesByChannel.all.length === 0) {
    return (
      <div role="alert" className="oa-office-runtime__error">
        {t('office.loadFailed')}: {error}
      </div>
    )
  }

  if (entriesByChannel.all.length === 0) {
    return (
      <div className="oa-office-runtime__empty">
        {t('office.empty')}
      </div>
    )
  }

  const channelLabel = t(OFFICE_LOG_CHANNEL_LABEL_KEYS[channel])
  const selectedBeat = visibleBeats.find((beat) => beat.event.seq === selectedSeq) ?? visibleBeats[0]
  if (!selectedBeat) {
    return (
      <div className="oa-office-runtime">
        <Tabs value={channel} onValueChange={(value) => setChannel(value as OfficeLogChannel)}>
          <TabsList className="oa-office-runtime__channels" aria-label={t('office.logChannels')}>
            {OFFICE_LOG_CHANNELS.map((item) => (
              <TabsTrigger key={item} value={item}>
                <span>{t(OFFICE_LOG_CHANNEL_LABEL_KEYS[item])}</span>
                <b>{channelCounts[item]}</b>
              </TabsTrigger>
            ))}
          </TabsList>
          <TabsContent value={channel} className="oa-office-runtime__panel">
            <div className="oa-office-runtime__empty">
              {t('office.logChannelEmpty', { channel: channelLabel })}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    )
  }
  const selectedEvent = selectedBeat.event
  const selectedPayload = selectedEvent.payload
  const selectedDetail = eventDetail(selectedEvent)
  const selectedKind = officeLogAssetKind(selectedEvent.type)
  const selectedMeta: Array<{ label: string; value: string }> = []
  const addMeta = (label: string, value: string | null | undefined) => {
    if (value) selectedMeta.push({ label, value })
  }
  addMeta(t('office.surface'), selectedPayload.surface)
  addMeta(t('office.eventCause'), causeLabel(selectedEvent, actors))
  addMeta(t('office.status'), eventStatusLabel(selectedPayload.status, t))
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
  if (selectedEvent.type === 'inbox.received' && selectedPayload.documentCount) {
    addMeta(t('office.eventDocuments'), String(selectedPayload.documentCount))
  }
  if (selectedEvent.type === 'news.ingested') {
    addMeta(t('office.eventSource'), selectedPayload.source)
    addMeta(t('office.eventPublished'), selectedPayload.publishedAt
      ? new Date(selectedPayload.publishedAt).toLocaleString()
      : undefined)
  }
  const selectedActor = actorForEvent(selectedEvent, actors)
  const selectedIdentity = eventIdentity(selectedEvent, actors)
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
      <Tabs value={channel} onValueChange={(value) => setChannel(value as OfficeLogChannel)}>
        <TabsList className="oa-office-runtime__channels" aria-label={t('office.logChannels')}>
          {OFFICE_LOG_CHANNELS.map((item) => (
            <TabsTrigger key={item} value={item}>
              <span>{t(OFFICE_LOG_CHANNEL_LABEL_KEYS[item])}</span>
              <b>{channelCounts[item]}</b>
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value={channel} className="oa-office-runtime__panel">
        <div data-testid="runtime-log" className="oa-office-runtime__journal">
        <ol className="oa-office-runtime__index" aria-label={`${t('office.timeline')} · ${channelLabel}`}>
          {visibleBeats.map((beat) => {
            const event = beat.event
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
                    <strong>{eventLabel(event, t)}</strong>
                    <small>{eventActor(event, actors)}</small>
                  </span>
                  <span className="oa-office-runtime__index-meta">
                    <span className="oa-office-runtime__index-seq">
                      {beat.count > 1 && (
                        <span
                          className="oa-office-runtime__beat-count"
                          aria-label={t('office.logBeatUpdates', { count: beat.count })}
                        >
                          ×{beat.count}
                        </span>
                      )}
                      <b>{officeActivityBeatSeq(beat)}</b>
                    </span>
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
          <div className="oa-office-runtime__badge" data-actor={selectedActor ? '' : undefined} aria-hidden>
            {selectedActor ? (
              <>
                <OfficeCoworkerSprite
                  agent={selectedActor.agent}
                  identity={selectedActor.resumeId}
                  asset={selectedActor.asset}
                  mood="idle"
                  reducedMotion
                  label={selectedActor.label}
                  scale={0.25}
                />
                <img
                  className="oa-office-runtime__event-mark"
                  src={OFFICE_LOG_ASSETS[selectedKind]}
                  alt=""
                  style={officePixelImg}
                />
              </>
            ) : (
              <img src={OFFICE_LOG_ASSETS[selectedKind]} alt="" style={officePixelImg} />
            )}
          </div>
          <div className="oa-office-runtime__content">
            <header className="oa-office-runtime__heading">
              <span className="oa-office-runtime__type">{eventLabel(selectedEvent, t)}</span>
              <span className="oa-office-runtime__seq">{officeActivityBeatSeq(selectedBeat)}</span>
              <time dateTime={new Date(selectedEvent.ts).toISOString()}>{formatRelativeTime(selectedEvent.ts)}</time>
            </header>
            <div className="oa-office-runtime__identity">
              <strong>{selectedIdentity.primary}</strong>
              <span>{selectedIdentity.secondary}</span>
            </div>
            {selectedActor?.assignment && (
              <div className="oa-office-runtime__assignment">
                <small>{t('office.assignment')}</small>
                <p title={selectedActor.assignment}>{selectedActor.assignment}</p>
              </div>
            )}
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
          <div className="oa-office-runtime__actions">
            {onReplay && (
              <button
                type="button"
                className="oa-office-runtime__open oa-office-runtime__open--replay"
                onClick={() => onReplay(officeReplayFocusForEvent(selectedEvent, selectedIdentity.primary))}
              >
                <img src={OFFICE_HUD_ASSETS.replayLatch} alt="" aria-hidden style={officePixelImg} />
                {t('office.replayEvent')}
              </button>
            )}
            {selectedPayload.taskId
              && selectedEvent.type !== 'inbox.received'
              && selectedEvent.type !== 'news.ingested' && (
              <button
                type="button"
                className="oa-office-runtime__open"
                onClick={() => openOrFocus({ kind: 'automation', params: { section: 'runs' } })}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {t('office.openRun')}
              </button>
            )}
            {selectedEvent.type === 'inbox.received' && (
              <button
                type="button"
                className="oa-office-runtime__open"
                onClick={() => openOrFocus({ kind: 'inbox', params: {} })}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {t('office.interactInbox')}
              </button>
            )}
            {selectedEvent.type === 'news.ingested' && (
              <button
                type="button"
                className="oa-office-runtime__open"
                onClick={() => openOrFocus({ kind: 'news', params: {} })}
              >
                <img src={OFFICE_HUD_ASSETS.sessionPortal} alt="" aria-hidden style={officePixelImg} />
                {t('office.interactNews')}
              </button>
            )}
          </div>
        </article>
      </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}
