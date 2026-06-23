/**
 * NotificationGroup — collapsible renderer for a run of identical
 * notification messages.
 *
 * When the chat feed contains N consecutive duplicate notifications
 * (e.g. 12 × "無異常。"), we render them as one stacked card that shows
 * the summary text, a × count badge, and the time span they cover.
 * Clicking the card expands it into the individual notification rows
 * so the user can still audit the full sequence if they want to.
 *
 * Design choices:
 * - Defaults to collapsed to keep the feed quiet.
 * - Uses the same bell icon + notification styling as a single
 *   notification so the visual vocabulary is consistent.
 * - Expansion state is local to the component — grouping is
 *   deterministic so remount gives a stable starting state.
 */

import { useState } from 'react'
import { ChatMessage } from './ChatMessage'
import type { NotificationItem } from '../lib/groupNotifications'

interface NotificationGroupProps {
  items: NotificationItem[]
  count: number
}

function formatSpan(items: NotificationItem[]): string | null {
  const first = items[0].timestamp
  const last = items[items.length - 1].timestamp
  if (!first && !last) return null
  if (first === last) return first ? new Date(first).toLocaleTimeString() : null
  if (!first || !last) return null
  const f = new Date(first)
  const l = new Date(last)
  const sameDay = f.toDateString() === l.toDateString()
  if (sameDay) {
    return `${f.toLocaleTimeString()} – ${l.toLocaleTimeString()}`
  }
  return `${f.toLocaleString()} – ${l.toLocaleString()}`
}

export function NotificationGroup({ items, count }: NotificationGroupProps) {
  const [expanded, setExpanded] = useState(false)
  const summary = items[0].text
  const span = formatSpan(items)

  return (
    <div className="flex flex-col">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-start gap-3 message-enter ml-8 text-left group"
      >
        <div className="w-0.5 shrink-0 self-stretch rounded-full bg-notification-border" />
        <div className="flex-1 min-w-0 py-0.5">
          <div className="flex items-center gap-1.5 mb-1">
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-notification-border shrink-0"
            >
              <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
              <path d="M13.73 21a2 2 0 0 1-3.46 0" />
            </svg>
            <span className="text-[11px] text-text-muted/60 font-medium">Notification</span>
            <span className="text-[10px] text-notification-border font-mono bg-notification-border/10 px-1.5 py-0.5 rounded">
              × {count}
            </span>
            {span && (
              <span className="text-[10px] text-text-muted/40 font-mono ml-auto">{span}</span>
            )}
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className={`text-text-muted/40 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
            >
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>
          <div className="text-[13px] text-text-muted break-words leading-relaxed opacity-80 line-clamp-1 group-hover:opacity-100">
            {summary}
          </div>
        </div>
      </button>

      {expanded && (
        <div className="flex flex-col gap-0.5 mt-1 ml-8 pl-3 border-l border-notification-border/30">
          {items.map((item) => (
            <ChatMessage
              key={item._id}
              role="notification"
              text={item.text}
              timestamp={item.timestamp}
              media={item.media}
            />
          ))}
        </div>
      )}
    </div>
  )
}
