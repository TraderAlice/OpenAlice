import type { ToolDetail, ToolInfo } from '../../api/tools'

export const demoToolDetails = {
  calculate: {
    name: 'calculate',
    group: 'thinking',
    description:
      'Perform mathematical calculations with precision. Supports basic operators: +, -, *, /, (), and decimals.',
    inputSchema: {
      type: 'object',
      properties: {
        expression: {
          type: 'string',
          description: 'Mathematical expression to evaluate, e.g. "(1000 * 0.1) / 2".',
        },
      },
      required: ['expression'],
      additionalProperties: false,
      examples: [{ expression: '(1000 * 0.1) / 2' }],
    },
  },
  marketSearchForResearch: {
    name: 'marketSearchForResearch',
    group: 'market-search',
    description:
      'Search for symbols across equities, crypto, currencies, and commodities for market-data research.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Keyword to search, e.g. "AAPL", "bitcoin", or "EUR".',
        },
        limit: {
          type: 'integer',
          description: 'Maximum results per asset class (default: 20).',
        },
      },
      required: ['query'],
      additionalProperties: false,
      examples: [{ query: 'apple' }],
    },
  },
  searchBars: {
    name: 'searchBars',
    group: 'quant',
    description:
      'Find broker and vendor K-line sources for a symbol, including the barId used by calculateQuant.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Symbol or keyword, e.g. "AAPL", "BTC", or "bitcoin".',
        },
        limit: {
          type: 'integer',
          description: 'Maximum candidates (default: 20).',
        },
      },
      required: ['query'],
      additionalProperties: false,
      examples: [{ query: 'AAPL' }],
    },
  },
  equityGetProfile: {
    name: 'equityGetProfile',
    group: 'equity',
    description:
      'Get a company profile and key valuation metrics for a stock symbol.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: {
          type: 'string',
          description: 'Ticker symbol, e.g. "AAPL" or "MSFT".',
        },
      },
      required: ['symbol'],
      additionalProperties: false,
      examples: [{ symbol: 'AAPL' }],
    },
  },
} satisfies Record<string, ToolDetail>

export type DemoToolName = keyof typeof demoToolDetails

export const demoToolInventory: ToolInfo[] = Object.values(demoToolDetails).map(
  ({ name, group, description }) => ({ name, group: group ?? 'other', description }),
)

export const demoToolResults: Record<DemoToolName, unknown> = {
  calculate: 50,
  marketSearchForResearch: {
    results: [
      {
        symbol: 'AAPL',
        name: 'Apple Inc.',
        assetClass: 'equity',
        exchange: 'NASDAQ',
      },
    ],
    count: 1,
  },
  searchBars: {
    candidates: [
      {
        barId: 'alpaca-paper|AAPL',
        symbol: 'AAPL',
        source: 'uta',
        provider: 'alpaca-paper',
        barCapability: 'realtime',
      },
      {
        barId: 'yfinance|AAPL',
        symbol: 'AAPL',
        source: 'vendor',
        provider: 'yfinance',
        barCapability: 'delayed',
      },
    ],
    count: 2,
  },
  equityGetProfile: {
    profile: {
      symbol: 'AAPL',
      name: 'Apple Inc.',
      sector: 'Technology',
      industry: 'Consumer Electronics',
      website: 'https://www.apple.com',
    },
    metrics: {
      market_cap: 3_280_000_000_000,
      pe_ratio: 31.4,
      dividend_yield: 0.0044,
    },
  },
}
