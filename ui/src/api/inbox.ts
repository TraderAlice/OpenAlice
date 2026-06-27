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
 * First cut is issue/run-level, headless only (`kind:'headless'`): `runId` is
 * set for every dispatched run, `issueId` when a scheduled issue fired it,
 * `agent` from the run record. `sessionId` + `kind:'interactive'` are reserved
 * for Phase 2. Absent on interactive/manual pushes → `origin` is undefined.
 */
export type InboxOriginKind = 'headless' | 'interactive' | 'manual'

export interface InboxOrigin {
  kind: InboxOriginKind
  /** The headless run's taskId (== HeadlessTaskRegistry key). */
  runId?: string
  /** The scheduled issue that fired the run, when applicable (filename stem). */
  issueId?: string
  /** Reserved for Phase 2 interactive sessions (pre-allocated record id). */
  sessionId?: string
  /** The agent CLI id (claude/codex/…) from the run record. */
  agent?: string
}

export interface InboxEntry {
  id: string
  ts: number
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
}
