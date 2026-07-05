/**
 * Unified API client — re-exports domain modules as the `api` namespace.
 * Existing imports like `import { api } from '../api'` continue to work.
 */
import { configApi } from './config'
import { eventsApi } from './events'
import { scheduleApi } from './schedule'
import { issuesApi } from './issues'
import { tradingApi } from './trading'
import { marketDataApi } from './openbb'
import { toolsApi } from './tools'
import { agentStatusApi } from './agentStatus'
import { personaApi } from './persona'
import { newsApi } from './news'
import { topologyApi } from './topology'
import { marketApi } from './market'
import { inboxApi } from './inbox'
import { entitiesApi } from './entities'
import { versionApi } from './version'
import { headlessApi } from './headless'
export const api = {
  config: configApi,
  events: eventsApi,
  schedule: scheduleApi,
  issues: issuesApi,
  trading: tradingApi,
  marketData: marketDataApi,
  tools: toolsApi,
  agentStatus: agentStatusApi,
  persona: personaApi,
  news: newsApi,
  topology: topologyApi,
  market: marketApi,
  inbox: inboxApi,
  entities: entitiesApi,
  version: versionApi,
  headless: headlessApi,
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
  EventLogEntry,
  TradingAccount,
  AccountInfo,
  Position,
  WalletCommitLog,
  ReconnectResult,
  ConnectorsConfig,
  McpConfig,
  NewsCollectorConfig,
  NewsCollectorFeed,
  ToolCallRecord,
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
  TopologyResponse,
  TopologyListener,
  TopologyProducer,
} from './types'
export type { EventQueryResult } from './events'
export type { ToolCallQueryResult } from './agentStatus'
