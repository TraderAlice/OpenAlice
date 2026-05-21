/**
 * NotificationsStore — canonical record of all system-generated push events
 * (heartbeat completions, cron fires, task replies, manual test sends, …).
 *
 * Why this exists separately from SessionStore: a notification isn't a
 * conversation turn. It has no parent message, doesn't participate in the
 * compaction window, and shouldn't pollute any chat session's history.
 * Treating notifications as their own entity lets each connector decide
 * how to surface them (Web: bell + panel; Telegram: inline into chat
 * thread when user is active there + `/notifications` slash command;
 * future Mobile: OS notifications + in-app inbox) without the abstract
 * Connector layer prescribing one strategy.
 *
 * The store is the single source of truth. Connectors subscribe to
 * `onAppended` and decide what to render; queries via `read()` give any
 * connector a way to surface history (e.g. Telegram's `/notifications`
 * command pulls from the same store the Web bell renders from).
 *
 * Persistence: append-only JSONL at `data/sessions/notifications.jsonl`,
 * mirroring the SessionStore pattern. One file regardless of source —
 * `read()` filters by source on read.
 */

import { randomUUID } from 'node:crypto'
import { readFile, appendFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from '@/core/paths.js'
import { EventEmitter } from 'node:events'
import type { MediaAttachment } from './types.js'

export type NotificationSource = 'heartbeat' | 'cron' | 'manual' | 'task'

export interface NotificationInput {
  text: string
  source?: NotificationSource
  media?: MediaAttachment[]
}

export interface NotificationEntry extends NotificationInput {
  id: string
  /** Wall-clock ms at append time. */
  ts: number
}

export interface ReadOpts {
  /** Newest-first slice limit. Default 100. */
  limit?: number
  /** Cursor — return entries strictly older than this id. */
  before?: string
  /** Filter by source. */
  source?: NotificationSource
}

export interface INotificationsStore {
  append(input: NotificationInput): Promise<NotificationEntry>
  /** Returns entries newest-first up to `limit`. Empty array when file is missing. */
  read(opts?: ReadOpts): Promise<{ entries: NotificationEntry[]; hasMore: boolean }>
  /** Subscribe to live appends. Returns a dispose function. */
  onAppended(listener: (entry: NotificationEntry) => void): () => void
}

const NOTIFICATIONS_FILE = dataPath('sessions', 'notifications.jsonl')

// ==================== JSONL store ====================

export interface NotificationsStoreOptions {
  /** Override the on-disk path; default `data/sessions/notifications.jsonl`. */
  filePath?: string
}

export function createNotificationsStore(opts: NotificationsStoreOptions = {}): INotificationsStore {
  const filePath = opts.filePath ?? NOTIFICATIONS_FILE
  const emitter = new EventEmitter()
  // Connectors + UI streams + tests can all subscribe; lift the default cap.
  emitter.setMaxListeners(50)

  async function append(input: NotificationInput): Promise<NotificationEntry> {
    const entry: NotificationEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now(),
    }
    await mkdir(dirname(filePath), { recursive: true })
    await appendFile(filePath, JSON.stringify(entry) + '\n')
    emitter.emit('appended', entry)
    return entry
  }

  async function read(opts: ReadOpts = {}): Promise<{ entries: NotificationEntry[]; hasMore: boolean }> {
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
      .map((l) => JSON.parse(l) as NotificationEntry)

    if (opts.source) {
      all = all.filter((e) => e.source === opts.source)
    }

    // 'before' is the id of an entry the client already has — return entries
    // appearing strictly earlier in append order (older).
    let scoped = all
    if (opts.before) {
      const idx = all.findIndex((e) => e.id === opts.before)
      scoped = idx >= 0 ? all.slice(0, idx) : []
    }

    const limit = opts.limit ?? 100
    // Take last N (newest within scope), reverse to newest-first for the wire.
    const window = scoped.slice(-limit)
    const entries = [...window].reverse()
    const hasMore = window.length < scoped.length
    return { entries, hasMore }
  }

  function onAppended(listener: (entry: NotificationEntry) => void): () => void {
    emitter.on('appended', listener)
    return () => {
      emitter.off('appended', listener)
    }
  }

  return { append, read, onAppended }
}

// ==================== In-memory store (tests) ====================

/**
 * In-memory variant. Same contract as the JSONL store; entries live in an
 * array and vanish on process exit. Useful for unit tests that need
 * isolation without filesystem temp files.
 */
export function createMemoryNotificationsStore(): INotificationsStore {
  const entries: NotificationEntry[] = []
  const emitter = new EventEmitter()
  emitter.setMaxListeners(50)

  async function append(input: NotificationInput): Promise<NotificationEntry> {
    const entry: NotificationEntry = {
      ...input,
      id: randomUUID(),
      ts: Date.now(),
    }
    entries.push(entry)
    emitter.emit('appended', entry)
    return entry
  }

  async function read(opts: ReadOpts = {}): Promise<{ entries: NotificationEntry[]; hasMore: boolean }> {
    let scoped = opts.source ? entries.filter((e) => e.source === opts.source) : entries
    if (opts.before) {
      const idx = scoped.findIndex((e) => e.id === opts.before)
      scoped = idx >= 0 ? scoped.slice(0, idx) : []
    }
    const limit = opts.limit ?? 100
    const window = scoped.slice(-limit)
    return { entries: [...window].reverse(), hasMore: window.length < scoped.length }
  }

  function onAppended(listener: (entry: NotificationEntry) => void): () => void {
    emitter.on('appended', listener)
    return () => {
      emitter.off('appended', listener)
    }
  }

  return { append, read, onAppended }
}
