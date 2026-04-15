/**
 * Unified API client — re-exports domain modules as the `api` namespace.
 * Existing imports like `import { api } from '../api'` continue to work.
 */
import { chatApi } from './chat'
import { configApi } from './config'
import { eventsApi } from './events'
import { cronApi } from './cron'
import { heartbeatApi } from './heartbeat'
import { tradingApi } from './trading'
import { marketDataApi } from './openbb'
import { devApi } from './dev'
import { toolsApi } from './tools'
import { channelsApi } from './channels'
import { agentStatusApi } from './agentStatus'
import { personaApi } from './persona'
import { newsApi } from './news'
export const api = {
  chat: chatApi,
  config: configApi,
  events: eventsApi,
  cron: cronApi,
  heartbeat: heartbeatApi,
  trading: tradingApi,
  marketData: marketDataApi,
  dev: devApi,
  tools: toolsApi,
  channels: channelsApi,
  agentStatus: agentStatusApi,
  persona: personaApi,
  news: newsApi,
}

// Re-export all types for convenience
export type {
  WebChannel,
  Profile,
  AIBackend,
  Preset,
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
  CronSchedule,
  CronJobState,
  CronJob,
  TradingAccount,
  AccountInfo,
  Position,
  WalletCommitLog,
  ReconnectResult,
  ConnectorsConfig,
  NewsCollectorConfig,
  NewsCollectorFeed,
  ToolCallRecord,
  UTASnapshotSummary,
  EquityCurvePoint,
  NewsArticle,
  NewsListResponse,
} from './types'
export type { EventQueryResult } from './events'
export type { ToolCallQueryResult } from './agentStatus'
