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
import { openbbApi } from './openbb'
import { apiKeysApi } from './api-keys'

export const api = {
  chat: chatApi,
  config: configApi,
  events: eventsApi,
  cron: cronApi,
  heartbeat: heartbeatApi,
  trading: tradingApi,
  openbb: openbbApi,
  apiKeys: apiKeysApi,
}

// Re-export all types for convenience
export type {
  ChatMessage,
  ChatResponse,
  ToolCall,
  ChatHistoryItem,
  AppConfig,
  EventLogEntry,
  CronSchedule,
  CronJobState,
  CronJob,
  CryptoAccount,
  CryptoPosition,
  SecAccount,
  SecHolding,
  WalletCommitLog,
  ReconnectResult,
  ConnectorsConfig,
  NewsCollectorConfig,
  NewsCollectorFeed,
} from './types'
