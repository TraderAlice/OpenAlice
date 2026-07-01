// ==================== Version / Update awareness ====================

export interface VersionInfo {
  /** App version from package.json. */
  current: string
  /** Latest release tag from GitHub, or null if fetch failed / no releases. */
  latest: string | null
  /** True when latest > current (semver). */
  hasUpdate: boolean
  /** GitHub release page URL — UI links to this for changelog. */
  releaseUrl: string | null
  /** Markdown release body. */
  releaseNotes: string | null
  /** ISO timestamp when the release was published. */
  publishedAt: string | null
  /** Non-null when fetch failed (rate limit, network, etc.). */
  error: string | null
}

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
  /** Pointer into the credentials map. Set eagerly by writeProfile. */
  credentialSlug?: string
}

// ==================== AI Provider Credentials ====================

export type CredentialVendor =
  | 'anthropic' | 'openai' | 'google'
  | 'minimax' | 'glm' | 'kimi' | 'deepseek' | 'longcat'
  | 'custom'

export type CredentialAuthType = 'api-key' | 'subscription'

export interface Credential {
  vendor: CredentialVendor
  authType: CredentialAuthType
  apiKey?: string
  baseUrl?: string
}

// ==================== SDK Adapters ====================

export type SdkAdapterId =
  | 'agent-sdk' | 'codex'
  | 'vercel-anthropic' | 'vercel-openai' | 'vercel-google'

export interface SdkAdapterInfo {
  id: SdkAdapterId
  label: string
  description: string
  presets: Array<{
    presetId: string
    presetLabel: string
    isTestDefault: boolean
  }>
}

// ==================== AI Provider Presets ====================

export type WireShape = 'anthropic' | 'openai-chat' | 'openai-responses'

/** A region + the per-wire-shape endpoints it offers. */
export interface SerializedRegion {
  id: string
  label: string
  wires: Partial<Record<WireShape, string>>
}

export interface Preset {
  id: string
  label: string
  description: string
  category: 'official' | 'third-party' | 'custom'
  hint?: string
  defaultName: string
  schema: JsonSchema
  /** Regions × their per-shape endpoints — the form picks a region; the
   *  credential captures that region's whole wires map (its capabilities). */
  regions?: SerializedRegion[]
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
  agent: { allowAiTrading: boolean; claudeCode: Record<string, unknown> }
  compaction: { maxContextTokens: number; maxOutputTokens: number }
  snapshot: {
    enabled: boolean
    every: string
  }
  mcp: McpConfig
  connectors: ConnectorsConfig
  [key: string]: unknown
}

/**
 * MCP server config — lives at top-level of AppConfig (NOT under
 * connectors:) because the MCP server exports OpenAlice's ToolCenter
 * to external clients, not because it's a chat-input surface.
 * `connectors.mcpAsk` is the chat-shaped MCP-as-input flavour and
 * stays under connectors.
 */
export interface McpConfig {
  port: number
}

export interface ConnectorsConfig {
  web: { port: number }
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

// ==================== Trading ====================

export type BrokerHealth = 'healthy' | 'degraded' | 'offline'

/** Capability ladder: 'down' < 'connected' (transport + public data) <
 *  'readable' (private account read). Mirrors the UTA-protocol type. */
export type UTAReach = 'down' | 'connected' | 'readable'
/** What an account is for: keyless data source / read-only / writable. */
export type UTATier = 'data' | 'account' | 'trading'

export interface BrokerHealthInfo {
  status: BrokerHealth
  reach: UTAReach
  tier: UTATier
  consecutiveFailures: number
  lastError?: string
  lastSuccessAt?: string
  lastFailureAt?: string
  recovering: boolean
  /** True while the account's initial broker connect is still in flight; the UI
   *  renders a "connecting…" state off this (status is optimistically 'healthy'
   *  during the window, so it can't be inferred from status/reach). */
  connecting: boolean
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

/**
 * Mirrors `AccountInfo` in packages/uta-protocol/src/types/broker.ts — keep
 * the two in lockstep. The contract is the IBKR superset: brokers that don't
 * report a field omit it (e.g. Alpaca has no realizedPnL; CCXT venues often
 * have no buyingPower). The UI must omit those rows, never fabricate zeros.
 */
export interface AccountInfo {
  baseCurrency: string
  netLiquidation: string
  totalCashValue: string
  unrealizedPnL: string
  realizedPnL?: string
  buyingPower?: string
  initMarginReq?: string
  maintMarginReq?: string
  dayTradesRemaining?: number
}

/** A sub-account (wallet) within one broker connection. One for ordinary
 *  brokers; >1 for separate-wallet venues (Binance: spot / derivatives). */
export interface SubAccountRef {
  id: string
  label: string
  kind: 'spot' | 'derivatives' | 'unified'
}

export interface Position {
  contract: {
    aliceId?: string
    symbol?: string
    secType?: string
    exchange?: string
    /** Primary listing exchange (e.g. NASDAQ, SEHK) — distinct from the
     *  routing `exchange` (often SMART). Populated for equities; empty for
     *  crypto. */
    primaryExchange?: string
    /** Instrument long-name (e.g. "Apple Inc"). Populated where the broker
     *  exposes it (IBKR, Alpaca catalog); empty otherwise. */
    description?: string
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
  /** Leveraged-derivative risk metadata (crypto perps/futures). Absent for
   *  spot and brokers without per-position leverage. Mirrors uta-protocol's
   *  PositionRisk. */
  risk?: {
    leverage?: string
    liquidationPrice?: string
    marginMode?: 'cross' | 'isolated'
  }
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

// ==================== Order / Trade History ====================
//
// Hand-mirrors packages/uta-protocol/src/types/history.ts — the UI does not
// import uta-protocol, so keep these in lockstep with the wire types.

/** Compact contract identity for history rows — IBKR-superset fields. */
export interface HistoryContract {
  aliceId?: string
  symbol?: string
  localSymbol?: string
  secType?: string
  currency?: string
  exchange?: string
  /** OPT/FOP/FUT: contract month or expiry (IBKR lastTradeDateOrContractMonth). */
  expiry?: string
  /** OPT/FOP: strike price (string — Decimal-safe). */
  strike?: string
  /** OPT/FOP: 'C' | 'P' (normalized). */
  right?: string
  multiplier?: string
}

export type OrderHistoryStatus = 'submitted' | 'filled' | 'cancelled' | 'rejected' | 'user-rejected'

export type OrderHistorySource = 'alice' | 'external'

export interface OrderHistoryEntry {
  /** Broker order id (absent for rejected-before-submit). */
  orderId?: string
  /** When the order entered the log (push/observe time, ISO). */
  timestamp: string
  /** When the terminal transition was recorded, if any (sync/cancel time, ISO). */
  resolvedAt?: string
  contract: HistoryContract
  side: 'BUY' | 'SELL'
  orderType?: string
  quantity?: string
  limitPrice?: string
  stopPrice?: string
  status: OrderHistoryStatus
  filledQty?: string
  avgFillPrice?: string
  /** 'external' = observed on the broker, not placed through Alice. */
  source: OrderHistorySource
  /** Commit that introduced the order — the audit pointer. */
  commitHash: string
  /** Commit message (user intent for Alice orders; [observed] for external). */
  message: string
  error?: string
}

export type TradeHistorySource = 'order' | 'external' | 'reconcile'

export interface TradeHistoryEntry {
  /** Fill record time (ISO) — push time for immediate fills, sync time otherwise. */
  timestamp: string
  orderId?: string
  contract: HistoryContract
  side: 'BUY' | 'SELL'
  quantity: string
  price: string
  /** quantity × price × multiplier (string — Decimal-safe). */
  value: string
  /** 'reconcile' = balance drift folded in at observed price, not a real fill record. */
  source: TradeHistorySource
  commitHash: string
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
  category: 'recommended' | 'crypto' | 'testing'
  hint?: string
  defaultName: string
  badge: string
  badgeColor: string
  engine: 'ccxt' | 'alpaca' | 'ibkr' | 'leverup' | 'longbridge' | 'mock'
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
  /** Target wallet on multi-wallet venues — required when the account spans >1. */
  subAccountId?: string
  message: string
}

export interface ClosePositionRequest {
  aliceId: string
  symbol?: string
  qty?: string
  /** Target wallet on multi-wallet venues — required when the account spans >1. */
  subAccountId?: string
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
