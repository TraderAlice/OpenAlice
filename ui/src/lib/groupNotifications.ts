/**
 * groupNotifications — collapse consecutive duplicate notification messages
 * in the chat feed so the render layer shows one stacked entry instead of
 * 12 separate "無異常" lines.
 *
 * Design principles:
 *
 * 1. Only consecutive runs fold. If a user message or assistant reply
 *    appears between two notifications, they stay visually separate —
 *    conversation flow takes precedence over compaction.
 *
 * 2. Only same-normalized-text folds. We never collapse two notifications
 *    with meaningfully different wording, even if they are both "no-op"
 *    style, because that would hide a genuinely new alert from the user.
 *
 * 3. Runs of length 1 are not wrapped — they render identically to the
 *    un-grouped flow so the UI diff for the common case is zero.
 *
 * 4. Tool calls and non-notification text messages pass through
 *    untouched as single-item groups.
 *
 * The grouping is pure data transformation — no React state, no
 * rendering. That makes it easy to unit test against a fixed fixture.
 */

import type { DisplayItem } from '../hooks/useChat'

// ==================== Types ====================

/**
 * A text DisplayItem with role locked to 'notification'. We declare this
 * explicitly instead of using Extract<DisplayItem, ...> because the
 * underlying DisplayItem variant has role as a union and Extract cannot
 * narrow union members within a single variant.
 */
export interface NotificationItem {
  kind: 'text'
  role: 'notification'
  text: string
  timestamp?: string | null
  media?: Array<{ type: string; url: string }>
  _id: number
}

export type DisplayGroup =
  /** Pass-through single item — a user/assistant text message or a tool call. */
  | { kind: 'single'; item: DisplayItem; _id: number }
  /** A run of consecutive identical-text notifications, count ≥ 2. */
  | { kind: 'notification-run'; items: NotificationItem[]; count: number; _id: number }

// ==================== Helpers ====================

/**
 * Normalise notification text for equality comparison. Collapses whitespace
 * and strips trailing punctuation so minor wording drift (e.g. "無異常" vs
 * "無異常。" vs "  無異常  ") still folds together.
 */
export function normalizeNotificationText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[。.!！?？,,、;;]+$/, '')
    .toLowerCase()
}

function isNotification(item: DisplayItem): item is NotificationItem {
  return item.kind === 'text' && item.role === 'notification'
}

// ==================== Main ====================

/**
 * Fold consecutive duplicate notifications into runs. Returns a list that
 * preserves original ordering and never drops items.
 *
 * Complexity: O(n). Does not mutate the input.
 */
export function groupNotifications(items: DisplayItem[]): DisplayGroup[] {
  const groups: DisplayGroup[] = []

  for (const item of items) {
    // Non-notification items always emit as single groups.
    if (!isNotification(item)) {
      groups.push({ kind: 'single', item, _id: item._id })
      continue
    }

    const normalized = normalizeNotificationText(item.text)
    const prev = groups[groups.length - 1]

    // Can we extend a previous notification run with the same normalized text?
    if (
      prev?.kind === 'notification-run' &&
      normalizeNotificationText(prev.items[0].text) === normalized
    ) {
      prev.items.push(item)
      prev.count = prev.items.length
      continue
    }

    // Can we fold the immediately-preceding single notification (count=1)
    // into a new run?
    if (
      prev?.kind === 'single' &&
      isNotification(prev.item) &&
      normalizeNotificationText(prev.item.text) === normalized
    ) {
      // Upgrade the previous single into a run of 2
      const previousItem = prev.item
      groups[groups.length - 1] = {
        kind: 'notification-run',
        items: [previousItem, item],
        count: 2,
        _id: previousItem._id,
      }
      continue
    }

    // Otherwise start a new single notification — if a later duplicate
    // appears we will fold it in via the previous branch.
    groups.push({ kind: 'single', item, _id: item._id })
  }

  return groups
}
