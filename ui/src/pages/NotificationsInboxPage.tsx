import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { getCurrentLocale } from '../lib/i18n-format'
import type { TFunction } from 'i18next'
import { notificationsLive } from '../live/notifications'
import { useNotificationsRead } from '../live/notifications-read'
import type { NotificationEntry, NotificationSource } from '../api/notifications'

const SOURCE_COLORS: Record<NotificationSource, string> = {
  heartbeat: 'bg-purple/15 text-purple',
  cron: 'bg-accent/15 text-accent',
  task: 'bg-green/15 text-green',
  manual: 'bg-amber-500/15 text-amber-400',
}

interface NotificationsInboxPageProps {
  visible: boolean
}

/**
 * Notifications inbox — opened as a tab from the Chat sidebar's
 * "Notifications" row. Email-inbox layout: chronological list with
 * source chip, timestamp, full text. No truncation; full editor width
 * means we don't need progressive disclosure for typical entries.
 *
 * Read accounting: when this page becomes visible (mount or tab-focus),
 * the latest entry's timestamp is recorded as `lastSeenTs`. Anything
 * older is read; anything newer than the recorded ts gets the unread
 * dot in the chat sidebar. Newly-arriving entries while the page is
 * already open continue to count as unread until the next visibility
 * transition — Slack-style.
 */
export function NotificationsInboxPage({ visible }: NotificationsInboxPageProps) {
  const { t } = useTranslation()
  const entries = notificationsLive.useStore((s) => s.entries)
  const loading = notificationsLive.useStore((s) => s.loading)
  const lastSeen = useNotificationsRead((s) => s.lastSeenTs)
  const markAllRead = useNotificationsRead((s) => s.markAllRead)

  // Mark read on each visibility transition into 'visible'. Avoids
  // racing the initial fetch by gating on entries.length too.
  useEffect(() => {
    if (visible && entries.length > 0) markAllRead()
  }, [visible, entries.length, markAllRead])

  const sources = useMemo(() => {
    const set = new Set<NotificationSource>()
    for (const e of entries) {
      if (e.source) set.add(e.source)
    }
    return [...set].sort()
  }, [entries])

  const [filter, setFilter] = useState<NotificationSource | 'all'>('all')
  const filtered = filter === 'all' ? entries : entries.filter((e) => e.source === filter)

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('notifications.title', 'Notifications')}
        description={t('notifications.description', '{{count}} total \u00b7 system pushes from heartbeat, cron, tasks', { count: entries.length })}
        right={
          sources.length > 0 ? (
            <select
              value={filter}
              onChange={(e) => setFilter(e.target.value as NotificationSource | 'all')}
              className="px-2 py-1 text-[12px] bg-bg border border-border rounded-md text-text outline-none focus:border-accent"
            >
              <option value="all">{t('notifications.allSources', 'All sources')}</option>
              {sources.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          ) : undefined
        }
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && entries.length === 0 ? (
          <div className="px-6 py-8 text-text-muted text-sm">{t('common.loading')}</div>
        ) : filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-text-muted text-sm">
            {filter === 'all'
              ? t('notifications.noNotifications', 'No notifications yet. Heartbeat, cron jobs and external pushes will land here.')
              : t('notifications.noNotificationsFrom', 'No notifications from {{source}}.', { source: filter })}
          </div>
        ) : (
          <div className="max-w-[900px] mx-auto py-4 px-4 md:px-6 space-y-2">
            {filtered.map((entry) => (
              <InboxRow key={entry.id} entry={entry} unread={entry.ts > lastSeen} t={t} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function InboxRow({ entry, unread, t }: { entry: NotificationEntry; unread: boolean; t: TFunction }) {
  return (
    <div
      className={`relative rounded-lg border px-4 py-3 transition-colors ${
        unread
          ? 'border-accent/30 bg-accent/[0.03]'
          : 'border-border bg-bg'
      }`}
    >
      {unread && (
        <span
          aria-hidden="true"
          className="absolute left-0 top-3 bottom-3 w-[2px] rounded-r-full bg-accent"
        />
      )}
      <div className="flex items-baseline gap-2 mb-1.5">
        {entry.source && (
          <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${SOURCE_COLORS[entry.source]}`}>
            {entry.source}
          </span>
        )}
        <span className="text-[11px] text-text-muted/70 tabular-nums">{formatAbsoluteTime(entry.ts)}</span>
        <span className="text-[11px] text-text-muted/50">·</span>
        <span className="text-[11px] text-text-muted/70">{formatRelativeTime(t, entry.ts)}</span>
      </div>
      <p className="text-[13px] text-text whitespace-pre-wrap break-words leading-relaxed">
        {entry.text}
      </p>
    </div>
  )
}

function formatAbsoluteTime(ts: number): string {
  const locale = getCurrentLocale()
  return new Date(ts).toLocaleString(locale, {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function formatRelativeTime(t: TFunction, ts: number): string {
  const diff = Date.now() - ts
  if (diff < 60_000) return t('common.secondsAgo', '{{count}}s ago', { count: Math.floor(diff / 1000) })
  if (diff < 3_600_000) return t('common.minutesAgoShort', '{{count}}m ago', { count: Math.floor(diff / 60_000) })
  if (diff < 86_400_000) return t('common.hoursAgoShort', '{{count}}h ago', { count: Math.floor(diff / 3_600_000) })
  return t('common.daysAgoShort', '{{count}}d ago', { count: Math.floor(diff / 86_400_000) })
}
