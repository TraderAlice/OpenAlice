/**
 * Tool Call Log — structured, persistent log of every AI tool invocation.
 *
 * Architecture mirrors EventLog: append-only JSONL on disk + in-memory ring
 * buffer for fast queries + subscriber fan-out for real-time SSE.
 *
 * Two-phase recording:
 *   1. `start(id, name, input, sessionId)` — opens a pending record (in-memory only)
 *   2. `complete(id, output)` — resolves the pending record, computes duration,
 *      persists to disk + buffer, notifies subscribers
 *
 * Storage: `data/tool-calls/tool-calls.jsonl`, one JSON object per line.
 */

import { appendFile, readFile, mkdir, unlink } from 'node:fs/promises'
import { dirname } from 'node:path'

// ==================== Types ====================

export interface ToolCallRecord {
  /** Global monotonic sequence number. */
  seq: number
  /** tool_use id from the provider. */
  id: string
  /** Session this call belongs to. */
  sessionId: string
  /** Tool name (e.g. "searchContracts"). */
  name: string
  /** Full input parameters. */
  input: unknown
  /** Full output content (images already stripped by AgentCenter). */
  output: string
  /** Heuristic status — 'error' when output looks like an error. */
  status: 'ok' | 'error'
  /** Wall-clock duration in milliseconds (tool_result.ts − tool_use.ts). */
  durationMs: number
  /** Epoch ms when the tool_use event arrived. */
  timestamp: number
}

export type ToolCallListener = (record: ToolCallRecord) => void

export interface ToolCallQueryResult {
  entries: ToolCallRecord[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

export interface ToolCallLog {
  /** Open a pending tool call. Called when tool_use event arrives. */
  start(id: string, name: string, input: unknown, sessionId: string): void

  /** Complete a pending tool call. Called when tool_result event arrives. */
  complete(id: string, output: string): Promise<void>

  /** Discard any orphaned pending records (e.g. after stream error). */
  flushPending(): void

  /** Paginated query from disk. Returns entries newest-first. */
  query(opts?: { page?: number; pageSize?: number; name?: string }): Promise<ToolCallQueryResult>

  /** Query the in-memory ring buffer (fast, no disk I/O). */
  recent(opts?: { afterSeq?: number; limit?: number; name?: string }): ToolCallRecord[]

  /** Current highest seq number (0 if empty). */
  lastSeq(): number

  /** Subscribe to new completed records. Returns unsubscribe fn. */
  subscribe(listener: ToolCallListener): () => void

  /** Close the log (clear state). */
  close(): Promise<void>

  /** Reset all state and delete the log file. For tests only. */
  _resetForTest(): Promise<void>
}

// ==================== Defaults ====================

const DEFAULT_BUFFER_SIZE = 500
const DEFAULT_LOG_PATH = 'data/tool-calls/tool-calls.jsonl'

// ==================== Implementation ====================

interface PendingCall {
  id: string
  sessionId: string
  name: string
  input: unknown
  startedAt: number
}

export async function createToolCallLog(opts?: {
  logPath?: string
  bufferSize?: number
}): Promise<ToolCallLog> {
  const logPath = opts?.logPath ?? DEFAULT_LOG_PATH
  const bufferSize = opts?.bufferSize ?? DEFAULT_BUFFER_SIZE

  await mkdir(dirname(logPath), { recursive: true })

  let buffer: ToolCallRecord[] = []
  let seq = await recoverState(logPath, buffer, bufferSize)

  const listeners = new Set<ToolCallListener>()
  const pending = new Map<string, PendingCall>()

  // ---------- start ----------

  function start(id: string, name: string, input: unknown, sessionId: string): void {
    pending.set(id, { id, sessionId, name, input, startedAt: Date.now() })
  }

  // ---------- complete ----------

  async function complete(id: string, output: string): Promise<void> {
    const call = pending.get(id)
    if (!call) return // orphan result — silently ignore
    pending.delete(id)

    seq += 1
    const record: ToolCallRecord = {
      seq,
      id: call.id,
      sessionId: call.sessionId,
      name: call.name,
      input: call.input,
      output,
      status: looksLikeError(output) ? 'error' : 'ok',
      durationMs: Date.now() - call.startedAt,
      timestamp: call.startedAt,
    }

    // Dual write: disk first, then memory
    await appendFile(logPath, JSON.stringify(record) + '\n', 'utf-8')

    buffer.push(record)
    if (buffer.length > bufferSize) {
      buffer = buffer.slice(buffer.length - bufferSize)
    }

    for (const fn of listeners) {
      try { fn(record) } catch { /* swallow */ }
    }
  }

  // ---------- flushPending ----------

  function flushPending(): void {
    pending.clear()
  }

  // ---------- query (disk, paginated) ----------

  async function query(queryOpts?: {
    page?: number
    pageSize?: number
    name?: string
  }): Promise<ToolCallQueryResult> {
    const page = Math.max(1, queryOpts?.page ?? 1)
    const pageSize = Math.max(1, queryOpts?.pageSize ?? 100)
    const filterName = queryOpts?.name

    const all = await readAll(logPath, filterName)
    const total = all.length
    const totalPages = Math.max(1, Math.ceil(total / pageSize))

    // Page 1 = newest entries (end of array)
    const start = Math.max(0, total - page * pageSize)
    const end = total - (page - 1) * pageSize
    const entries = all.slice(start, end).reverse()

    return { entries, total, page, pageSize, totalPages }
  }

  // ---------- recent (memory) ----------

  function recent(readOpts?: {
    afterSeq?: number
    limit?: number
    name?: string
  }): ToolCallRecord[] {
    const afterSeq = readOpts?.afterSeq ?? 0
    const limit = readOpts?.limit ?? Infinity
    const filterName = readOpts?.name

    const results: ToolCallRecord[] = []
    for (const record of buffer) {
      if (record.seq <= afterSeq) continue
      if (filterName && record.name !== filterName) continue
      results.push(record)
      if (results.length >= limit) break
    }
    return results
  }

  // ---------- subscribe ----------

  function subscribe(listener: ToolCallListener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }

  // ---------- lifecycle ----------

  async function close(): Promise<void> {
    listeners.clear()
    pending.clear()
    buffer = []
  }

  async function _resetForTest(): Promise<void> {
    seq = 0
    listeners.clear()
    pending.clear()
    buffer = []
    try { await unlink(logPath) } catch (err: unknown) {
      if (!isENOENT(err)) throw err
    }
  }

  return {
    start,
    complete,
    flushPending,
    query,
    recent,
    lastSeq: () => seq,
    subscribe,
    close,
    _resetForTest,
  }
}

// ==================== Helpers ====================

/** Heuristic: does this tool output look like an error? */
function looksLikeError(output: string): boolean {
  if (!output) return false
  // Check for common error patterns in tool output
  try {
    const parsed = JSON.parse(output)
    if (parsed && typeof parsed === 'object' && 'error' in parsed) return true
  } catch { /* not JSON, check string patterns */ }
  const lower = output.slice(0, 500).toLowerCase()
  return lower.startsWith('error:') || lower.startsWith('error -')
}

async function readAll(logPath: string, filterName?: string): Promise<ToolCallRecord[]> {
  let raw: string
  try {
    raw = await readFile(logPath, 'utf-8')
  } catch (err: unknown) {
    if (isENOENT(err)) return []
    throw err
  }

  const results: ToolCallRecord[] = []
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue
    try {
      const record: ToolCallRecord = JSON.parse(line)
      if (filterName && record.name !== filterName) continue
      results.push(record)
    } catch { /* skip malformed */ }
  }
  return results
}

async function recoverState(
  logPath: string,
  buffer: ToolCallRecord[],
  bufferSize: number,
): Promise<number> {
  const all = await readAll(logPath)
  if (all.length === 0) return 0
  buffer.push(...all.slice(-bufferSize))
  return all[all.length - 1].seq
}

function isENOENT(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
