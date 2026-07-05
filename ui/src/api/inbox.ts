import { fetchJson } from './client'

export interface InboxDoc {
  path: string
}

/**
 * Agent-INVISIBLE provenance the server stamps onto every push — mirrors the
 * backend `InboxOrigin` (`src/core/inbox-store.ts`). The agent never supplies
 * any of this (exactly as it never supplies its own wsId): the run identity is
 * injected at spawn, carried out-of-band on an HTTP header, and resolved
 * server-side from the authoritative HeadlessTaskRegistry. It's the link the UI
 * cross-references on — an inbox card → its originating run/issue, an issue
 * detail → the inbox reports it produced.
 *
 * Two live kinds: `kind:'headless'` (a dispatched run — `runId` always, `issueId`
 * when a scheduled issue fired it) and `kind:'interactive'` (a human-attended
 * session — `sessionId`, the pre-allocated record id, navigable to that session
 * tab). `agent` (claude/codex/…) comes off the authoritative record in both.
 * Absent on manual pushes that carried no header → `origin` is undefined.
 */
export type InboxOriginKind = 'headless' | 'interactive' | 'manual'

export interface InboxOrigin {
  kind: InboxOriginKind
  /** The headless run's taskId (== HeadlessTaskRegistry key). */
  runId?: string
  /** The scheduled issue that fired the run, when applicable (filename stem). */
  issueId?: string
  /** The interactive session's pre-allocated record id (navigable to its tab). */
  sessionId?: string
  /** The agent CLI id (claude/codex/…) from the run record. */
  agent?: string
}

export interface InboxEntry {
  id: string
  ts: number
  /** Server-side read marker. Missing means unread. */
  readAt?: number
  workspaceId: string
  workspaceLabel?: string
  /** Pointers to workspace files. Rendered live (no snapshot). */
  docs?: InboxDoc[]
  /** Agent's message body (markdown). Renders below docs. */
  comments?: string
  /** Agent-INVISIBLE provenance, stamped server-side. Absent on legacy entries
   *  and on interactive/manual pushes that carried no run header. */
  origin?: InboxOrigin
}

export interface InboxHistoryResponse {
  entries: InboxEntry[]
  hasMore: boolean
}

export interface InboxSeedBody {
  workspaceId: string
  workspaceLabel?: string
  docs?: InboxDoc[]
  comments?: string
}

export const inboxApi = {
  async history(
    opts: { limit?: number; before?: string; workspaceId?: string } = {},
  ): Promise<InboxHistoryResponse> {
    const qs = new URLSearchParams()
    if (opts.limit != null) qs.set('limit', String(opts.limit))
    if (opts.before) qs.set('before', opts.before)
    if (opts.workspaceId) qs.set('workspaceId', opts.workspaceId)
    return fetchJson(`/api/inbox/history?${qs}`)
  },

  /** Dev-only — append an inbox entry. */
  async seed(body: InboxSeedBody): Promise<{ entry: InboxEntry }> {
    return fetchJson('/api/inbox/seed', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  },

  /** Hard-delete an inbox entry. Returns true on success, false if
   *  the entry didn't exist (server replied 404). */
  async delete(id: string): Promise<boolean> {
    const res = await fetch(`/api/inbox/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    })
    if (res.status === 204) return true
    if (res.status === 404) return false
    throw new Error(`inbox delete failed: ${res.status}`)
  },

  async markRead(id: string): Promise<{ ok: true; id: string; readAt: number }> {
    return fetchJson(`/api/inbox/${encodeURIComponent(id)}/read`, {
      method: 'PUT',
    })
  },

  async markUnread(id: string): Promise<{ ok: true; id: string }> {
    return fetchJson(`/api/inbox/${encodeURIComponent(id)}/read`, {
      method: 'DELETE',
    })
  },
}
