import type { InboxEntry } from '../api/inbox'
import { inboxScan } from '../lib/inbox-presentation'

/**
 * Inbox threading.
 *
 * We have no Issue layer (Linear's durable object) — the durable unit is
 * the **Workspace**. So the inbox groups its flat push feed into one
 * thread per workspace: the sidebar shows a row per workspace (latest
 * push + unread count), and the detail pane renders that workspace's
 * whole push history as a timeline. This turns the read-and-discard
 * notification stream into a per-workspace conversation — the "boss
 * reading each employee's running report" model.
 */

export interface InboxThread {
  workspaceId: string
  /** Display label from the latest push (workspaces can be renamed). */
  workspaceLabel?: string
  /** This workspace's pushes, newest-first (store order preserved). */
  entries: InboxEntry[]
  /** Timestamp of the most recent push — drives sidebar sort + bucketing. */
  latestTs: number
}

/**
 * Group the flat inbox feed into per-workspace threads. Input is the
 * store's newest-first entry list; output threads are newest-activity-
 * first and each thread's `entries` stay newest-first. Grouping is by
 * `workspaceId` (not label) so two workspaces that happen to share a
 * display label stay distinct threads.
 */
export function groupThreads(entries: readonly InboxEntry[]): InboxThread[] {
  const byWs = new Map<string, InboxEntry[]>()
  for (const e of entries) {
    const arr = byWs.get(e.workspaceId)
    if (arr) arr.push(e)
    else byWs.set(e.workspaceId, [e])
  }
  const threads: InboxThread[] = []
  for (const [workspaceId, es] of byWs) {
    threads.push({
      workspaceId,
      workspaceLabel: es[0]!.workspaceLabel,
      entries: es,
      latestTs: es[0]!.ts,
    })
  }
  threads.sort((a, b) => b.latestTs - a.latestTs)
  return threads
}

/**
 * Scan subject for one push. Presentation-only; the stored comments stay
 * intact. Empty comments/docs return '' so callers can apply their own
 * untitled fallback.
 */
export function previewForEntry(entry: InboxEntry): string {
  return inboxScan(entry, {
    untitled: '',
    unreadLabel: '',
    moreAttachments: (count) => `+${count}`,
  }).subject
}
