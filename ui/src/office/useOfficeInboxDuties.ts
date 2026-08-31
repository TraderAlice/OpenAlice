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
  return entries.flatMap((entry) => {
    if (entry.readAt) return []
    const presentation = inboxScan(entry, copy)
    return [{
      title: presentation.subject,
      ...(presentation.excerpt ? { excerpt: presentation.excerpt } : {}),
      entry,
    }]
  })
}

interface OfficeInboxDutySource {
  readonly status: OfficeDutySourceStatus
  readonly deliveries: readonly OfficeInboxDutyEvidence[]
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
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const activitySeqRef = useRef(activitySeq)
  const markingRef = useRef(new Set<string>())

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current
    try {
      const next = await readOfficeInboxHistory((opts) => api.inbox.history(opts))
      if (!mountedRef.current || generation !== generationRef.current) return
      setEntries(next)
      setStatus('ready')
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

  const deliveries = useMemo(() => projectOfficeInboxDeliveries(entries, {
    untitled: t('inbox.untitledUpdate'),
    unreadLabel: t('inbox.unread'),
    moreAttachments: (count) => t('inbox.moreAttachments', { count }),
  }), [entries, t])

  const markReadConfirmed = useCallback(async (
    inboxEntryId: string,
  ): Promise<OfficeDutyAcknowledgementResult> => {
    if (markingRef.current.has(inboxEntryId)) {
      throw new Error('Inbox read receipt is already in progress.')
    }
    markingRef.current.add(inboxEntryId)
    try {
      return await withOfficeInboxReceiptLock(inboxEntryId, async () => {
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
          }
          throw new Error('Inbox read receipt did not match the duty.')
        }

        // Invalidate every read started before this exact server write before
        // publishing it, otherwise a stale page could resurrect the duty.
        generationRef.current += 1
        if (mountedRef.current) {
          setStatus('loading')
          setEntries((current) => current.filter((entry) => entry.id !== inboxEntryId))
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

  return { status, deliveries, markReadConfirmed }
}
