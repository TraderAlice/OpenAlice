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
 * Read/unread is deliberately NOT written back into entries.jsonl. An entry is
 * the immutable notification record; read state is mutable user-attention state
 * and lives beside it in `data/inbox/read-state.json`. Keeping the two files
 * separate preserves append-only inbox history while making read state shared
 * across Electron, browser, and any other client using the same data root.
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
  /** Content identity at publication time. The file is still rendered live. */
  revision?: string
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
 * Two live kinds: `kind:'headless'` (a dispatched run — `runId` always, set from
 * the spawn-injected AQ_RUN_ID and resolved against the HeadlessTaskRegistry;
 * `issueId` when a scheduled issue fired it, plus the product-owned
 * `resumeId`) and `kind:'interactive'` (a
 * human-attended PTY session — `sessionId`, the pre-allocated SessionRegistry
 * record id, set from the spawn-injected AQ_SESSION_ID and resolved against the
 * session registry). `agent` comes off the authoritative record in both. Absent
 * on manual pushes that carry no header → `origin` is undefined.
 */
export interface InboxOrigin {
  kind: 'headless' | 'interactive' | 'manual'
  /** The headless run's taskId (== HeadlessTaskRegistry key). */
  runId?: string
  /** The scheduled issue that fired the run, when applicable. */
  issueId?: string
  /** The interactive session's pre-allocated SessionRegistry record id. */
  sessionId?: string
  /** Stable product conversation identity. Native runtime ids stay server-side. */
  resumeId?: string
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
  /** Server-side user-attention state. Absent means unread. */
  readAt?: number
}

export interface InboxReadOpts {
  limit?: number
  before?: string
  workspaceId?: string
}

export interface IInboxStore {
  append(input: InboxInput): Promise<InboxEntry>
  read(opts?: InboxReadOpts): Promise<{ entries: InboxEntry[]; hasMore: boolean }>
  /** Mark an entry read. Returns false when the entry id does not exist. */
  markRead(id: string, readAt?: number): Promise<boolean>
  /** Mark an entry unread. Returns false when the entry id does not exist. */
  markUnread(id: string): Promise<boolean>
  /** Hard-delete an entry by id. Returns true if removed, false if no
   *  entry matched. JSONL rewrites are atomic (tmp + rename). */
  delete(id: string): Promise<boolean>
  onAppended(listener: (entry: InboxEntry) => void): () => void
  /** Subscribe to live removals. Returns a dispose function. */
  onRemoved(listener: (id: string) => void): () => void
}

const INBOX_FILE = dataPath('inbox', 'entries.jsonl')
const INBOX_READ_STATE_FILE = dataPath('inbox', 'read-state.json')

interface InboxReadStateFile {
  version: 1
  read: Record<string, number>
}

const EMPTY_READ_STATE: InboxReadStateFile = { version: 1, read: {} }

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
  readStatePath?: string
}

export function createInboxStore(opts: InboxStoreOptions = {}): IInboxStore {
  const filePath = opts.filePath ?? INBOX_FILE
  const readStatePath = opts.readStatePath ?? INBOX_READ_STATE_FILE
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)
  let readStateQueue: Promise<void> = Promise.resolve()

  function withReadStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = readStateQueue.then(fn, fn)
    readStateQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function readReadState(): Promise<InboxReadStateFile> {
    let raw: string
    try {
      raw = await readFile(readStatePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return { ...EMPTY_READ_STATE, read: {} }
      }
      throw err
    }
    const parsed = JSON.parse(raw) as Partial<InboxReadStateFile>
    return {
      version: 1,
      read: parsed.read && typeof parsed.read === 'object' ? parsed.read : {},
    }
  }

  async function writeReadState(state: InboxReadStateFile): Promise<void> {
    await mkdir(dirname(readStatePath), { recursive: true })
    const tmp = `${readStatePath}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8')
    await rename(tmp, readStatePath)
  }

  async function entryExists(id: string): Promise<boolean> {
    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        return false
      }
      throw err
    }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as InboxEntry
        if (entry.id === id) return true
      } catch {
        // Ignore malformed lines here; read/delete preserve or surface them
        // according to their own contracts.
      }
    }
    return false
  }

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

    const readState = await readReadState()
    let all = raw
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => {
        const entry = JSON.parse(l) as InboxEntry
        const readAt = readState.read[entry.id]
        return typeof readAt === 'number' && Number.isFinite(readAt) && readAt > 0
          ? { ...entry, readAt }
          : entry
      })

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

  async function markRead(id: string, readAt = Date.now()): Promise<boolean> {
    if (!await entryExists(id)) return false
    await withReadStateLock(async () => {
      const state = await readReadState()
      state.read[id] = readAt
      await writeReadState(state)
    })
    return true
  }

  async function markUnread(id: string): Promise<boolean> {
    if (!await entryExists(id)) return false
    await withReadStateLock(async () => {
      const state = await readReadState()
      if (!(id in state.read)) return
      delete state.read[id]
      await writeReadState(state)
    })
    return true
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
    await withReadStateLock(async () => {
      const state = await readReadState()
      if (!(id in state.read)) return
      delete state.read[id]
      await writeReadState(state)
    })
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

  return { append, read, markRead, markUnread, delete: deleteEntry, onAppended, onRemoved }
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

  async function markRead(id: string, readAt = Date.now()): Promise<boolean> {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return false
    entry.readAt = readAt
    return true
  }

  async function markUnread(id: string): Promise<boolean> {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return false
    delete entry.readAt
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

  return { append, read, markRead, markUnread, delete: deleteEntry, onAppended, onRemoved }
}
