/**
 * Unified API client — re-exports domain modules as the `api` namespace.
 * Existing imports like `import { api } from '../api'` continue to work.
 */
import { configApi } from './config'
import { scheduleApi } from './schedule'
import { issuesApi } from './issues'
import { tradingApi } from './trading'
import { marketDataApi } from './openbb'
import { toolsApi } from './tools'
import { agentStatusApi } from './agentStatus'
import { personaApi } from './persona'
import { newsApi } from './news'
import { marketApi } from './market'
import { inboxApi } from './inbox'
import { entitiesApi } from './entities'
import { versionApi } from './version'
import { headlessApi } from './headless'
import { preferencesApi } from './preferences'
import { inquiriesApi } from './inquiries'
import { connectorsApi } from './connectors'
export const api = {
  config: configApi,
  schedule: scheduleApi,
  issues: issuesApi,
  trading: tradingApi,
  marketData: marketDataApi,
  tools: toolsApi,
  agentStatus: agentStatusApi,
  persona: personaApi,
  news: newsApi,
  market: marketApi,
  inbox: inboxApi,
  entities: entitiesApi,
  version: versionApi,
  headless: headlessApi,
  preferences: preferencesApi,
  inquiries: inquiriesApi,
  connectors: connectorsApi,
}

// Re-export all types for convenience
export type {
  WebChannel,
  Profile,
  AIBackend,
  Preset,
  WireShape,
  SerializedRegion,
  JsonSchema,
  JsonSchemaProperty,
  ChatMessage,
  ChatResponse,
  ToolCall,
  StreamingToolCall,
  ChatHistoryItem,
  AppConfig,
  AIProviderConfig,
  TradingAccount,
  AccountInfo,
  Position,
  WalletCommitLog,
  ReconnectResult,
  McpConfig,
  NewsCollectorConfig,
  NewsCollectorFeed,
  ToolCallRecord,
  UTASummary,
  BrokerHealthInfo,
  UTATier,
  UTASnapshotSummary,
  EquityCurvePoint,
  HistoryContract,
  OrderHistoryEntry,
  OrderHistoryStatus,
  OrderHistorySource,
  TradeHistoryEntry,
  TradeHistorySource,
  NewsArticle,
  NewsListResponse,
} from './types'
export type {
  ConnectorDefinition,
  PublicConnectorConfig,
  ConnectorHealth,
  ConnectorSettingsSnapshot,
} from './connectors'
export type { ToolCallQueryResult } from './agentStatus'
