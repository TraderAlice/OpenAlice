/**
 * News Collector — Zod configuration schema
 *
 * Loaded from data/config/news-collector.json (optional; defaults used if absent).
 */

import { z } from 'zod'

const feedSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  source: z.string(),
  categories: z.array(z.string()).optional(),
})

export const newsCollectorSchema = z.object({
  /** Master switch */
  enabled: z.boolean().default(true),
  /** Fetch interval in minutes */
  intervalMinutes: z.number().int().positive().default(10),
  /** Max news items kept in the in-memory buffer */
  maxInMemory: z.number().int().positive().default(2000),
  /** Items older than this are not loaded into memory on startup */
  retentionDays: z.number().int().positive().default(7),
  /** Also capture results from newsGetWorld / newsGetCompany into the store */
  piggybackOpenBB: z.boolean().default(true),
  /** RSS / Atom feed list */
  feeds: z.array(feedSchema).default([
    { name: 'CoinDesk', url: 'https://www.coindesk.com/arc/outboundfeeds/rss/', source: 'coindesk' },
    { name: 'CoinTelegraph', url: 'https://cointelegraph.com/rss', source: 'cointelegraph' },
    { name: 'The Block', url: 'https://www.theblock.co/rss.xml', source: 'theblock' },
    { name: 'CNBC Finance', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664', source: 'cnbc' },
  ]),
})

export type NewsCollectorConfig = z.infer<typeof newsCollectorSchema>
