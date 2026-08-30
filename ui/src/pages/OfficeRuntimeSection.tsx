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
import {
  officeActivityBeats,
  officeActivityBeatSeq,
  officeActivityOverview,
} from '../office/activity-beats'
import { OfficeCoworkerSprite } from '../office/OfficeCoworkerSprite'
import { officePixelImg } from '../office/furniture'
import { OFFICE_HUD_ASSETS } from '../office/hud-assets'
import { isOfficeConfirmKey } from '../office/input'
import { OFFICE_LOG_ASSETS, officeLogAssetKind } from '../office/log-assets'
import {
  officeReplayFocusForEvent,
  type OfficeReplayChannel,
  type OfficeReplayFocus,
} from '../office/replay-focus'
import { useWorkspace } from '../tabs/store'

export type OfficeLogChannel = OfficeReplayChannel
type OfficeLogMobileView = 'index' | 'detail'

const OFFICE_LOG_CHANNELS: readonly OfficeLogChannel[] = ['overview', 'agent', 'inbox', 'news']
const OFFICE_AGENT_BEAT_TARGET = 12
const OFFICE_AGENT_PAGE_SIZE = 100
const OFFICE_AGENT_MAX_PAGES = 5
const OFFICE_SERVICE_PAGE_SIZE = 50
const OFFICE_LOG_CHANNEL_LABEL_KEYS = {
  overview: 'office.logChannelOverview',
  agent: 'office.logChannelAgent',
  inbox: 'office.logChannelInbox',
  news: 'office.logChannelNews',
} as const satisfies Record<OfficeLogChannel, string>

export function revealOfficeJournalRow(
  journal: HTMLOListElement,
  row: HTMLButtonElement,
): void {
  const journalBounds = journal.getBoundingClientRect()
  const rowBounds = row.getBoundingClientRect()
  if (rowBounds.top < journalBounds.top) {
    journal.scrollTop = Math.max(0, journal.scrollTop - (journalBounds.top - rowBounds.top))
  } else if (rowBounds.bottom > journalBounds.bottom) {
    journal.scrollTop += rowBounds.bottom - journalBounds.bottom
  }
}

function officeLogFamilyForEvent(event: AgentRuntimeEvent): Exclude<OfficeLogChannel, 'all'> {
  if (event.type === 'inbox.received') return 'inbox'
  if (event.type === 'news.ingested') return 'news'
  return 'agent'
}

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

function eventRunModeLabel(
  surface: AgentRuntimeEvent['payload']['surface'],
  t: TFunction,
): string | null {
  if (surface === 'headless') return t('office.runModeBackground')
  if (surface === 'terminal') return t('office.runModeTerminal')
  if (surface === 'webpi') return t('office.runModeWorkspace')
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

function officeToolActionName(value: string, t: TFunction): string {
  if (value === 'run_terminal_command') return t('office.toolActionRunCommand')
  if (value === 'get_command_or_subagent_output') return t('office.toolActionReadResult')
  const words = value
    .replace(/([a-z\d])([A-Z])/g, '$1 $2')
    .replace(/[_./-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : value
}

function officeToolStatusLabel(
  status: AgentRuntimeEvent['payload']['toolStatus'],
  t: TFunction,
): string | null {
  if (status === 'running') return t('office.logToolStatusRunning')
  if (status === 'completed') return t('office.logStatusDone')
  if (status === 'failed') return t('office.logStatusFailed')
  return null
}

function officeReplaySummary(event: AgentRuntimeEvent, t: TFunction): string {
  const value = eventDetail(event, t) ?? eventLabel(event, t)
  const normalized = value.replace(/\s+/g, ' ').trim()
  return normalized.length > 180 ? `${normalized.slice(0, 179)}…` : normalized
}

function eventIndexTitle(event: AgentRuntimeEvent, t: TFunction): string {
  if (event.type === 'inbox.received' || event.type === 'news.ingested') {
    return officeReplaySummary(event, t)
  }
  return eventLabel(event, t)
}

function eventDetail(event: AgentRuntimeEvent, t: TFunction): string | null {
  const payload = event.payload
  if (event.type === 'runtime.turn.text') {
    return payload.text ? officeRuntimeDialogue(payload.text) : null
  }
  if (event.type === 'runtime.turn.tool') {
    return [
      payload.toolName ? officeToolActionName(payload.toolName, t) : null,
      officeToolStatusLabel(payload.toolStatus, t),
    ].filter(Boolean).join(' · ') || null
  }
  if (event.type === 'runtime.turn.error') return payload.message ?? payload.error ?? null
  if (event.type === 'dev.sonner_test') return payload.message ?? null
  if (event.type === 'inbox.received') return payload.summary ?? payload.title ?? null
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
  t: TFunction,
): string | null {
  const cause = event.payload.cause
  if (!cause) return null
  if (cause.kind === 'issue') return t('office.eventTriggerIssue', { id: cause.issueId })
  if (cause.kind === 'conversation') {
    const from = cause.from?.kind === 'session'
      ? actors.get(cause.from.resumeId ?? '')?.label
        ?? officeActivityFallbackLabel(cause.from.resumeId, cause.from.agent)
      : cause.from?.kind === 'workspace'
        ? cause.from.workspaceId ?? 'workspace'
        : cause.from?.kind ?? 'human'
    return t('office.eventTriggerConversation', { from })
  }
  if (cause.kind === 'ui') return t('office.eventTriggerManual')
  return t('office.eventTriggerExternal')
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
  initialChannel = 'overview',
  initialSelectedSeq = null,
  replaySeq = null,
  onReplay,
}: {
  actors?: ReadonlyMap<string, OfficeActivityActor>
  initialChannel?: OfficeLogChannel
  initialSelectedSeq?: number | null
  replaySeq?: number | null
  onReplay?: (focus: OfficeReplayFocus) => void
} = {}) {
  const { t } = useTranslation()
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const [entriesByChannel, setEntriesByChannel] = useState<Record<OfficeLogChannel, AgentRuntimeEvent[]>>({
    overview: [],
    agent: [],
    inbox: [],
    news: [],
  })
  const [selectedSeq, setSelectedSeq] = useState<number | null>(null)
  const [channel, setChannel] = useState<OfficeLogChannel>(initialChannel)
  const [mobileView, setMobileView] = useState<OfficeLogMobileView>(
    initialSelectedSeq == null ? 'index' : 'detail',
  )
  const [detailExpanded, setDetailExpanded] = useState(false)
  const [beatExpanded, setBeatExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const journalIndexRef = useRef<HTMLOListElement>(null)
  const journalBackRef = useRef<HTMLButtonElement>(null)
  const reportToggleRef = useRef<HTMLButtonElement>(null)
  const reportToggleFocusPendingRef = useRef(false)
  const journalInitialFocusPendingRef = useRef(true)
  const journalChannelFocusPendingRef = useRef(false)
  const appliedReplaySeqRef = useRef<number | null>(null)

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
        overview: mergeOfficeLogFamilies([agent, inbox, news]),
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

  const beatsByChannel = useMemo(() => {
    const agent = officeActivityBeats(entriesByChannel.agent)
    const inbox = officeActivityBeats(entriesByChannel.inbox)
    const news = officeActivityBeats(entriesByChannel.news)
    return {
      overview: officeActivityOverview([agent, inbox, news]),
      agent,
      inbox,
      news,
    }
  }, [entriesByChannel])
  const channelCounts = useMemo(() => ({
    overview: beatsByChannel.overview.length,
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
    if (replaySeq == null) {
      appliedReplaySeqRef.current = null
      return
    }
    if (appliedReplaySeqRef.current === replaySeq) return
    const replayEvent = entriesByChannel.overview.find((event) => event.seq === replaySeq)
    if (!replayEvent) return
    let replayChannel: OfficeLogChannel = channel === 'overview'
      ? 'overview'
      : officeLogFamilyForEvent(replayEvent)
    let replayBeat = beatsByChannel[replayChannel].find((beat) => {
      const lower = Math.min(beat.oldestSeq, beat.event.seq)
      const upper = Math.max(beat.oldestSeq, beat.event.seq)
      return replaySeq >= lower && replaySeq <= upper
    })
    if (!replayBeat && replayChannel === 'overview') {
      replayChannel = officeLogFamilyForEvent(replayEvent)
      replayBeat = beatsByChannel[replayChannel].find((beat) => {
        const lower = Math.min(beat.oldestSeq, beat.event.seq)
        const upper = Math.max(beat.oldestSeq, beat.event.seq)
        return replaySeq >= lower && replaySeq <= upper
      })
    }
    if (!replayBeat) return
    appliedReplaySeqRef.current = replaySeq
    setChannel(replayChannel)
    setSelectedSeq(replayBeat.event.seq)
  }, [beatsByChannel, channel, entriesByChannel.overview, replaySeq])

  useEffect(() => {
    setDetailExpanded(false)
    setBeatExpanded(false)
  }, [selectedSeq])

  useLayoutEffect(() => {
    if (!reportToggleFocusPendingRef.current) return
    reportToggleFocusPendingRef.current = false
    reportToggleRef.current?.focus({ preventScroll: true })
  }, [detailExpanded])

  useEffect(() => {
    if (initialSelectedSeq != null) setMobileView('detail')
  }, [initialSelectedSeq])

  useLayoutEffect(() => {
    if (selectedSeq == null) return
    const selectedRow = journalIndexRef.current
      ?.querySelector<HTMLButtonElement>(`button[data-seq="${selectedSeq}"]`)
    if (journalIndexRef.current && selectedRow) {
      revealOfficeJournalRow(journalIndexRef.current, selectedRow)
    }
    if (journalInitialFocusPendingRef.current && selectedRow) {
      journalInitialFocusPendingRef.current = false
      const activeElement = document.activeElement
      const focusIsUnclaimed = activeElement === document.body
        || activeElement?.matches('.oa-office-window--log .oa-office-window__header button')
      if (focusIsUnclaimed) {
        const visibleBack = mobileView === 'detail'
          && journalBackRef.current?.offsetParent != null
          ? journalBackRef.current
          : null
        const initialTarget = visibleBack ?? selectedRow
        initialTarget.focus({ preventScroll: true })
      }
    }
    if (journalChannelFocusPendingRef.current && selectedRow) {
      journalChannelFocusPendingRef.current = false
      selectedRow.focus({ preventScroll: true })
    }
  }, [channel, mobileView, selectedSeq])

  if (loading && entriesByChannel.overview.length === 0) {
    return <div className="oa-office-runtime__empty">{t('office.loading')}</div>
  }

  if (error && entriesByChannel.overview.length === 0) {
    return (
      <div role="alert" className="oa-office-runtime__error">
        {t('office.loadFailed')}: {error}
      </div>
    )
  }

  if (entriesByChannel.overview.length === 0) {
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
          <small className="oa-office-runtime__input-hint">{t('office.logKeyboardHint')}</small>
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
  const selectedBeatEvents = [...selectedBeat.events].reverse()
  const selectedPayload = selectedEvent.payload
  const selectedDetail = eventDetail(selectedEvent, t)
  const selectedDetailId = `office-runtime-detail-${selectedEvent.seq}`
  const detailCanExpand = selectedDetail != null
    && (selectedDetail.length > 320 || selectedDetail.split('\n').length > 8)
  const selectedKind = officeLogAssetKind(selectedEvent.type)
  const selectedMeta: Array<{ label: string; value: string }> = []
  const addMeta = (label: string, value: string | null | undefined) => {
    if (value) selectedMeta.push({ label, value })
  }
  addMeta(t('office.eventRunMode'), eventRunModeLabel(selectedPayload.surface, t))
  addMeta(t('office.eventTrigger'), causeLabel(selectedEvent, actors, t))
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
  const currentActorEvent = selectedActor
    ? entriesByChannel.agent.find((event) => event.seq === selectedActor.lastSeq)
    : undefined
  const selectedAssignment = selectedActor?.assignment && (
    selectedEvent.seq === selectedActor.lastSeq
    || (
      selectedPayload.taskId != null
      && selectedPayload.taskId === currentActorEvent?.payload.taskId
    )
  )
    ? selectedActor.assignment
    : undefined
  const selectedIdentity = eventIdentity(selectedEvent, actors)
  const selectJournalEvent = (seq: number) => {
    setSelectedSeq(seq)
    setMobileView('detail')
    requestAnimationFrame(() => {
      const backButton = journalBackRef.current
      if (backButton?.offsetParent != null) backButton.focus({ preventScroll: true })
    })
  }
  const returnToJournalIndex = () => {
    setMobileView('index')
    requestAnimationFrame(() => {
      const selectedRow = journalIndexRef.current
        ?.querySelector<HTMLButtonElement>(`button[data-seq="${selectedEvent.seq}"]`)
      if (journalIndexRef.current && selectedRow) {
        revealOfficeJournalRow(journalIndexRef.current, selectedRow)
      }
      selectedRow?.focus({ preventScroll: true })
    })
  }
  const changeChannel = (value: string) => {
    setChannel(value as OfficeLogChannel)
    setMobileView('index')
  }
  const confirmRuntimeAction = (
    event: KeyboardEvent<HTMLButtonElement>,
    action: () => void,
  ) => {
    if (!isOfficeConfirmKey(event.key)) return
    event.preventDefault()
    action()
  }
  const toggleReport = () => {
    reportToggleFocusPendingRef.current = true
    setDetailExpanded((expanded) => !expanded)
  }
  const reportToggle = detailCanExpand ? (
    <button
      type="button"
      ref={reportToggleRef}
      className="oa-office-runtime__detail-toggle"
      aria-controls={selectedDetailId}
      aria-expanded={detailExpanded}
      onClick={toggleReport}
      onKeyDown={(event) => confirmRuntimeAction(event, toggleReport)}
    >
      {detailExpanded ? t('office.collapseReport') : t('office.showFullReport')}
    </button>
  ) : null
  const moveJournalSelection = (keyboardEvent: KeyboardEvent<HTMLButtonElement>) => {
    if (keyboardEvent.key === 'ArrowLeft' || keyboardEvent.key === 'ArrowRight') {
      keyboardEvent.preventDefault()
      const direction = keyboardEvent.key === 'ArrowLeft' ? -1 : 1
      const currentChannelIndex = OFFICE_LOG_CHANNELS.indexOf(channel)
      for (let offset = 1; offset <= OFFICE_LOG_CHANNELS.length; offset += 1) {
        const nextIndex = (
          currentChannelIndex + direction * offset + OFFICE_LOG_CHANNELS.length
        ) % OFFICE_LOG_CHANNELS.length
        const nextChannel = OFFICE_LOG_CHANNELS[nextIndex]
        if (beatsByChannel[nextChannel].length === 0) continue
        journalChannelFocusPendingRef.current = true
        setChannel(nextChannel)
        setMobileView('index')
        return
      }
    }
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

  const handleJournalEscape = (keyboardEvent: KeyboardEvent<HTMLDivElement>) => {
    if (keyboardEvent.key !== 'Escape') return
    if (beatExpanded) {
      keyboardEvent.preventDefault()
      keyboardEvent.stopPropagation()
      setBeatExpanded(false)
      return
    }
    if (detailExpanded) {
      keyboardEvent.preventDefault()
      keyboardEvent.stopPropagation()
      reportToggleFocusPendingRef.current = true
      setDetailExpanded(false)
      return
    }
    const detailBackVisible = journalBackRef.current?.offsetParent != null
    if (mobileView !== 'detail' || !detailBackVisible) return
    keyboardEvent.preventDefault()
    keyboardEvent.stopPropagation()
    returnToJournalIndex()
  }

  return (
    <div className="oa-office-runtime" onKeyDown={handleJournalEscape}>
      {error && (
        <div role="status" className="oa-office-runtime__error">
          {t('office.paused')}: {error}
        </div>
      )}
      <Tabs value={channel} onValueChange={changeChannel}>
        <TabsList className="oa-office-runtime__channels" aria-label={t('office.logChannels')}>
          {OFFICE_LOG_CHANNELS.map((item) => (
            <TabsTrigger key={item} value={item}>
              <span>{t(OFFICE_LOG_CHANNEL_LABEL_KEYS[item])}</span>
              <b>{channelCounts[item]}</b>
            </TabsTrigger>
          ))}
        </TabsList>
        <small className="oa-office-runtime__input-hint">{t('office.logKeyboardHint')}</small>
        <TabsContent value={channel} className="oa-office-runtime__panel">
          <div
            data-testid="runtime-log"
            data-compact={visibleBeats.length <= 5 ? 'true' : undefined}
            data-mobile-view={mobileView}
            className="oa-office-runtime__journal"
          >
            <ol
              ref={journalIndexRef}
              className="oa-office-runtime__index"
              aria-label={`${t('office.timeline')} · ${channelLabel}`}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Enter Space"
            >
          {visibleBeats.map((beat) => {
            const event = beat.event
            const kind = officeLogAssetKind(event.type)
            const active = event.seq === selectedEvent.seq
            const typeLabel = eventLabel(event, t)
            const indexTitle = eventIndexTitle(event, t)
            const hasContentTitle = indexTitle !== typeLabel
            const indexFullTitle = hasContentTitle
              ? eventDetail(event, t)?.replace(/\s+/g, ' ').trim()
              : null
            return (
              <li key={event.seq}>
                <button
                  type="button"
                  aria-pressed={active}
                  tabIndex={active ? 0 : -1}
                  data-kind={kind}
                  data-seq={event.seq}
                  onClick={() => selectJournalEvent(event.seq)}
                  onKeyDown={(keyboardEvent) => {
                    if (isOfficeConfirmKey(keyboardEvent.key)) {
                      keyboardEvent.preventDefault()
                      selectJournalEvent(event.seq)
                      if (beat.count > 1) setBeatExpanded(true)
                      return
                    }
                    moveJournalSelection(keyboardEvent)
                  }}
                >
                  <img src={OFFICE_LOG_ASSETS[kind]} alt="" aria-hidden style={officePixelImg} />
                  <span className="oa-office-runtime__index-copy">
                    <span className="oa-office-runtime__index-primary">
                      <strong title={hasContentTitle ? indexFullTitle ?? indexTitle : undefined}>
                        {hasContentTitle && (
                          <span className="sr-only">{typeLabel}: </span>
                        )}
                        {indexTitle}
                      </strong>
                      <time dateTime={new Date(event.ts).toISOString()}>{formatRelativeTime(event.ts)}</time>
                    </span>
                    <span className="oa-office-runtime__index-meta">
                      <small>{eventActor(event, actors)}</small>
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
                    </span>
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
          <button
            type="button"
            ref={journalBackRef}
            className="oa-office-runtime__back"
            onClick={returnToJournalIndex}
            onKeyDown={(event) => confirmRuntimeAction(event, returnToJournalIndex)}
          >
            <span aria-hidden>←</span>
            {t('office.logBackToRecords')}
          </button>
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
            {selectedAssignment && (
              <div className="oa-office-runtime__assignment">
                <small>{t('office.assignment')}</small>
                <p title={selectedAssignment}>{selectedAssignment}</p>
              </div>
            )}
            {selectedDetail && (
              <>
                {detailExpanded && reportToggle}
                <p
                  id={selectedDetailId}
                  className="oa-office-runtime__detail"
                  data-expandable={detailCanExpand || undefined}
                  data-expanded={detailExpanded || undefined}
                >
                  {selectedDetail}
                </p>
                {!detailExpanded && reportToggle}
              </>
            )}
            {selectedBeat.count > 1 && (
              <div className="oa-office-runtime__beat">
                <button
                  type="button"
                  className="oa-office-runtime__detail-toggle"
                  aria-controls={`office-runtime-beat-${selectedEvent.seq}`}
                  aria-expanded={beatExpanded}
                  onClick={() => setBeatExpanded((expanded) => !expanded)}
                  onKeyDown={(event) => confirmRuntimeAction(
                    event,
                    () => setBeatExpanded((expanded) => !expanded),
                  )}
                >
                  {beatExpanded
                    ? t('office.collapseBeatUpdates')
                    : t('office.showBeatUpdates', { count: selectedBeat.count })}
                </button>
                {beatExpanded && (
                  <ol
                    id={`office-runtime-beat-${selectedEvent.seq}`}
                    className="oa-office-runtime__beat-list"
                    aria-label={t('office.logBeatUpdates', { count: selectedBeat.count })}
                  >
                    {selectedBeatEvents.map((event) => (
                      <li key={event.seq}>
                        <span>
                          <b>#{String(event.seq).padStart(4, '0')}</b>
                          <time dateTime={new Date(event.ts).toISOString()}>
                            {formatRelativeTime(event.ts)}
                          </time>
                        </span>
                        <p>{officeReplaySummary(event, t)}</p>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
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
                onKeyDown={(event) => confirmRuntimeAction(event, () => onReplay(
                  officeReplayFocusForEvent(
                    selectedEvent,
                    selectedIdentity.primary,
                    officeReplaySummary(selectedEvent, t),
                    channel,
                  ),
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
                onKeyDown={(event) => confirmRuntimeAction(
                  event,
                  () => openOrFocus({ kind: 'automation', params: { section: 'runs' } }),
                )}
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
                onKeyDown={(event) => confirmRuntimeAction(event, () => {
                  if (selectedPayload.inboxEntryId) {
                    useInboxSelection.getState().select(selectedPayload.inboxEntryId)
                  }
                  openOrFocus({ kind: 'inbox', params: {} })
                })}
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
                onKeyDown={(event) => confirmRuntimeAction(
                  event,
                  () => openOrFocus({ kind: 'news', params: {} }),
                )}
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
