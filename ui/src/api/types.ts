// ==================== AI Provider Profiles ====================

export type AIBackend = 'agent-sdk' | 'codex' | 'vercel-ai-sdk'

export interface Profile {
  backend: AIBackend
  model: string
  preset?: string     // preset ID this profile was created from
  loginMethod?: string
  provider?: string   // vercel-ai-sdk only
  baseUrl?: string
  apiKey?: string
}

// ==================== AI Provider Presets ====================

export interface Preset {
  id: string
  label: string
  description: string
  category: 'official' | 'third-party' | 'custom'
  hint?: string
  defaultName: string
  schema: JsonSchema
}

/** Subset of JSON Schema types we use for form rendering. */
export interface JsonSchema {
  type?: string
  properties?: Record<string, JsonSchemaProperty>
  required?: string[]
  [key: string]: unknown
}

export interface JsonSchemaProperty {
  type?: string
  const?: unknown
  enum?: string[]
  oneOf?: Array<{ const: string; title: string }>
  default?: unknown
  title?: string
  description?: string
  writeOnly?: boolean
  [key: string]: unknown
}

// ==================== Channels ====================

export interface WebChannel {
  id: string
  label: string
  systemPrompt?: string
  profile?: string    // slug reference to a profile
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
  | { kind: 'text'; role: 'user' | 'assistant'; text: string; timestamp?: string; metadata?: Record<string, unknown>; media?: Array<{ type: string; url: string }>; cursor: string }
  | { kind: 'tool_calls'; calls: ToolCall[]; timestamp?: string; cursor: string }

// ==================== Config ====================

export interface AIProviderConfig {
  apiKeys: { anthropic?: string; openai?: string; google?: string }
  profiles: Record<string, Profile>
  activeProfile: string
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
  snapshot: {
    enabled: boolean
    every: string
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

// ==================== Topology ====================

export interface TopologyEventType {
  name: string
  external: boolean
  description?: string
}

export interface TopologyListener {
  name: string
  subscribes: string[]
  emits: string[]
  /** True if declared as wildcard '*' — UI renders an aura instead of N edges. */
  subscribesWildcard: boolean
  /** Same for emits. */
  emitsWildcard: boolean
}

export interface TopologyProducer {
  name: string
  emits: string[]
  emitsWildcard: boolean
}

export interface TopologyResponse {
  eventTypes: TopologyEventType[]
  producers: TopologyProducer[]
  listeners: TopologyListener[]
}

// ==================== News Collector ====================

export interface NewsCollectorFeed {
  name: string
  url: string
  source: string
  categories?: string[]
  description?: string
  enabled?: boolean
}

export interface NewsCollectorConfig {
  enabled: boolean
  intervalMinutes: number
  maxInMemory: number
  retentionDays: number
  feeds: NewsCollectorFeed[]
}

// ==================== News Articles ====================

export interface NewsArticle {
  time: string
  title: string
  content: string
  source: string | null
  link: string | null
  categories: string | null
}

export interface NewsListResponse {
  items: NewsArticle[]
  count: number
  lookback: string
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

export interface UTASummary {
  id: string
  label: string
  capabilities: { supportedSecTypes: string[]; supportedOrderTypes: string[] }
  health: BrokerHealthInfo
}

export interface TradingAccount {
  id: string
  provider: string
  label: string
}

export interface AccountInfo {
  baseCurrency: string
  netLiquidation: string
  totalCashValue: string
  unrealizedPnL: string
  realizedPnL: string
  buyingPower?: string
  initMarginReq?: string
  maintMarginReq?: string
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
  /** Currency denomination of all monetary fields. */
  currency: string
  side: 'long' | 'short'
  quantity: string // Decimal serialized as string
  /** All monetary fields are strings to prevent IEEE 754 floating-point artifacts. */
  avgCost: string
  marketPrice: string
  marketValue: string
  unrealizedPnL: string
  realizedPnL: string
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

/**
 * One Unified Trading Account configuration record. The user-facing
 * concept that wraps a broker connection — distinct from `AccountInfo`,
 * which is broker-side (cash, equity, margin returned by the broker).
 */
export interface UTAConfig {
  id: string
  label?: string
  /** Broker preset id — resolves to engine + form schema on the backend. */
  presetId: string
  enabled: boolean
  guards: GuardEntry[]
  /** User-filled form values for the preset's schema. */
  presetConfig: Record<string, unknown>
}

// ==================== Broker Preset Metadata (from /broker-presets endpoint) ====================

export interface ModeOption {
  id: string
  label: string
}

export interface SubtitleField {
  field: string
  label?: string
  falseLabel?: string
  prefix?: string
}

export interface BrokerPreset {
  id: string
  label: string
  description: string
  category: 'crypto' | 'securities' | 'custom'
  hint?: string
  defaultName: string
  badge: string
  badgeColor: string
  engine: 'ccxt' | 'alpaca' | 'ibkr'
  guardCategory: 'crypto' | 'securities'
  modes?: ModeOption[]
  subtitleFields: SubtitleField[]
  schema: JsonSchema
}

export interface GuardEntry {
  type: string
  options: Record<string, unknown>
}

export interface TestConnectionResult {
  success: boolean
  error?: string
  account?: AccountInfo
  positions?: Position[]
}

// ==================== Order entry (frontend manual surface) ====================
//
// Numeric fields are strings on the wire — the backend uses
// new Decimal(String(x)) to preserve precision; mirroring the type
// here keeps frontend → backend aligned and avoids float roundtrip.

export interface PlaceOrderRequest {
  aliceId: string
  symbol?: string
  action: 'BUY' | 'SELL'
  orderType: string
  totalQuantity?: string
  cashQty?: string
  lmtPrice?: string
  auxPrice?: string
  trailStopPrice?: string
  trailingPercent?: string
  tif?: string
  goodTillDate?: string
  outsideRth?: boolean
  parentId?: string
  ocaGroup?: string
  takeProfit?: { price: string }
  stopLoss?: { price: string; limitPrice?: string }
  message: string
}

export interface ClosePositionRequest {
  aliceId: string
  symbol?: string
  qty?: string
  message: string
}

export interface CancelOrderRequest {
  orderId: string
  message: string
}

/** Error response shape from one-shot order endpoints (when status !== 200). */
export interface OrderErrorResponse {
  error: string
  /** Which step blew up — useful for surfacing where the failure happened. */
  phase?: 'validate' | 'stage' | 'commit' | 'push'
}

// ==================== Snapshots ====================

export interface UTASnapshotSummary {
  accountId: string
  timestamp: string
  trigger: string
  account: {
    baseCurrency: string
    netLiquidation: string
    totalCashValue: string
    unrealizedPnL: string
    realizedPnL: string
    buyingPower?: string
    initMarginReq?: string
    maintMarginReq?: string
  }
  positions: Array<{
    aliceId: string
    currency: string
    side: 'long' | 'short'
    quantity: string
    avgCost: string
    marketPrice: string
    marketValue: string
    unrealizedPnL: string
    realizedPnL: string
  }>
  openOrders: Array<{
    orderId: string
    aliceId: string
    action: string
    orderType: string
    totalQuantity: string
    status: string
  }>
  health: string
}

export interface EquityCurvePoint {
  timestamp: string
  equity: string
  accounts: Record<string, string>
}
