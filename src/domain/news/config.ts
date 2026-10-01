/**
 * News Collector — Zod configuration schema
 *
 * Loaded from data/config/news.json (optional; defaults used if absent).
 */

import { z } from 'zod'

const feedSchema = z.object({
  name: z.string(),
  url: z.string().url(),
  source: z.string(),
  categories: z.array(z.string()).optional(),
  description: z.string().optional(),
  enabled: z.boolean().default(true),
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
  /**
   * RSS / Atom feed list.
   *
   * Ships with a curated menu of ~28 reachable feeds. A sensible subset is
   * enabled by default; the rest are listed as a discovery menu so users can
   * toggle them on without having to find URLs themselves.
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
      description:
        'Retail-oriented US stock movers and earnings. Often blocked from mainland China (403). Prefer Gateway US Markets on an offshore VPS — see satellites/market-data-gateway/README.md. Keep disabled on CN hosts.',
      enabled: false,
    },
    {
      name: 'Gateway US Markets',
      // Point at your offshore Market Data Gateway RSS re-export.
      // Append ?token=… when GATEWAY_TOKEN is set (Alice RSS has no auth headers).
      url: 'http://127.0.0.1:8787/feeds/us-markets.xml',
      source: 'gateway-us',
      categories: ['markets', 'us'],
      description:
        'Normalized US headlines from satellites/market-data-gateway (Yahoo collected offshore). Replace host/token for your VPS; do not use a raw Yahoo proxy URL.',
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
  ]),
})

export type NewsCollectorConfig = z.infer<typeof newsCollectorSchema>
