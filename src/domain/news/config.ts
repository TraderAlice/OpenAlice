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
      url: 'https://feeds.marketwatch.com/marketwatch/topstories/',
      source: 'marketwatch',
      categories: ['markets', 'us'],
      description: 'Broad daily US market news and commentary.',
      enabled: true,
    },
    {
      name: 'WSJ Markets',
      url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain',
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

    // ---------- Official AI / research context (opt-in) ----------
    {
      name: 'OpenAI News', url: 'https://openai.com/news/rss.xml', source: 'openai-news',
      categories: ['ai', 'tech'], description: 'Official OpenAI product, research and company announcements.', enabled: false,
    },
    {
      name: 'Google DeepMind', url: 'https://deepmind.google/blog/rss.xml', source: 'google-deepmind',
      categories: ['ai', 'tech'], description: 'Official Google DeepMind research and model announcements.', enabled: false,
    },
    {
      name: 'Google Research', url: 'https://research.google/blog/rss/', source: 'google-research',
      categories: ['ai', 'tech'], description: 'Official Google research publications and technical developments.', enabled: false,
    },
    {
      name: 'Hugging Face Blog', url: 'https://huggingface.co/blog/feed.xml', source: 'hugging-face',
      categories: ['ai', 'tech'], description: 'Open model, tooling and ecosystem updates from Hugging Face; feed entries may contain only a title and link.', enabled: false,
    },
    {
      name: 'Microsoft Research', url: 'https://www.microsoft.com/en-us/research/feed/', source: 'microsoft-research',
      categories: ['ai', 'tech'], description: 'Official Microsoft research news and publications.', enabled: false,
    },
    {
      name: 'NVIDIA Blog', url: 'https://blogs.nvidia.com/feed/', source: 'nvidia-blog',
      categories: ['ai', 'tech', 'semiconductors'], description: 'Official NVIDIA computing, AI and industry announcements.', enabled: false,
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
  { name: '财联社 · 电报', source: 'cls', rsshubRoute: 'cls/telegraph', categories: ['cn', 'markets'], description: 'A 股盘中快讯、公司公告及宏观政策动态。' },
  { name: '格隆汇 · 实时快讯', source: 'gelonghui', rsshubRoute: 'gelonghui/live', categories: ['cn', 'hk', 'markets'], description: '覆盖 A 股、港股的盘中消息与公司动态。' },
  { name: '金十数据 · 市场快讯', source: 'jin10', rsshubRoute: 'jin10', categories: ['macro', 'fx', 'commodities'], description: '宏观数据发布、外汇与大宗商品市场快讯。' },
  { name: '华尔街见闻 · 全球快讯', source: 'wallstreetcn', rsshubRoute: 'wallstreetcn/live/global', categories: ['macro', 'markets'], description: '全球财经、央行政策与市场突发消息。' },
  { name: '华尔街见闻 · A 股', source: 'wallstreetcn-a', rsshubRoute: 'wallstreetcn/live/a-stock', categories: ['cn', 'markets'], description: '沪深市场、上市公司及行业动态。' },
  { name: '华尔街见闻 · 港股', source: 'wallstreetcn-hk', rsshubRoute: 'wallstreetcn/live/hk-stock', categories: ['hk', 'markets'], description: '香港市场、上市公司及中概相关快讯。' },
  { name: '华尔街见闻 · 美股', source: 'wallstreetcn-us', rsshubRoute: 'wallstreetcn/live/us-stock', categories: ['us', 'markets'], description: '以中文阅读美国市场、财报与公司快讯。' },
  { name: '华尔街见闻 · 外汇', source: 'wallstreetcn-fx', rsshubRoute: 'wallstreetcn/live/forex', categories: ['fx', 'macro'], description: '汇率、货币政策与全球外汇市场动态。' },
  { name: '华尔街见闻 · 商品', source: 'wallstreetcn-commodities', rsshubRoute: 'wallstreetcn/live/commodity', categories: ['commodities', 'futures'], description: '能源、金属及大宗商品期货快讯。' },
  { name: '金融界 · 财经', source: 'jrj', rsshubRoute: 'jrj/103', categories: ['cn', 'markets'], description: '国内财经资讯、政策与产业消息。' },
  { name: '金融界 · A 股', source: 'jrj-a', rsshubRoute: 'jrj/010', categories: ['cn', 'markets'], description: 'A 股市场、上市公司与投资动态。' },
  { name: '金融界 · 港股', source: 'jrj-hk', rsshubRoute: 'jrj/001', categories: ['hk', 'markets'], description: '香港股票市场与上市公司资讯。' },
  { name: '金融界 · 美股', source: 'jrj-us', rsshubRoute: 'jrj/102', categories: ['us', 'markets'], description: '中文美股资讯与公司报道。' },
  { name: '金融界 · 基金', source: 'jrj-funds', rsshubRoute: 'jrj/104', categories: ['funds', 'cn'], description: '基金发行、产品与资产管理行业资讯。' },
  { name: '金融界 · 债券', source: 'jrj-bonds', rsshubRoute: 'jrj/118', categories: ['bonds', 'cn'], description: '债券市场、发行与信用相关资讯。' },
].map((preset) => ({ ...preset, url: resolveNewsFeedUrl({ url: '', rsshubRoute: preset.rsshubRoute }), enabled: true }))

// Catalog coverage stays separate from saved subscriptions and article categories.
const SOURCE_COVERAGE: Record<string, { regions: string[]; markets: string[] }> = {
  fed: { regions: ['us'], markets: ['macro', 'bonds'] },
  ecb: { regions: ['europe'], markets: ['macro', 'bonds', 'fx'] },
  marketwatch: { regions: ['us'], markets: ['markets'] },
  'wsj-markets': { regions: ['us'], markets: ['markets'] },
  'cnbc-economy': { regions: ['us'], markets: ['macro'] },
  'marketwatch-pulse': { regions: ['us'], markets: ['markets'] },
  'yahoo-finance': { regions: ['us'], markets: ['markets'] },
  seekingalpha: { regions: ['us'], markets: ['markets'] },
  'wsj-business': { regions: ['us', 'global'], markets: ['markets'] },
  'wsj-world': { regions: ['global'], markets: ['macro'] },
  'nyt-business': { regions: ['us', 'global'], markets: ['markets'] },
  'nyt-economy': { regions: ['us'], markets: ['macro'] },
  ft: { regions: ['global'], markets: ['markets', 'macro'] },
  'economist-finance': { regions: ['global'], markets: ['macro', 'markets'] },
  cnbc: { regions: ['us'], markets: ['markets'] },
  'cnbc-top': { regions: ['us', 'global'], markets: ['markets', 'macro'] },
  'cnbc-markets': { regions: ['us'], markets: ['markets'] },
  techcrunch: { regions: ['global'], markets: ['tech'] },
  theverge: { regions: ['global'], markets: ['tech'] },
  arstechnica: { regions: ['global'], markets: ['tech'] },
  'openai-news': { regions: ['global'], markets: ['ai', 'tech'] },
  'google-deepmind': { regions: ['global'], markets: ['ai', 'tech'] },
  'google-research': { regions: ['global'], markets: ['ai', 'tech'] },
  'hugging-face': { regions: ['global'], markets: ['ai', 'tech'] },
  'microsoft-research': { regions: ['global'], markets: ['ai', 'tech'] },
  'nvidia-blog': { regions: ['global'], markets: ['ai', 'tech'] },
  'nikkei-asia': { regions: ['jp', 'asia'], markets: ['markets', 'macro'] },
  'scmp-business': { regions: ['cn', 'hk'], markets: ['markets'] },
  'scmp-economy': { regions: ['cn', 'hk'], markets: ['macro'] },
  coindesk: { regions: ['global'], markets: ['crypto'] },
  cointelegraph: { regions: ['global'], markets: ['crypto'] },
  theblock: { regions: ['global'], markets: ['crypto'] },
  bitcoinmagazine: { regions: ['global'], markets: ['crypto'] },
  decrypt: { regions: ['global'], markets: ['crypto'] },
  cls: { regions: ['cn'], markets: ['markets', 'macro'] },
  gelonghui: { regions: ['cn', 'hk'], markets: ['markets'] },
  jin10: { regions: ['global'], markets: ['macro', 'fx', 'commodities'] },
  wallstreetcn: { regions: ['global'], markets: ['markets', 'macro', 'fx', 'commodities'] },
  'wallstreetcn-a': { regions: ['cn'], markets: ['markets'] },
  'wallstreetcn-hk': { regions: ['hk'], markets: ['markets'] },
  'wallstreetcn-us': { regions: ['us'], markets: ['markets'] },
  'wallstreetcn-fx': { regions: ['global'], markets: ['fx', 'macro'] },
  'wallstreetcn-commodities': { regions: ['global'], markets: ['commodities'] },
  jrj: { regions: ['cn'], markets: ['markets', 'macro'] },
  'jrj-a': { regions: ['cn'], markets: ['markets'] },
  'jrj-hk': { regions: ['hk'], markets: ['markets'] },
  'jrj-us': { regions: ['us'], markets: ['markets'] },
  'jrj-funds': { regions: ['cn'], markets: ['funds'] },
  'jrj-bonds': { regions: ['cn'], markets: ['bonds'] },
}

export function getNewsFeedPresets() {
  return [...newsCollectorSchema.parse({}).feeds, ...RSSHUB_NEWS_PRESETS].map(feed => ({
    ...feed,
    regions: SOURCE_COVERAGE[feed.source]?.regions ?? [],
    markets: SOURCE_COVERAGE[feed.source]?.markets ?? [],
  }))
}
