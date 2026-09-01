import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { api } from '../api'
import type { InboxEntry, InboxHistoryResponse } from '../api/inbox'
import { inboxScan, type InboxPresentationCopy } from '../lib/inbox-presentation'
import {
  refreshInbox,
  setInboxReadAtOptimistically,
} from '../live/inbox'
import type {
  OfficeDutyAcknowledgementResult,
  OfficeDutySourceStatus,
  OfficeInboxDutyEvidence,
} from './duty-registry'

const OFFICE_INBOX_PAGE_SIZE = 200
const OFFICE_INBOX_MAX_PAGES = 25
const OFFICE_INBOX_POLL_MS = 20_000

type InboxHistoryReader = (opts: {
  limit: number
  before?: string
}) => Promise<InboxHistoryResponse>

export async function readOfficeInboxHistory(
  history: InboxHistoryReader,
): Promise<InboxEntry[]> {
  const entries: InboxEntry[] = []
  const seenEntries = new Set<string>()
  const seenCursors = new Set<string>()
  let before: string | undefined

  for (let page = 0; page < OFFICE_INBOX_MAX_PAGES; page += 1) {
    const response = await history({
      limit: OFFICE_INBOX_PAGE_SIZE,
      ...(before ? { before } : {}),
    })
    for (const entry of response.entries) {
      if (seenEntries.has(entry.id)) continue
      seenEntries.add(entry.id)
      entries.push(entry)
    }
    if (before && response.entries.length === 0) {
      throw new Error('Inbox history pagination cursor disappeared.')
    }
    if (!response.hasMore) return entries
    const cursor = response.entries.at(-1)?.id
    if (!cursor || seenCursors.has(cursor)) {
      throw new Error('Inbox history pagination did not advance.')
    }
    seenCursors.add(cursor)
    before = cursor
  }

  throw new Error('Inbox history exceeds the Office review window.')
}

export function projectOfficeInboxDeliveries(
  entries: readonly InboxEntry[],
  copy: InboxPresentationCopy,
): OfficeInboxDutyEvidence[] {
  return [...projectOfficeInboxEvidence(entries, copy).values()].filter(
    (evidence) => !evidence.entry.readAt,
  )
}

/**
 * Presentation evidence for every row in the authoritative Inbox history.
 * Read state decides whether a row is a patrol duty, never whether an exact
 * report carried to the Decision Desk remains addressable.
 */
export function projectOfficeInboxEvidence(
  entries: readonly InboxEntry[],
  copy: InboxPresentationCopy,
): ReadonlyMap<string, OfficeInboxDutyEvidence> {
  return new Map(entries.map((entry) => {
    const presentation = inboxScan(entry, copy)
    return [entry.id, {
      title: presentation.subject,
      ...(presentation.excerpt ? { excerpt: presentation.excerpt } : {}),
      entry,
    }] as const
  }))
}

interface OfficeInboxDutySource {
  readonly status: OfficeDutySourceStatus
  /** Latest authoritative history request started by this tab. */
  readonly requestEpoch: number
  /** Request-start epoch of the latest history snapshot accepted by this tab. */
  readonly successEpoch: number
  readonly deliveries: readonly OfficeInboxDutyEvidence[]
  /** Exact report presentation, including already-read history rows. */
  readonly evidenceByEntryId: ReadonlyMap<string, OfficeInboxDutyEvidence>
  markReadConfirmed(inboxEntryId: string): Promise<OfficeDutyAcknowledgementResult>
}

async function withOfficeInboxReceiptLock<T>(
  inboxEntryId: string,
  task: () => Promise<T>,
): Promise<T> {
  if (typeof navigator === 'undefined' || !navigator.locks) return task()
  return navigator.locks.request(
    `openalice:office-inbox-receipt:${inboxEntryId}`,
    task,
  )
}

/**
 * Office owns a complete, fail-closed view of durable Inbox attention.
 * The shared Inbox feed intentionally swallows polling errors and marks reads
 * optimistically; neither behavior is strong enough to decide Shift clear.
 */
export function useOfficeInboxDuties(activitySeq?: number): OfficeInboxDutySource {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<InboxEntry[]>([])
  const [status, setStatus] = useState<OfficeDutySourceStatus>('loading')
  const [requestEpoch, setRequestEpoch] = useState(0)
  const [successEpoch, setSuccessEpoch] = useState(0)
  const generationRef = useRef(0)
  const requestEpochRef = useRef(0)
  const mountedRef = useRef(false)
  const activitySeqRef = useRef(activitySeq)
  const markingRef = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    const request = ++requestEpochRef.current
    if (mountedRef.current) setRequestEpoch(request)
    const generation = ++generationRef.current
    try {
      const next = await readOfficeInboxHistory((opts) => api.inbox.history(opts))
      if (!mountedRef.current || generation !== generationRef.current) return
      setEntries(next)
      setStatus('ready')
      setSuccessEpoch((current) => Math.max(current, request))
    } catch {
      if (!mountedRef.current || generation !== generationRef.current) return
      setStatus('error')
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    void refresh()
    const intervalId = window.setInterval(() => void refresh(), OFFICE_INBOX_POLL_MS)
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      window.clearInterval(intervalId)
    }
  }, [refresh])

  useEffect(() => {
    if (activitySeq == null || activitySeqRef.current === activitySeq) return
    activitySeqRef.current = activitySeq
    void refresh()
  }, [activitySeq, refresh])

  const evidenceByEntryId = useMemo(() => projectOfficeInboxEvidence(entries, {
    untitled: t('inbox.untitledUpdate'),
    unreadLabel: t('inbox.unread'),
    moreAttachments: (count) => t('inbox.moreAttachments', { count }),
  }), [entries, t])
  const deliveries = useMemo(
    () => [...evidenceByEntryId.values()].filter((evidence) => !evidence.entry.readAt),
    [evidenceByEntryId],
  )

  const markReadConfirmed = useCallback(async (
    inboxEntryId: string,
  ): Promise<OfficeDutyAcknowledgementResult> => {
    if (markingRef.current.has(inboxEntryId)) {
      throw new Error('Inbox read receipt is already in progress.')
    }
    markingRef.current.add(inboxEntryId)
    try {
      return await withOfficeInboxReceiptLock(inboxEntryId, async () => {
        const request = ++requestEpochRef.current
        if (mountedRef.current) setRequestEpoch(request)
        generationRef.current += 1
        if (mountedRef.current) setStatus('loading')

        let authoritativeEntries: InboxEntry[]
        try {
          authoritativeEntries = await readOfficeInboxHistory((opts) => api.inbox.history(opts))
        } catch (error) {
          generationRef.current += 1
          if (mountedRef.current) setStatus('error')
          throw error
        }

        const exactEntry = authoritativeEntries.find((entry) => entry.id === inboxEntryId)
        if (!exactEntry || exactEntry.readAt) {
          generationRef.current += 1
          if (mountedRef.current) {
            setEntries(authoritativeEntries)
            setStatus('ready')
            setSuccessEpoch((current) => Math.max(current, request))
          }
          if (exactEntry?.readAt) {
            setInboxReadAtOptimistically(inboxEntryId, exactEntry.readAt)
          }
          refreshInbox()
          return 'already-resolved'
        }

        let result: Awaited<ReturnType<typeof api.inbox.markRead>>
        try {
          result = await api.inbox.markRead(inboxEntryId)
        } catch (error) {
          generationRef.current += 1
          if (mountedRef.current) {
            setEntries(authoritativeEntries)
            setStatus('ready')
            setSuccessEpoch((current) => Math.max(current, request))
          }
          throw error
        }
        if (result.id !== inboxEntryId
          || !Number.isFinite(result.readAt)
          || result.readAt <= 0) {
          generationRef.current += 1
          if (mountedRef.current) {
            setEntries(authoritativeEntries)
            setStatus('ready')
            setSuccessEpoch((current) => Math.max(current, request))
          }
          throw new Error('Inbox read receipt did not match the duty.')
        }

        // Invalidate every read started before this exact server write before
        // publishing it, otherwise a stale page could resurrect the duty.
        generationRef.current += 1
        if (mountedRef.current) {
          setStatus('loading')
          setEntries(authoritativeEntries.map((entry) => entry.id === inboxEntryId
            ? { ...entry, readAt: result.readAt }
            : entry))
          setSuccessEpoch((current) => Math.max(current, request))
        }
        setInboxReadAtOptimistically(inboxEntryId, result.readAt)
        refreshInbox()
        void refresh()
        return 'acknowledged'
      })
    } finally {
      markingRef.current.delete(inboxEntryId)
    }
  }, [refresh])

  return {
    status,
    requestEpoch,
    successEpoch,
    deliveries,
    evidenceByEntryId,
    markReadConfirmed,
  }
}
