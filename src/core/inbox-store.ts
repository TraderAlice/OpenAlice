/** Immutable Markdown notifications with live source-Workspace file references.
 * Read state lives separately in read-state.json. */

import { randomUUID } from 'node:crypto'
import { readFile, appendFile, mkdir, writeFile, rename, stat } from 'node:fs/promises'
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
  /** The Issue's home Workspace; may differ from the executing Session's Workspace. */
  issueWorkspaceId?: string
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
  /** Markdown, frozen at publication. File references remain live. */
  body: string
  /** Published file fingerprints; paths are derived from body. */
  fileRevisions?: Record<string, string>
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
  unread?: boolean
}

export interface InboxBulkReadResult {
  unreadCount: number
  ids: string[]
  readAt: number
}

export interface IInboxStore {
  append(input: InboxInput): Promise<InboxEntry>
  read(opts?: InboxReadOpts): Promise<{ entries: InboxEntry[]; hasMore: boolean; unreadCount: number }>
  /** Point lookup for business actions such as "ask this entry's sender". */
  get(id: string): Promise<InboxEntry | null>
  /** Mark an entry read. Returns false when the entry id does not exist. */
  markRead(id: string, readAt?: number): Promise<boolean>
  /** Snapshot all existing unread entries, excluding active review targets. */
  markAllRead(excludeIds?: readonly string[]): Promise<InboxBulkReadResult>
  /** Mark an entry unread. Returns false when the entry id does not exist. */
  markUnread(id: string): Promise<boolean>
  /** Hard-delete an entry by id. Returns true if removed, false if no
   *  entry matched. JSONL rewrites are atomic (tmp + rename). */
  delete(id: string): Promise<boolean>
  onAppended(listener: (entry: InboxEntry) => void): () => void
  /** Subscribe to live removals. Returns a dispose function. */
  onRemoved(listener: (id: string) => void): () => void
  /** Lightweight content/read-state revision token for HTTP ETag/304 checks. */
  fingerprint?(): Promise<string>
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
  if (typeof input.body !== 'string' || !input.body.trim()) {
    throw new Error('InboxStore.append: non-empty body is required')
  }
}

// ==================== JSONL store ====================

export interface InboxStoreOptions {
  filePath?: string
  readStatePath?: string
}

interface FileStatSig {
  mtimeMs: number
  size: number
  ino: number
}

function sameFileStat(a: FileStatSig | null, b: FileStatSig | null): boolean {
  if (!a || !b) return false
  return a.mtimeMs === b.mtimeMs && a.size === b.size && a.ino === b.ino
}

async function statSig(path: string): Promise<FileStatSig | null> {
  try {
    const info = await stat(path)
    return { mtimeMs: info.mtimeMs, size: info.size, ino: info.ino }
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw err
  }
}

export function createInboxStore(opts: InboxStoreOptions = {}): IInboxStore {
  const filePath = opts.filePath ?? INBOX_FILE
  const readStatePath = opts.readStatePath ?? INBOX_READ_STATE_FILE
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)
  let readStateQueue: Promise<void> = Promise.resolve()

  let localVersion = 0
  let entriesCache: { sig: FileStatSig; entries: InboxEntry[]; byId: Map<string, InboxEntry>; hasMalformed: boolean } | null = null
  let readStateCache: { sig: FileStatSig; state: InboxReadStateFile } | null = null

  function withReadStateLock<T>(fn: () => Promise<T>): Promise<T> {
    const run = readStateQueue.then(fn, fn)
    readStateQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async function readReadState(): Promise<InboxReadStateFile> {
    if (readStateCache) {
      const currentSig = await statSig(readStatePath)
      if (sameFileStat(readStateCache.sig, currentSig)) {
        return { version: 1, read: { ...readStateCache.state.read } }
      }
      if (!currentSig) {
        readStateCache = null
        return { ...EMPTY_READ_STATE, read: {} }
      }
    }

    let raw: string
    try {
      raw = await readFile(readStatePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        readStateCache = null
        return { ...EMPTY_READ_STATE, read: {} }
      }
      throw err
    }
    const parsed = JSON.parse(raw) as Partial<InboxReadStateFile>
    const state: InboxReadStateFile = {
      version: 1,
      read: parsed.read && typeof parsed.read === 'object' ? { ...parsed.read } : {},
    }
    const sig = await statSig(readStatePath)
    if (sig) {
      readStateCache = { sig, state: { version: 1, read: { ...state.read } } }
    }
    return state
  }

  async function writeReadState(state: InboxReadStateFile): Promise<void> {
    await mkdir(dirname(readStatePath), { recursive: true })
    const tmp = `${readStatePath}.tmp`
    await writeFile(tmp, JSON.stringify(state, null, 2) + '\n', 'utf-8')
    await rename(tmp, readStatePath)
    localVersion++
    const sig = await statSig(readStatePath)
    readStateCache = sig ? { sig, state: { version: 1, read: { ...state.read } } } : null
  }

  async function loadEntries(tolerateMalformed: boolean): Promise<{ entries: InboxEntry[]; byId: Map<string, InboxEntry> } | null> {
    if (entriesCache && (tolerateMalformed || !entriesCache.hasMalformed)) {
      const currentSig = await statSig(filePath)
      if (sameFileStat(entriesCache.sig, currentSig)) {
        return { entries: entriesCache.entries, byId: entriesCache.byId }
      }
      if (!currentSig) {
        entriesCache = null
        return null
      }
    }

    let raw: string
    try {
      raw = await readFile(filePath, 'utf-8')
    } catch (err: unknown) {
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        entriesCache = null
        return null
      }
      throw err
    }

    const entries: InboxEntry[] = []
    const byId = new Map<string, InboxEntry>()
    let hasMalformed = false
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const entry = JSON.parse(line) as InboxEntry
        entries.push(entry)
        if (!byId.has(entry.id)) byId.set(entry.id, entry)
      } catch (err) {
        if (!tolerateMalformed) throw err
        hasMalformed = true
      }
    }

    const sig = await statSig(filePath)
    if (sig) {
      entriesCache = { sig, entries, byId, hasMalformed }
    }
    return { entries, byId }
  }

  async function entryExists(id: string): Promise<boolean> {
    const loaded = await loadEntries(true)
    return loaded ? loaded.byId.has(id) : false
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
    localVersion++
    // Invalidate so the next read observes any concurrent external writes too.
    entriesCache = null
    emitter.emit('appended', entry)
    return entry
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean; unreadCount: number }> {
    const loaded = await loadEntries(false)
    if (!loaded) {
      return { entries: [], hasMore: false, unreadCount: 0 }
    }

    const readState = await readReadState()
    let all = loaded.entries.map((entry) => {
      const readAt = readState.read[entry.id]
      return typeof readAt === 'number' && Number.isFinite(readAt) && readAt > 0
        ? { ...entry, readAt }
        : entry
    })

    const unreadCount = all.filter((entry) => !entry.readAt).length

    if (opts.workspaceId) {
      all = all.filter((e) => e.workspaceId === opts.workspaceId)
    }
    if (opts.unread) {
      all = all.filter((e) => !e.readAt)
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
    return { entries, hasMore, unreadCount }
  }

  async function get(id: string): Promise<InboxEntry | null> {
    const loaded = await loadEntries(true)
    const entry = loaded?.byId.get(id)
    if (!entry) return null
    const readState = await readReadState()
    const readAt = readState.read[id]
    return typeof readAt === 'number' && Number.isFinite(readAt) && readAt > 0
      ? { ...entry, readAt }
      : entry
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

  async function markAllRead(excludeIds: readonly string[] = []): Promise<InboxBulkReadResult> {
    // Capture IDs before waiting for another writer. Later appends are never
    // covered by a timestamp watermark or a second history scan.
    const snapshot = await read({ limit: Number.MAX_SAFE_INTEGER, unread: true })
    const excluded = new Set(excludeIds)
    const candidates = snapshot.entries.filter((entry) => !excluded.has(entry.id))
    return withReadStateLock(async () => {
      const state = await readReadState()
      // Re-read only to count current messages and discard removed candidates.
      // The original snapshot still exclusively determines which IDs may be read.
      const current = await read({ limit: Number.MAX_SAFE_INTEGER })
      const unreadIds = new Set(current.entries.filter((entry) => !entry.readAt).map((entry) => entry.id))
      const ids = candidates.filter((entry) => unreadIds.has(entry.id)).map((entry) => entry.id)
      const unreadCount = current.unreadCount - ids.length
      const readAt = Date.now()
      for (const id of ids) state.read[id] = readAt
      if (ids.length) await writeReadState(state)
      return { ids, readAt, unreadCount }
    })
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
    localVersion++
    entriesCache = null
    await withReadStateLock(async () => {
      const state = await readReadState()
      if (!(id in state.read)) return
      delete state.read[id]
      await writeReadState(state)
    })
    emitter.emit('removed', id)
    return true
  }

  async function fingerprint(): Promise<string> {
    const [entriesSig, readSig] = await Promise.all([statSig(filePath), statSig(readStatePath)])
    const ePart = entriesSig ? `${entriesSig.ino}:${entriesSig.size}:${entriesSig.mtimeMs}` : 'none'
    const rPart = readSig ? `${readSig.ino}:${readSig.size}:${readSig.mtimeMs}` : 'none'
    return `${localVersion}|${ePart}|${rPart}`
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

  return { append, read, get, markRead, markAllRead, markUnread, delete: deleteEntry, onAppended, onRemoved, fingerprint }
}

// ==================== In-memory store (tests) ====================

export function createMemoryInboxStore(): IInboxStore {
  const entries: InboxEntry[] = []
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)
  let version = 0

  async function append(input: InboxInput): Promise<InboxEntry> {
    validateInput(input)
    const entry: InboxEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now(),
    }
    entries.push(entry)
    version++
    emitter.emit('appended', entry)
    return entry
  }

  async function read(opts: InboxReadOpts = {}): Promise<{ entries: InboxEntry[]; hasMore: boolean; unreadCount: number }> {
    let scoped = opts.workspaceId ? entries.filter((e) => e.workspaceId === opts.workspaceId) : [...entries]
    if (opts.unread) scoped = scoped.filter((e) => !e.readAt)
    if (opts.before) {
      const idx = scoped.findIndex((e) => e.id === opts.before)
      scoped = idx >= 0 ? scoped.slice(0, idx) : []
    }
    const limit = opts.limit ?? 100
    const window = scoped.slice(-limit)
    return { entries: [...window].reverse(), hasMore: window.length < scoped.length, unreadCount: entries.filter((entry) => !entry.readAt).length }
  }

  async function get(id: string): Promise<InboxEntry | null> {
    return entries.find((entry) => entry.id === id) ?? null
  }

  async function deleteEntry(id: string): Promise<boolean> {
    const idx = entries.findIndex((e) => e.id === id)
    if (idx < 0) return false
    entries.splice(idx, 1)
    version++
    emitter.emit('removed', id)
    return true
  }

  async function markRead(id: string, readAt = Date.now()): Promise<boolean> {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return false
    entry.readAt = readAt
    version++
    return true
  }

  async function markAllRead(excludeIds: readonly string[] = []): Promise<InboxBulkReadResult> {
    const excluded = new Set(excludeIds)
    const unread = entries.filter((entry) => !entry.readAt && !excluded.has(entry.id))
    const readAt = Date.now()
    for (const entry of unread) entry.readAt = readAt
    if (unread.length > 0) version++
    return { ids: unread.map((entry) => entry.id), readAt, unreadCount: entries.filter((entry) => !entry.readAt).length }
  }

  async function markUnread(id: string): Promise<boolean> {
    const entry = entries.find((e) => e.id === id)
    if (!entry) return false
    delete entry.readAt
    version++
    return true
  }

  async function fingerprint(): Promise<string> {
    return `mem:${version}`
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

  return { append, read, get, markRead, markAllRead, markUnread, delete: deleteEntry, onAppended, onRemoved, fingerprint }
}
