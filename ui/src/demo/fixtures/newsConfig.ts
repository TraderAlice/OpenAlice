import type { NewsCollectorConfig } from '../../api/types'

export function createDemoNewsConfig(): NewsCollectorConfig {
  return {
    enabled: true,
    intervalMinutes: 10,
    maxInMemory: 2000,
    retentionDays: 7,
    feeds: [
      {
        name: 'Federal Reserve Press',
        url: 'https://www.federalreserve.gov/feeds/press_all.xml',
        source: 'fed',
        categories: ['macro'],
        description: 'US Federal Reserve press releases and policy statements.',
        enabled: true,
      },
      {
        name: 'CoinDesk',
        url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
        source: 'coindesk',
        categories: ['crypto'],
        description: 'Crypto markets, policy, and industry news.',
        enabled: false,
      },
    ],
  }
}
