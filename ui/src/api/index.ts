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
import { newsApi } from './news'
import { marketApi } from './market'
import { inboxApi } from './inbox'
import { entitiesApi } from './entities'
import { versionApi } from './version'
import { headlessApi } from './headless'
import { preferencesApi } from './preferences'
import { inquiriesApi } from './inquiries'
import { connectorsApi } from './connectors'
import { agentConversationsApi } from './agentConversations'
import { agentRuntimeLogApi } from './agentRuntimeLog'
import { officeApi } from './office'
import { aliceProjectApi } from './aliceProject'
import { uiLayoutApi } from './ui-layout'
export const api = {
  config: configApi,
  schedule: scheduleApi,
  issues: issuesApi,
  trading: tradingApi,
  marketData: marketDataApi,
  tools: toolsApi,
  agentStatus: agentStatusApi,
  news: newsApi,
  market: marketApi,
  inbox: inboxApi,
  entities: entitiesApi,
  version: versionApi,
  headless: headlessApi,
  preferences: preferencesApi,
  inquiries: inquiriesApi,
  connectors: connectorsApi,
  agentConversations: agentConversationsApi,
  agentRuntime: agentRuntimeLogApi,
  office: officeApi,
  aliceProject: aliceProjectApi,
  uiLayout: uiLayoutApi,
}

export type { AliceProject } from './aliceProject'

// Re-export all types for convenience
export type {
  WebChannel,
  Profile,
  AIBackend,
  Preset,
  PresetModel,
  ModelSemantics,
  ModelReasoningMode,
  ModelReasoningEffort,
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
  ConnectorAdapterMutation,
  ConnectorAdapterMutationResult,
  PublicConnectorConfig,
  ConnectorHealth,
  ConnectorSettingsSnapshot,
  ConnectorDesk,
  ConnectorDeskSnapshot,
  TelegramConnectorDesk,
  TelegramConnectorDeskSnapshot,
} from './connectors'
export type { ToolCallQueryResult } from './agentStatus'
export type {
  AgentConversationQueryResult,
  AgentConversationRecord,
  AgentConversationSource,
  AgentConversationTarget,
} from './agentConversations'
