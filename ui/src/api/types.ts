// ==================== Chat ====================

export interface ChatMessage {
  role: 'user' | 'assistant' | 'notification'
  text: string
  timestamp?: string | null
}

export interface ChatResponse {
  text: string
  media: Array<{ type: 'image'; url: string }>
}

export interface ToolCall {
  name: string
  input: string
  result?: string
}

export type ChatHistoryItem =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; timestamp?: string }
  | { kind: 'tool_calls'; calls: ToolCall[]; timestamp?: string }

// ==================== Config ====================

export interface AIProviderConfig {
  backend: string
  provider: string
  model: string
  baseUrl?: string
  apiKeys: { anthropic?: string; openai?: string; google?: string }
}

export interface AppConfig {
  aiProvider: AIProviderConfig
  engine: Record<string, unknown>
  agent: { evolutionMode: boolean; claudeCode: Record<string, unknown> }
  compaction: { maxContextTokens: number; maxOutputTokens: number }
  heartbeat: { enabled: boolean; every: string; prompt: string }
  connectors: ConnectorsConfig
  [key: string]: unknown
}

export interface ConnectorsConfig {
  web: { port: number }
  mcp: { port: number }
  mcpAsk: { enabled: boolean; port?: number }
  telegram: {
    enabled: boolean
    botToken?: string
    botUsername?: string
    chatIds: number[]
  }
}

// ==================== News Collector ====================

export interface NewsCollectorFeed {
  name: string
  url: string
  source: string
  categories?: string[]
}

export interface NewsCollectorConfig {
  enabled: boolean
  intervalMinutes: number
  maxInMemory: number
  retentionDays: number
  piggybackOpenBB: boolean
  feeds: NewsCollectorFeed[]
}

// ==================== Events ====================

export interface EventLogEntry {
  seq: number
  ts: number
  type: string
  payload: unknown
}

// ==================== Cron ====================

export type CronSchedule =
  | { kind: 'at'; at: string }
  | { kind: 'every'; every: string }
  | { kind: 'cron'; cron: string }

export interface CronJobState {
  nextRunAtMs: number | null
  lastRunAtMs: number | null
  lastStatus: 'ok' | 'error' | null
  consecutiveErrors: number
}

export interface CronJob {
  id: string
  name: string
  enabled: boolean
  schedule: CronSchedule
  payload: string
  state: CronJobState
  createdAt: number
}

// ==================== Trading ====================

export interface CryptoAccount {
  balance: number
  totalMargin: number
  unrealizedPnL: number
  equity: number
  realizedPnL: number
  totalPnL: number
}

export interface CryptoPosition {
  symbol: string
  side: 'long' | 'short'
  size: number
  entryPrice: number
  leverage: number
  margin: number
  liquidationPrice?: number
  markPrice: number
  unrealizedPnL: number
  positionValue: number
}

export interface SecAccount {
  cash: number
  portfolioValue: number
  equity: number
  buyingPower: number
  unrealizedPnL: number
  realizedPnL: number
  dayTradeCount: number
}

export interface SecHolding {
  symbol: string
  side: 'long' | 'short'
  qty: number
  avgEntryPrice: number
  currentPrice: number
  marketValue: number
  unrealizedPnL: number
  unrealizedPnLPercent: number
  costBasis: number
}

export interface WalletCommitLog {
  hash: string
  message: string
  operations: Array<{ symbol: string; action: string; change: string; status: string }>
  timestamp: string
  round?: number
}

export interface ReconnectResult {
  success: boolean
  error?: string
  message?: string
}
