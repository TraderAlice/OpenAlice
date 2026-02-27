/**
 * News Collector — RSS fetch service
 *
 * A code-level setInterval service (not AI-driven cron) that periodically
 * fetches configured RSS feeds and ingests new items into the store.
 */

import { fetchAndParseFeed } from './rss-parser.js'
import { computeDedupKey, type NewsCollectorStore } from './store.js'
import type { RSSFeedConfig } from './types.js'

export interface CollectorOpts {
  store: NewsCollectorStore
  feeds: RSSFeedConfig[]
  intervalMs: number
}

export class NewsCollector {
  private timer: ReturnType<typeof setInterval> | null = null
  private store: NewsCollectorStore
  private feeds: RSSFeedConfig[]
  private intervalMs: number

  constructor(opts: CollectorOpts) {
    this.store = opts.store
    this.feeds = opts.feeds
    this.intervalMs = opts.intervalMs
  }

  /** Start periodic collection. Fetches immediately, then at interval. */
  start(): void {
    this.fetchAll().catch((err) =>
      console.warn(`news-collector: initial fetch failed: ${err instanceof Error ? err.message : err}`),
    )
    this.timer = setInterval(
      () => this.fetchAll().catch((err) =>
        console.warn(`news-collector: periodic fetch failed: ${err instanceof Error ? err.message : err}`),
      ),
      this.intervalMs,
    )
  }

  /** Stop periodic collection. */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /** Fetch all configured feeds once. Returns counts. */
  async fetchAll(): Promise<{ total: number; new: number }> {
    let totalItems = 0
    let totalNew = 0

    for (const feed of this.feeds) {
      try {
        const { fetched, ingested } = await this.fetchFeed(feed)
        totalItems += fetched
        totalNew += ingested
      } catch (err) {
        console.warn(
          `news-collector: failed to fetch ${feed.name} (${feed.url}): ${err instanceof Error ? err.message : err}`,
        )
      }
    }

    if (totalNew > 0) {
      console.log(
        `news-collector: fetched ${totalItems} items from ${this.feeds.length} feeds, ${totalNew} new`,
      )
    }

    return { total: totalItems, new: totalNew }
  }

  /** Fetch a single feed and ingest its items. */
  private async fetchFeed(feed: RSSFeedConfig): Promise<{ fetched: number; ingested: number }> {
    const items = await fetchAndParseFeed(feed.url)
    let ingested = 0

    for (const item of items) {
      const dedupKey = computeDedupKey({
        guid: item.guid ?? undefined,
        link: item.link ?? undefined,
        title: item.title,
        content: item.content,
      })

      const isNew = await this.store.ingest({
        title: item.title,
        content: item.content,
        pubTime: item.pubDate ?? new Date(),
        dedupKey,
        metadata: {
          source: feed.source,
          link: item.link,
          guid: item.guid,
          ingestSource: 'rss',
          dedupKey,
          ...(feed.categories ? { categories: feed.categories.join(',') } : {}),
        },
      })

      if (isNew) ingested++
    }

    return { fetched: items.length, ingested }
  }
}
