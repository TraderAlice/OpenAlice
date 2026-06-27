/**
 * InboxStore — workspace-anchored push surface, Linear-inbox model.
 *
 * Atomic concept here is the **Workspace**, not Linear's "Issue". The
 * workspace's author (the AI agent) lives inside the workspace, and its
 * work product is the workspace folder's files — not single comments
 * authored at notification time. So an inbox entry carries:
 *
 *   - `docs`     pointers to files in the workspace ("go read these")
 *                — rendered live at view time, never snapshotted
 *   - `comments` the agent's voice — markdown, the actual message body
 *                ("hey boss, here's what I want to say about it")
 *
 * Both are optional but at least one must be present. Pointer-only on
 * docs is deliberate (matches Linear's "inbox row is a notification, the
 * issue is the SOR"): the workspace folder is its own version-controlled
 * source of truth, so snapshotting into the inbox would just create a
 * stale parallel copy. Workspace deletion → inbox tombstones; that's
 * correct semantics, not a lifecycle bug.
 *
 * v0.5 contract: append-only JSONL at `data/inbox/entries.jsonl`,
 * `workspaceId` required, at least one of {docs, comments} required.
 * No connector subscription, no outputGate, no dedup.
 *
 * Write path: the production writer is the `inbox_push` MCP tool
 * (`tool/inbox-push.ts`), workspace-scoped via WorkspaceToolCenter at
 * `/mcp/:wsId` — the agent inside a workspace calls it; the wsId is
 * bound by the router, never supplied by the agent. The dev `/seed`
 * HTTP endpoint remains for manual/testing appends.
 */

import { randomUUID } from 'node:crypto'
import { readFile, appendFile, mkdir, writeFile, rename } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import { EventEmitter } from 'node:events'

/** Pointer to a workspace file. Rendered live at view time. */
export interface InboxDoc {
  /** Path relative to the workspace root. */
  path: string
}

/**
 * Where an inbox entry came from — the agent-INVISIBLE provenance the server
 * stamps onto every push. The agent never supplies any of this (exactly as it
 * never supplies its own wsId): the run identity is injected as a spawn-time env
 * var, carried out-of-band on an HTTP header by OpenAlice-owned code, and
 * resolved server-side from the authoritative HeadlessTaskRegistry. It's the
 * link the UI cross-references on: an inbox card → its originating run/issue,
 * an issue detail → the inbox reports it produced.
 *
 * First cut is issue/run-level, headless only (`kind:'headless'`): `runId` is
 * set for every dispatched run, `issueId` when a scheduled issue fired it,
 * `agent` from the run record. `sessionId` + `kind:'interactive'` are reserved
 * for Phase 2 (a pre-allocated session record id via a future AQ_SESSION_ID) —
 * the object is structured now so it grows without reshaping. Absent on
 * interactive/manual pushes that carry no run header → `origin` is undefined.
 */
export interface InboxOrigin {
  kind: 'headless' | 'interactive' | 'manual'
  /** The headless run's taskId (== HeadlessTaskRegistry key). */
  runId?: string
  /** The scheduled issue that fired the run, when applicable. */
  issueId?: string
  /** Reserved for Phase 2 interactive sessions (pre-allocated record id). */
  sessionId?: string
  /** The agent CLI id (claude/codex/…) from the run record. */
  agent?: string
}

export interface InboxInput {
  workspaceId: string
  /** Display snapshot of the workspace label. Optional; readers fall
   *  back to workspaceId. */
  workspaceLabel?: string
  /** Workspace files to render. Each entry is a pointer — content is
   *  fetched live from the workspace folder at view time. */
  docs?: InboxDoc[]
  /** Agent's message body (markdown). Renders below docs. */
  comments?: string
  /** Agent-INVISIBLE provenance, stamped server-side from the spawn-injected
   *  run header (never supplied by the agent). Optional + additive: old JSONL
   *  entries parse with `origin === undefined`, so NO migration is needed. */
  origin?: InboxOrigin
}

export interface InboxEntry extends InboxInput {
  id: string
  ts: number
}

export interface InboxReadOpts {
  limit?: number
  before?: string
  workspaceId?: string
}

export interface IInboxStore {
  append(input: InboxInput): Promise<InboxEntry>
  read(opts?: InboxReadOpts): Promise<{ entries: InboxEntry[]; hasMore: boolean }>
  /** Hard-delete an entry by id. Returns true if removed, false if no
   *  entry matched. JSONL rewrites are atomic (tmp + rename). */
  delete(id: string): Promise<boolean>
  onAppended(listener: (entry: InboxEntry) => void): () => void
  /** Subscribe to live removals. Returns a dispose function. */
  onRemoved(listener: (id: string) => void): () => void
}

const INBOX_FILE = dataPath('inbox', 'entries.jsonl')

// ==================== Validation ====================

function validateInput(input: InboxInput): void {
  if (!input.workspaceId) {
    throw new Error('InboxStore.append: workspaceId is required')
  }
  const hasDocs = (input.docs?.length ?? 0) > 0
  const hasComments = (input.comments ?? '').trim().length > 0
  if (!hasDocs && !hasComments) {
    throw new Error('InboxStore.append: at least one of docs or comments must be present')
  }
  if (input.docs) {
    for (const d of input.docs) {
      if (!d.path || typeof d.path !== 'string') {
        throw new Error('InboxStore.append: each doc must have a non-empty `path` string')
      }
    }
  }
}

// ==================== JSONL store ====================

export interface InboxStoreOptions {
  filePath?: string
}

export function createInboxStore(opts: InboxStoreOptions = {}): IInboxStore {
  const filePath = opts.filePath ?? INBOX_FILE
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  async function append(input: InboxInput): Promise<InboxEntry> {
    validateInput(input)
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now(),
    }
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, JSON.stringify(entry) + '\n')
    emitter.emit('appended', entry)
    return entry
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean }> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { entries: [], hasMore: false }
      }
      throw err
    }

    let all = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l) as InboxEntry)

    if (opts.workspaceId) {
      all = all.filter((e) => e.workspaceId === opts.workspaceId)
    }

    let scoped = all
    if (opts.before) {
      const idx = all.findIndex((e) => e.id === opts.before)
      scoped = idx >= 0 ? all.slice(0, idx) : []
    }

    const limit = opts.limit ?? 100
    const window = scoped.slice(-limit)
    const entries = [...window].reverse()
    const hasMore = window.length < scoped.length
    return { entries, hasMore }
  }

  async function deleteEntry(id: string): Promise<boolean> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw err
    }
    const lines = raw.split('\n').filter((l) => l.trim())
    let removed = false
    const kept: string[] = []
    for (const line of lines) {
      try {
        const entry = JSON.parse(line) as InboxEntry
        if (entry.id === id) {
          removed = true
          continue
        }
        kept.push(line)
      } catch {
        // Preserve unparseable lines so a malformed entry can't be used to
        // accidentally wipe the file via delete().
        kept.push(line)
      }
    }
    if (!removed) return false

    // Atomic rewrite — tmp + rename. Crash mid-write leaves the previous
    // file intact instead of producing a half-truncated JSONL.
    const tmp = `${filePath}.tmp`
    const body = kept.length > 0 ? kept.join('\n') + '\n' : ''
    await writeFile(tmp, body, 'utf-8')
    await rename(tmp, filePath)
    emitter.emit('removed', id)
    return true
  }

  function onAppended(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('appended', listener)
    return () => {
      emitter.off('appended', listener)
    }
  }

  function onRemoved(listener: (id: string) => void): () => void {
    emitter.on('removed', listener)
    return () => {
      emitter.off('removed', listener)
    }
  }

  return { append, read, delete: deleteEntry, onAppended, onRemoved }
}

// ==================== In-memory store (tests) ====================

export function createMemoryInboxStore(): IInboxStore {
  const entries: InboxEntry[] = []
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  async function append(input: InboxInput): Promise<InboxEntry> {
    validateInput(input)
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now(),
    }
    entries.push(entry)
    emitter.emit('appended', entry)
    return entry
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean }> {
    let scoped = opts.workspaceId ? entries.filter((e) => e.workspaceId === opts.workspaceId) : entries
    if (opts.before) {
      const idx = scoped.findIndex((e) => e.id === opts.before)
      scoped = idx >= 0 ? scoped.slice(0, idx) : []
    }
    const limit = opts.limit ?? 100
    const window = scoped.slice(-limit)
    return { entries: [...window].reverse(), hasMore: window.length < scoped.length }
  }

  async function deleteEntry(id: string): Promise<boolean> {
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return false
    entries.splice(idx, 1)
    emitter.emit('removed', id)
    return true
  }

  function onAppended(listener: (entry: InboxEntry) => void): () => void {
    emitter.on('appended', listener)
    return () => {
      emitter.off('appended', listener)
    }
  }

  function onRemoved(listener: (id: string) => void): () => void {
    emitter.on('removed', listener)
    return () => {
      emitter.off('removed', listener)
    }
  }

  return { append, read, delete: deleteEntry, onAppended, onRemoved }
}
