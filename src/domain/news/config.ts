/**
 * News Collector — Zod configuration schema
 *
 * Loaded from data/config/news.json (optional; defaults used if absent).
 */

import { z } from 'zod'
import { moduleSelectionSchema, subscriptionSchema } from './modules/contract.js'

export const DEFAULT_RSSHUB_BASE_URL = 'http://127.0.0.1:1200'

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
  } catch {
    return false
  }
}

export const rssHubRouteSchema = z.string().trim().min(1).refine((route) => {
  try {
    if (URL.canParse(route) || /^[\/]|[\\#\s]/.test(route)) return false
    const query = new URL(route, DEFAULT_RSSHUB_BASE_URL + '/').searchParams
    if (query.has('key') || query.has('code')) return false
    const path = route.split('?')[0]!
    if (path.split('/').some((part) => ['.', '..'].includes(decodeURIComponent(part)))) return false
    return new URL(route, DEFAULT_RSSHUB_BASE_URL + '/').origin === DEFAULT_RSSHUB_BASE_URL
  } catch {
    return false
  }
}, 'Enter a relative RSSHub route, without an origin or fragment')

export function resolveNewsFeedUrl(feed: { url: string; rsshubRoute?: string }, baseUrl = DEFAULT_RSSHUB_BASE_URL): string {
  if (!feed.rsshubRoute) return feed.url
  const base = new URL(baseUrl)
  if (!isHttpUrl(baseUrl) || base.search || base.hash) throw new Error('Invalid RSSHub instance URL')
  const route = rssHubRouteSchema.parse(feed.rsshubRoute)
  return new URL(route, base.href.replace(/\/+$/, '') + '/').href
}

const rssHubBaseSchema = z.string().trim().url().refine((value) => {
  if (!isHttpUrl(value)) return false
  const url = new URL(value)
  return !url.search && !url.hash
}, 'Enter an HTTP(S) instance URL without credentials, query or fragment')

const feedSchema = z.object({
  id: z.string().trim().min(1).default(() => globalThis.crypto.randomUUID()),
  rsshubRoute: rssHubRouteSchema.optional(),
  name: z.string().trim().min(1),
  url: z.string().trim().url().refine(isHttpUrl, 'Enter an HTTP(S) feed URL without credentials'),
  source: z.string().trim().min(1),
  categories: z.array(z.string()).optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
})

export const newsCollectorSchema = z.object({
  rsshubBaseUrl: rssHubBaseSchema.default(DEFAULT_RSSHUB_BASE_URL),
  /** Master switch */
  enabled: z.boolean().default(true),
  /** Fetch interval in minutes */
  intervalMinutes: z.number().int().positive().default(10),
  /** Max news items kept in the in-memory buffer */
  maxInMemory: z.number().int().positive().default(2000),
  /** Items older than this are not loaded into memory on startup */
  retentionDays: z.number().int().positive().default(7),
  modules: z.array(moduleSelectionSchema).max(128).default([]),
  subscriptions: z.array(subscriptionSchema).max(1024).default([]),
  /**
   * RSS / Atom feed list.
   *
   * Ships with a curated menu of direct feeds. A subset is enabled by
   * default; remaining entries are opt-in. Catalog membership is not
   * a guarantee that the upstream feed is currently reachable.
   */
  feeds: z.array(feedSchema).default([
    // ---------- Macro / central banks (enabled) ----------
    {
      name: 'Federal Reserve Press',
      url: 'https://www.federalreserve.gov/feeds/press_all.xml',
      source: 'fed',
      categories: ['macro'],
      description: 'US Federal Reserve press releases, FOMC statements, enforcement actions.',
      enabled: true,
    },
    {
      name: 'ECB Press',
      url: 'https://www.ecb.europa.eu/rss/press.html',
      source: 'ecb',
      categories: ['macro'],
      description: 'European Central Bank press releases and policy statements.',
      enabled: true,
    },

    // ---------- US markets (some enabled) ----------
    {
      name: 'MarketWatch Top Stories',
      url: 'http://feeds.marketwatch.com/marketwatch/topstories/',
      source: 'marketwatch',
      categories: ['markets', 'us'],
      description: 'Broad daily US market news and commentary.',
      enabled: true,
    },
    {
      name: 'WSJ Markets',
      url: 'https://feeds.a.dj.com/rss/RSSMarketsMain.xml',
      source: 'wsj-markets',
      categories: ['markets', 'us'],
      description: 'Wall Street Journal — US markets and equities coverage.',
      enabled: true,
    },
    {
      name: 'CNBC Economy',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
      source: 'cnbc-economy',
      categories: ['macro', 'markets'],
      description: 'CNBC — US economic data, Fed coverage, policy analysis.',
      enabled: true,
    },
    {
      name: 'MarketWatch Real-time',
      url: 'http://feeds.marketwatch.com/marketwatch/marketpulse/',
      source: 'marketwatch-pulse',
      categories: ['markets', 'us'],
      description: 'High-volume intraday US market updates (noisy but fast).',
      enabled: false,
    },
    {
      name: 'Yahoo Finance',
      url: 'https://finance.yahoo.com/news/rssindex',
      source: 'yahoo-finance',
      categories: ['markets', 'us'],
      description: 'Retail-oriented US stock movers and earnings.',
      enabled: false,
    },
    {
      name: 'Seeking Alpha',
      url: 'https://seekingalpha.com/feed.xml',
      source: 'seekingalpha',
      categories: ['markets', 'us'],
      description: 'Equity analysis and earnings call coverage.',
      enabled: false,
    },
    {
      name: 'WSJ Business',
      url: 'https://feeds.a.dj.com/rss/RSSWSJD.xml',
      source: 'wsj-business',
      categories: ['markets', 'us'],
      description: 'Wall Street Journal — business section.',
      enabled: false,
    },
    {
      name: 'WSJ World News',
      url: 'https://feeds.a.dj.com/rss/RSSWorldNews.xml',
      source: 'wsj-world',
      categories: ['news', 'world'],
      description: 'Wall Street Journal — world news (geopolitics).',
      enabled: false,
    },
    {
      name: 'NYT Business',
      url: 'https://rss.nytimes.com/services/xml/rss/nyt/Business.xml',
      source: 'nyt-business',
      categories: ['markets', 'us'],
      description: 'New York Times — business section.',
      enabled: false,
    },
    {
      name: 'NYT Economy',
      url: 'https://rss.nytimes.com/services/xml/rss/nyt/Economy.xml',
      source: 'nyt-economy',
      categories: ['macro', 'us'],
      description: 'New York Times — economy section.',
      enabled: false,
    },
    {
      name: 'FT Home',
      url: 'https://www.ft.com/rss/home',
      source: 'ft',
      categories: ['markets', 'world'],
      description: 'Financial Times headlines (some articles paywalled).',
      enabled: false,
    },
    {
      name: 'The Economist Finance',
      url: 'https://www.economist.com/finance-and-economics/rss.xml',
      source: 'economist-finance',
      categories: ['macro', 'markets'],
      description: 'The Economist — finance and economics section.',
      enabled: false,
    },
    {
      name: 'CNBC Finance',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664',
      source: 'cnbc',
      categories: ['markets', 'us'],
      description: 'CNBC — general finance section.',
      enabled: false,
    },
    {
      name: 'CNBC Top News',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114',
      source: 'cnbc-top',
      categories: ['news'],
      description: 'CNBC — top headlines across all topics.',
      enabled: false,
    },
    {
      name: 'CNBC Markets',
      url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839069',
      source: 'cnbc-markets',
      categories: ['markets', 'us'],
      description: 'CNBC — US equity market coverage.',
      enabled: false,
    },

    // ---------- Tech / equity context (disabled) ----------
    {
      name: 'TechCrunch',
      url: 'https://techcrunch.com/feed/',
      source: 'techcrunch',
      categories: ['tech'],
      description: 'Startup funding, IPOs, and tech industry news.',
      enabled: false,
    },
    {
      name: 'The Verge',
      url: 'https://www.theverge.com/rss/index.xml',
      source: 'theverge',
      categories: ['tech'],
      description: 'Consumer tech and product news.',
      enabled: false,
    },
    {
      name: 'Ars Technica',
      url: 'https://feeds.arstechnica.com/arstechnica/index',
      source: 'arstechnica',
      categories: ['tech'],
      description: 'Deep-dive technology reporting.',
      enabled: false,
    },

    // ---------- International / APAC ----------
    {
      name: 'Nikkei Asia',
      url: 'https://asia.nikkei.com/rss/feed/nar',
      source: 'nikkei-asia',
      categories: ['markets', 'asia'],
      description: 'Japan and broader APAC business coverage.',
      enabled: true,
    },
    {
      name: 'SCMP Business',
      url: 'https://www.scmp.com/rss/91/feed',
      source: 'scmp-business',
      categories: ['markets', 'asia'],
      description: 'South China Morning Post — Hong Kong and China business.',
      enabled: true,
    },
    {
      name: 'SCMP Economy',
      url: 'https://www.scmp.com/rss/92/feed',
      source: 'scmp-economy',
      categories: ['macro', 'asia'],
      description: 'South China Morning Post — Hong Kong and China economic policy.',
      enabled: false,
    },

    // ---------- Crypto (one enabled, rest as menu) ----------
    {
      name: 'CoinDesk',
      url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
      source: 'coindesk',
      categories: ['crypto'],
      description: 'Major crypto news outlet — market and regulatory coverage.',
      enabled: true,
    },
    {
      name: 'CoinTelegraph',
      url: 'https://cointelegraph.com/rss',
      source: 'cointelegraph',
      categories: ['crypto'],
      description: 'Crypto news and analysis, higher volume than CoinDesk.',
      enabled: false,
    },
    {
      name: 'The Block',
      url: 'https://www.theblock.co/rss.xml',
      source: 'theblock',
      categories: ['crypto'],
      description: 'Institutional-leaning crypto reporting.',
      enabled: false,
    },
    {
      name: 'Bitcoin Magazine',
      url: 'https://bitcoinmagazine.com/feed',
      source: 'bitcoinmagazine',
      categories: ['crypto'],
      description: 'Bitcoin-focused reporting and commentary.',
      enabled: false,
    },
    {
      name: 'Decrypt',
      url: 'https://decrypt.co/feed',
      source: 'decrypt',
      categories: ['crypto'],
      description: 'Crypto and web3 news.',
      enabled: false,
    },
  ].map(feed => ({ ...feed, id: 'builtin.rss.' + feed.source + '.' + feed.name.toLowerCase().replace(/[^a-z0-9]+/g, '-') }))),
}).strict().superRefine((config, ctx) => {
  const ids = new Set<string>()
  config.feeds.forEach((feed, index) => {
    if (feed.rsshubRoute) {
      const companion = new URL(feed.url)
      if (companion.searchParams.has('key') || companion.searchParams.has('code')) ctx.addIssue({ code: 'custom', path: ['feeds', index, 'url'], message: 'RSSHub credentials must not be stored in feed URLs' })
    }
    if (!feed.id) return
    if (ids.has(feed.id)) ctx.addIssue({ code: 'custom', path: ['feeds', index, 'id'], message: 'Duplicate source ID' })
    ids.add(feed.id)
  })
  if (new Set(config.modules.map(module => module.moduleId)).size !== config.modules.length) ctx.addIssue({code: 'custom', path: ['modules'], message: 'Duplicate module identity'})
  if (new Set(config.subscriptions.map(subscription => subscription.id)).size !== config.subscriptions.length) ctx.addIssue({code: 'custom', path: ['subscriptions'], message: 'Duplicate subscription identity'})
})

export type NewsCollectorConfig = z.infer<typeof newsCollectorSchema>

export const RSSHUB_NEWS_PRESETS = [
  { name: '财联社 · 电报', source: 'cls', rsshubRoute: 'cls/telegraph', description: 'CLS telegraph news via RSSHub.' },
  { name: '格隆汇 · 实时快讯', source: 'gelonghui', rsshubRoute: 'gelonghui/live', description: 'Gelonghui live news via RSSHub.' },
  { name: '金十数据 · 市场快讯', source: 'jin10', rsshubRoute: 'jin10', description: 'Jin10 market news via RSSHub.' },
].map((preset) => ({ ...preset, url: resolveNewsFeedUrl({ url: '', rsshubRoute: preset.rsshubRoute }), enabled: true }))

export function getNewsFeedPresets() {
  return [...newsCollectorSchema.parse({}).feeds, ...RSSHUB_NEWS_PRESETS]
}
