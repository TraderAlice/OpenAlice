// ==================== Channels ====================

export interface VercelAiSdkOverride {
  provider: string
  model: string
  baseUrl?: string
  apiKey?: string
}

export type LoginMethod = 'api-key' | 'claudeai'

export interface AgentSdkOverride {
  model?: string
  baseUrl?: string
  apiKey?: string
  loginMethod?: LoginMethod
}

export interface WebChannel {
  id: string
  label: string
  systemPrompt?: string
  provider?: 'claude-code' | 'vercel-ai-sdk' | 'agent-sdk'
  vercelAiSdk?: VercelAiSdkOverride
  agentSdk?: AgentSdkOverride
  disabledTools?: string[]
}

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

export interface StreamingToolCall {
  id: string
  name: string
  input: unknown
  status: 'running' | 'done'
  result?: string
}

export type ChatHistoryItem =
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; timestamp?: string; metadata?: Record<string, unknown>; media?: Array<{ type: string; url: string }> }
  | { kind: 'tool_calls'; calls: ToolCall[]; timestamp?: string }

// ==================== Config ====================

export interface AIProviderConfig {
  backend: string
  provider: string
  model: string
  baseUrl?: string
  loginMethod?: LoginMethod
  apiKeys: { anthropic?: string; openai?: string; google?: string }
}

export interface AppConfig {
  aiProvider: AIProviderConfig
  engine: Record<string, unknown>
  agent: { evolutionMode: boolean; claudeCode: Record<string, unknown> }
  compaction: { maxContextTokens: number; maxOutputTokens: number }
  heartbeat: {
    enabled: boolean
    every: string
    prompt: string
    activeHours: { start: string; end: string; timezone: string } | null
  }
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

export type BrokerHealth = 'healthy' | 'degraded' | 'offline'

export interface BrokerHealthInfo {
  status: BrokerHealth
  consecutiveFailures: number
  lastError?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  recovering: boolean
  disabled: boolean
}

export interface AccountSummary {
  id: string
  label: string
  platformId?: string
  capabilities: { supportedSecTypes: string[]; supportedOrderTypes: string[] }
  health: BrokerHealthInfo
}

export interface TradingAccount {
  id: string
  provider: string
  label: string
}

export interface AccountInfo {
  netLiquidation: number
  totalCashValue: number
  unrealizedPnL: number
  realizedPnL: number
  buyingPower?: number
  initMarginReq?: number
  maintMarginReq?: number
}

export interface Position {
  contract: {
    aliceId?: string
    symbol?: string
    secType?: string
    exchange?: string
    currency?: string
    lastTradeDateOrContractMonth?: string
    strike?: number
    right?: string
    multiplier?: number
    localSymbol?: string
  }
  side: 'long' | 'short'
  quantity: string // Decimal serialized as string
  avgCost: number
  marketPrice: number
  marketValue: number
  unrealizedPnL: number
  realizedPnL: number
  leverage?: number
  margin?: number
  liquidationPrice?: number
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

// ==================== Wallet Status / Push ====================

export interface WalletOperation {
  action: 'placeOrder' | 'modifyOrder' | 'closePosition' | 'cancelOrder' | 'syncOrders'
  contract?: { aliceId?: string; symbol?: string; localSymbol?: string }
  order?: { action?: string; orderType?: string; totalQuantity?: number | string; cashQty?: number | string; lmtPrice?: number | string; auxPrice?: number | string }
  orderId?: string
  quantity?: string
  [key: string]: unknown
}

export interface WalletStatus {
  staged: WalletOperation[]
  pendingMessage: string | null
  head: string | null
  commitCount: number
}

export interface WalletRejectResult {
  hash: string
  message: string
  operationCount: number
}

export interface WalletPushResult {
  hash: string
  message: string
  operationCount: number
  submitted: Array<{ action: string; success: boolean; orderId?: string; status: string; error?: string }>
  rejected: Array<{ action: string; success: boolean; error?: string; status: string }>
}

// ==================== Tool Call Log ====================

export interface ToolCallRecord {
  seq: number
  id: string
  sessionId: string
  name: string
  input: unknown
  output: string
  status: 'ok' | 'error'
  durationMs: number
  timestamp: number
}

// ==================== Trading Config ====================

export interface CcxtPlatformConfig {
  id: string
  label?: string
  type: 'ccxt'
  exchange: string
  sandbox: boolean
  demoTrading: boolean
}

export interface AlpacaPlatformConfig {
  id: string
  label?: string
  type: 'alpaca'
  paper: boolean
}

export type PlatformConfig = CcxtPlatformConfig | AlpacaPlatformConfig

export interface AccountConfig {
  id: string
  platformId: string
  label?: string
  apiKey?: string
  apiSecret?: string
  password?: string
  guards: GuardEntry[]
}

export interface GuardEntry {
  type: string
  options: Record<string, unknown>
}

export interface TestConnectionResult {
  success: boolean
  error?: string
  account?: unknown
}
