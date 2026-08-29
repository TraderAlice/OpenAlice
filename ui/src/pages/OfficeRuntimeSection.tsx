import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react'
import type { TFunction } from 'i18next'
import { useTranslation } from 'react-i18next'

import { api } from '../api'
import type { AgentRuntimeEvent } from '../api/agentRuntimeLog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { formatRelativeTime } from '../lib/intl'
import { useInboxSelection } from '../live/inbox-selection'
import {
  officeActivityFallbackLabel,
  type OfficeActivityActor,
} from '../office/activity-actors'
import { officeActivityBeats, officeActivityBeatSeq } from '../office/activity-beats'
import { OfficeCoworkerSprite } from '../office/OfficeCoworkerSprite'
import { officePixelImg } from '../office/furniture'
import { OFFICE_HUD_ASSETS } from '../office/hud-assets'
import { OFFICE_LOG_ASSETS, officeLogAssetKind } from '../office/log-assets'
import {
  officeReplayFocusForEvent,
  type OfficeReplayChannel,
  type OfficeReplayFocus,
} from '../office/replay-focus'
import { useWorkspace } from '../tabs/store'

export type OfficeLogChannel = OfficeReplayChannel

const OFFICE_LOG_CHANNELS: readonly OfficeLogChannel[] = ['all', 'agent', 'inbox', 'news']
const OFFICE_AGENT_BEAT_TARGET = 12
const OFFICE_AGENT_PAGE_SIZE = 100
const OFFICE_AGENT_MAX_PAGES = 5
const OFFICE_SERVICE_PAGE_SIZE = 50
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

function officeReplaySummary(event: AgentRuntimeEvent, t: TFunction): string {
  const value = eventDetail(event) ?? eventLabel(event, t)
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized
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

type ActivityQuery = typeof api.agentRuntime.query

async function loadOfficeAgentWindow(query: ActivityQuery): Promise<AgentRuntimeEvent[]> {
  let entries: AgentRuntimeEvent[] = []

  for (let page = 1; page <= OFFICE_AGENT_MAX_PAGES; page += 1) {
    const result = await query({
      page,
      pageSize: OFFICE_AGENT_PAGE_SIZE,
      family: 'agent',
    })
    entries = mergeOfficeLogFamilies([entries, result.entries])

    const hasEnoughStoryBeats = officeActivityBeats(entries).length >= OFFICE_AGENT_BEAT_TARGET
    const hasNextPage = result.totalPages !== undefined
      ? page < result.totalPages
      : result.entries.length === OFFICE_AGENT_PAGE_SIZE
    if (hasEnoughStoryBeats || !hasNextPage || result.entries.length === 0) break
  }

  return entries
}

export function OfficeRuntimeSection({
  actors = new Map(),
  initialChannel = 'all',
  initialSelectedSeq = null,
  onReplay,
}: {
  actors?: ReadonlyMap<string, OfficeActivityActor>
  initialChannel?: OfficeLogChannel
  initialSelectedSeq?: number | null
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
  const [channel, setChannel] = useState<OfficeLogChannel>(initialChannel)
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const journalIndexRef = useRef<HTMLOListElement>(null)

  const load = useCallback(async () => {
    try {
      const activityApi = api.productActivity ?? api.agentRuntime
      const [agent, inboxPage, newsPage] = await Promise.all([
        loadOfficeAgentWindow(activityApi.query),
        activityApi.query({ page: 1, pageSize: OFFICE_SERVICE_PAGE_SIZE, family: 'inbox' }),
        activityApi.query({ page: 1, pageSize: OFFICE_SERVICE_PAGE_SIZE, family: 'news' }),
      ])
      const inbox = inboxPage.entries
      const news = newsPage.entries
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
    setSelectedSeq((current) => {
      if (visibleBeats.some((beat) => beat.event.seq === current)) return current
      if (visibleBeats.some((beat) => beat.event.seq === initialSelectedSeq)) {
        return initialSelectedSeq
      }
      return visibleBeats[0].event.seq
    })
  }, [initialSelectedSeq, visibleBeats])

  useEffect(() => {
    setDetailExpanded(false)
  }, [selectedSeq])

  useLayoutEffect(() => {
    if (selectedSeq == null) return
    const selectedRow = journalIndexRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-seq="${selectedSeq}"]`)
    selectedRow?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [channel, selectedSeq])

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
  const selectedDetailId = `office-runtime-detail-${selectedEvent.seq}`
  const detailCanExpand = selectedDetail != null
    && (selectedDetail.length > 320 || selectedDetail.split('\n').length > 8)
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
  const reportToggle = detailCanExpand ? (
    <button
      type="button"
      className="oa-office-runtime__detail-toggle"
      aria-controls={selectedDetailId}
      aria-expanded={detailExpanded}
      onClick={() => setDetailExpanded((expanded) => !expanded)}
    >
      {detailExpanded ? t('office.collapseReport') : t('office.showFullReport')}
    </button>
  ) : null
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
        <ol
          ref={journalIndexRef}
          className="oa-office-runtime__index"
          aria-label={`${t('office.timeline')} · ${channelLabel}`}
        >
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
              <>
                {detailExpanded && reportToggle}
                <p
                  id={selectedDetailId}
                  className="oa-office-runtime__detail"
                  data-expanded={detailExpanded || undefined}
                >
                  {selectedDetail}
                </p>
                {!detailExpanded && reportToggle}
              </>
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
                onClick={() => onReplay(officeReplayFocusForEvent(
                  selectedEvent,
                  selectedIdentity.primary,
                  officeReplaySummary(selectedEvent, t),
                  channel,
                ))}
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
                onClick={() => {
                  if (selectedPayload.inboxEntryId) {
                    useInboxSelection.getState().select(selectedPayload.inboxEntryId)
                  }
                  openOrFocus({ kind: 'inbox', params: {} })
                }}
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
