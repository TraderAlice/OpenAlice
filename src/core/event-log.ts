/**
 * Event Log — append-only persistent event log with in-memory ring buffer.
 *
 * Dual-write: every append goes to disk (JSONL) AND an in-memory buffer.
 * The memory buffer holds the most recent N entries (default 500) for fast
 * queries. Disk is the source of truth for crash recovery and full history.
 *
 * Storage: one JSON object per line (`events.jsonl`), append-only.
 * Recovery: on startup, loads the tail of the file into the memory buffer
 * and restores the seq counter.
 */

import { appendFile, readFile, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

// ==================== Types ====================

export interface EventLogEntry<T = unknown> {
  /** Global monotonic sequence number. */
  seq: number
  /** Event timestamp (epoch ms). */
  ts: number
  /** Event type, e.g. "trade.open", "heartbeat.ok". */
  type: string
  /** Arbitrary JSON-serializable payload. */
  payload: T
}

export type EventLogListener = (entry: EventLogEntry) => void

export interface EventLogQueryResult {
  entries: EventLogEntry[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface EventLog {
  /** Append an event. Returns the persisted entry (with seq/ts). */
  append<T>(type: string, payload: T): Promise<EventLogEntry<T>>

  /**
   * Read events from the DISK log file.
   * - afterSeq: only return entries with seq > afterSeq (default: 0 = all)
   * - type: only return entries matching this type
   * - limit: max number of entries to return
   */
  read(opts?: { afterSeq?: number; limit?: number; type?: string }): Promise<EventLogEntry[]>

  /**
   * Paginated query from DISK. Returns entries newest-first (descending seq).
   * - page: 1-indexed page number (default: 1)
   * - pageSize: entries per page (default: 100)
   * - type: only return entries matching this type
   */
  query(opts?: { page?: number; pageSize?: number; type?: string }): Promise<EventLogQueryResult>

  /**
   * Query the in-memory buffer (fast, no disk I/O).
   * - afterSeq: only return entries with seq > afterSeq
   * - type: only return entries matching this type
   * - limit: max number of entries to return
   *
   * Only sees the most recent `bufferSize` entries.
   */
  recent(opts?: { afterSeq?: number; limit?: number; type?: string }): EventLogEntry[]

  /** Current highest seq number (0 if empty). */
  lastSeq(): number

  /** Subscribe to new events (real-time, on append). Returns unsubscribe fn. */
  subscribe(listener: EventLogListener): () => void

  /** Subscribe to new events of a specific type. Returns unsubscribe fn. */
  subscribeType(type: string, listener: EventLogListener): () => void

  /** Close the log (clear listeners and buffer). */
  close(): Promise<void>

  /** Reset all state and delete the log file. For tests only. */
  _resetForTest(): Promise<void>
}

// ==================== Defaults ====================

const DEFAULT_BUFFER_SIZE = 500

// ==================== Implementation ====================

/**
 * Create (or open) an append-only event log.
 *
 * Reads the existing file to restore the seq counter and populate the
 * in-memory buffer with the most recent entries.
 */
export async function createEventLog(opts?: {
  logPath?: string
  /** Max entries in the in-memory ring buffer. Default: 500. */
  bufferSize?: number
}): Promise<EventLog> {
  const logPath = opts?.logPath ?? 'data/event-log/events.jsonl'
  const bufferSize = opts?.bufferSize ?? DEFAULT_BUFFER_SIZE

  // Ensure directory exists
  await mkdir(dirname(logPath), { recursive: true })

  // In-memory ring buffer
  let buffer: EventLogEntry[] = []

  // Recover seq + buffer from existing file
  let seq = await recoverState(logPath, buffer, bufferSize)

  // Listener sets
  const listeners = new Set<EventLogListener>()
  const typeListeners = new Map<string, Set<EventLogListener>>()

  // ---------- append ----------

  async function append<T>(type: string, payload: T): Promise<EventLogEntry<T>> {
    seq += 1
    const entry: EventLogEntry<T> = {
      seq,
      ts: Date.now(),
      type,
      payload,
    }

    // Dual write: disk first, then memory
    const line = JSON.stringify(entry) + '\n'
    await appendFile(logPath, line, 'utf-8')

    // Push to ring buffer, truncate if over limit
    buffer.push(entry)
    if (buffer.length > bufferSize) {
      buffer = buffer.slice(buffer.length - bufferSize)
    }

    // Fan-out to subscribers (swallow errors)
    for (const fn of listeners) {
      try { fn(entry) } catch { /* swallow */ }
    }
    const tSet = typeListeners.get(type)
    if (tSet) {
      for (const fn of tSet) {
        try { fn(entry) } catch { /* swallow */ }
      }
    }

    return entry
  }

  // ---------- read (disk) ----------

  async function read(readOpts?: {
    afterSeq?: number
    limit?: number
    type?: string
  }): Promise<EventLogEntry[]> {
    const afterSeq = readOpts?.afterSeq ?? 0
    const limit = readOpts?.limit ?? Infinity
    const filterType = readOpts?.type

    let raw: string
    try {
      raw = await readFile(logPath, 'utf-8')
    } catch (err: unknown) {
      if (isENOENT(err)) return []
      throw err
    }

    const lines = raw.split('\n')
    const results: EventLogEntry[] = []

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const entry: EventLogEntry = JSON.parse(line)
        if (entry.seq <= afterSeq) continue
        if (filterType && entry.type !== filterType) continue
        results.push(entry)
        if (results.length >= limit) break
      } catch {
        // Skip malformed lines
      }
    }

    return results
  }

  // ---------- query (disk, paginated) ----------

  async function query(queryOpts?: {
    page?: number
    pageSize?: number
    type?: string
  }): Promise<EventLogQueryResult> {
    const page = Math.max(1, queryOpts?.page ?? 1)
    const pageSize = Math.max(1, queryOpts?.pageSize ?? 100)
    const filterType = queryOpts?.type

    // Read all matching entries from disk
    const all = await read({ type: filterType })
    const total = all.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    // Paginate: page 1 = newest entries (end of array)
    const start = Math.max(0, total - page * pageSize)
    const end = total - (page - 1) * pageSize
    const entries = all.slice(start, end).reverse()

    return { entries, total, page, pageSize, totalPages }
  }

  // ---------- recent (memory) ----------

  function recent(readOpts?: {
    afterSeq?: number
    limit?: number
    type?: string
  }): EventLogEntry[] {
    const afterSeq = readOpts?.afterSeq ?? 0
    const limit = readOpts?.limit ?? Infinity
    const filterType = readOpts?.type

    const results: EventLogEntry[] = []

    for (const entry of buffer) {
      if (entry.seq <= afterSeq) continue
      if (filterType && entry.type !== filterType) continue
      results.push(entry)
      if (results.length >= limit) break
    }

    return results
  }

  // ---------- subscribe ----------

  function subscribe(listener: EventLogListener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  function subscribeType(type: string, listener: EventLogListener): () => void {
    let set = typeListeners.get(type)
    if (!set) {
      set = new Set()
      typeListeners.set(type, set)
    }
    set.add(listener)
    return () => {
      set!.delete(listener)
      if (set!.size === 0) typeListeners.delete(type)
    }
  }

  // ---------- lifecycle ----------

  async function close(): Promise<void> {
    listeners.clear()
    typeListeners.clear()
    buffer = []
  }

  async function _resetForTest(): Promise<void> {
    seq = 0
    listeners.clear()
    typeListeners.clear()
    buffer = []
    try {
      await unlink(logPath)
    } catch (err: unknown) {
      if (!isENOENT(err)) throw err
    }
  }

  return {
    append,
    read,
    query,
    recent,
    lastSeq: () => seq,
    subscribe,
    subscribeType,
    close,
    _resetForTest,
  }
}

// ==================== Helpers ====================

/**
 * Read the log file, restore the seq counter, and populate the in-memory
 * buffer with the most recent `bufferSize` entries.
 */
async function recoverState(
  logPath: string,
  buffer: EventLogEntry[],
  bufferSize: number,
): Promise<number> {
  let raw: string
  try {
    raw = await readFile(logPath, 'utf-8')
  } catch (err: unknown) {
    if (isENOENT(err)) return 0
    throw err
  }

  if (!raw.trim()) return 0

  // Parse all valid entries
  const entries: EventLogEntry[] = []
  const lines = raw.split('\n')
  for (const line of lines) {
    if (!line.trim()) continue
    try {
      entries.push(JSON.parse(line))
    } catch {
      // Skip malformed
    }
  }

  if (entries.length === 0) return 0

  // Load tail into buffer
  const tail = entries.slice(-bufferSize)
  buffer.push(...tail)

  // Return last seq
  return entries[entries.length - 1].seq
}

function isENOENT(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
