/**
 * News Collector — Persistent JSONL store with in-memory index
 *
 * Follows the EventLog pattern (src/core/event-log.ts):
 * - Append-only JSONL on disk
 * - In-memory buffer for fast queries
 * - Recover from file on startup
 * - Dedup set survives restarts
 *
 * Implements INewsProvider so archive-analysis tools (globNews/grepNews/readNews) work.
 */

import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { dirname } from 'node:path'
import type { INewsProvider, GetNewsV2Options, NewsItem } from '../archive-analysis/data/interfaces.js'
import { parseLookback } from '../archive-analysis/data/RealNewsProvider.js'
import type { NewsRecord } from './types.js'

const DEFAULT_LOG_PATH = 'data/news-collector/news.jsonl'
const DEFAULT_MAX_IN_MEMORY = 2000
const DEFAULT_RETENTION_DAYS = 7

export interface NewsCollectorStoreOpts {
  logPath?: string
  maxInMemory?: number
  retentionDays?: number
}

export class NewsCollectorStore implements INewsProvider {
  private logPath: string
  private maxInMemory: number
  private retentionDays: number

  /** In-memory buffer, sorted by pubTs ascending */
  private buffer: NewsRecord[] = []
  /** All known dedup keys (survives beyond retention window) */
  private dedupSet: Set<string> = new Set()
  /** Monotonic sequence counter */
  private seq: number = 0

  constructor(opts?: NewsCollectorStoreOpts) {
    this.logPath = opts?.logPath ?? DEFAULT_LOG_PATH
    this.maxInMemory = opts?.maxInMemory ?? DEFAULT_MAX_IN_MEMORY
    this.retentionDays = opts?.retentionDays ?? DEFAULT_RETENTION_DAYS
  }

  /**
   * Initialize: read JSONL from disk, rebuild dedup set and buffer.
   * Must be called before any other method.
   */
  async init(): Promise<void> {
    await mkdir(dirname(this.logPath), { recursive: true })

    let raw: string
    try {
      raw = await readFile(this.logPath, 'utf-8')
    } catch (err: unknown) {
      if (isENOENT(err)) return // No file yet — fresh start
      throw err
    }

    if (!raw.trim()) return

    const retentionCutoff = Date.now() - this.retentionDays * 24 * 60 * 60 * 1000
    const lines = raw.split('\n')

    for (const line of lines) {
      if (!line.trim()) continue
      try {
        const record: NewsRecord = JSON.parse(line)

        // Always track dedup key (full history)
        this.dedupSet.add(record.dedupKey)

        // Track highest seq
        if (record.seq > this.seq) this.seq = record.seq

        // Only load recent items into buffer
        if (record.pubTs >= retentionCutoff) {
          this.buffer.push(record)
        }
      } catch {
        // Skip malformed lines
      }
    }

    // Sort buffer by pubTs ascending
    this.buffer.sort((a, b) => a.pubTs - b.pubTs)

    // Trim buffer if over limit
    if (this.buffer.length > this.maxInMemory) {
      this.buffer = this.buffer.slice(-this.maxInMemory)
    }

    console.log(
      `news-collector-store: recovered ${this.dedupSet.size} dedup keys, ${this.buffer.length} items in memory`,
    )
  }

  /**
   * Ingest a single news item. Returns true if new (not a duplicate).
   */
  async ingest(item: {
    title: string
    content: string
    pubTime: Date
    dedupKey: string
    metadata: Record<string, string | null>
  }): Promise<boolean> {
    if (this.dedupSet.has(item.dedupKey)) return false

    this.seq += 1
    const record: NewsRecord = {
      seq: this.seq,
      ts: Date.now(),
      pubTs: item.pubTime.getTime(),
      dedupKey: item.dedupKey,
      title: item.title,
      content: item.content,
      metadata: item.metadata,
    }

    // Disk first
    const jsonLine = JSON.stringify(record) + '\n'
    await appendFile(this.logPath, jsonLine, 'utf-8')

    // Memory
    this.dedupSet.add(item.dedupKey)
    this.buffer.push(record)

    // Evict oldest if over limit
    if (this.buffer.length > this.maxInMemory) {
      this.buffer = this.buffer.slice(-this.maxInMemory)
    }

    return true
  }

  /**
   * Batch ingest. Returns count of new (non-duplicate) items.
   */
  async ingestBatch(
    items: Array<{
      title: string
      content: string
      pubTime: Date
      dedupKey: string
      metadata: Record<string, string | null>
    }>,
  ): Promise<number> {
    let count = 0
    for (const item of items) {
      const isNew = await this.ingest(item)
      if (isNew) count++
    }
    return count
  }

  /** Check if a dedup key already exists */
  has(dedupKey: string): boolean {
    return this.dedupSet.has(dedupKey)
  }

  /** Number of items in memory */
  get count(): number {
    return this.buffer.length
  }

  /** Number of dedup keys tracked (includes items beyond retention) */
  get dedupCount(): number {
    return this.dedupSet.size
  }

  // ==================== INewsProvider ====================

  async getNews(startTime: Date, endTime: Date): Promise<NewsItem[]> {
    const startMs = startTime.getTime()
    const endMs = endTime.getTime()

    const filtered = this.buffer.filter(
      (r) => r.pubTs > startMs && r.pubTs <= endMs,
    )

    filtered.sort((a, b) => a.pubTs - b.pubTs)
    return filtered.map(recordToNewsItem)
  }

  async getNewsV2(options: GetNewsV2Options): Promise<NewsItem[]> {
    const { endTime, startTime, lookback, limit } = options
    const endMs = endTime.getTime()

    // Determine head truncation
    let startMs: number | null = null
    if (startTime) {
      startMs = startTime.getTime()
    } else if (lookback) {
      const ms = parseLookback(lookback)
      if (ms !== null) {
        startMs = endMs - ms
      }
    }

    let filtered = this.buffer.filter((r) => {
      if (r.pubTs > endMs) return false
      if (startMs !== null && r.pubTs <= startMs) return false
      return true
    })

    filtered.sort((a, b) => a.pubTs - b.pubTs)

    if (limit && filtered.length > limit) {
      filtered = filtered.slice(-limit)
    }

    return filtered.map(recordToNewsItem)
  }

  // ==================== Lifecycle ====================

  async close(): Promise<void> {
    this.buffer = []
    this.dedupSet.clear()
  }
}

// ==================== Helpers ====================

function recordToNewsItem(record: NewsRecord): NewsItem {
  return {
    time: new Date(record.pubTs),
    title: record.title,
    content: record.content,
    metadata: record.metadata,
  }
}

function isENOENT(err: unknown): boolean {
  return err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

/**
 * Compute a dedup key for a news item.
 *
 * Priority: guid > link > content hash
 */
export function computeDedupKey(item: {
  guid?: string
  link?: string
  title: string
  content: string
}): string {
  if (item.guid) return `guid:${item.guid}`
  if (item.link) return `link:${item.link}`
  const hash = createHash('sha256')
    .update(item.title + item.content)
    .digest('hex')
    .slice(0, 16)
  return `hash:${hash}`
}
