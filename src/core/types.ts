import type { QueryExecutor } from '@traderalice/opentypebb'
import type { AccountManager } from '../domain/trading/index.js'
import type { FxService } from '../domain/trading/fx-service.js'
import type { SnapshotService } from '../domain/trading/snapshot/index.js'
import type { INewsProvider } from '../domain/news/types.js'
import type { CronEngine } from '../task/cron/engine.js'
import type { Heartbeat } from '../task/heartbeat/index.js'
import type { Config, WebChannel } from './config.js'
import type { ConnectorCenter } from './connector-center.js'
import type { AgentCenter } from './agent-center.js'
import type { EventLog } from './event-log.js'
import type { ToolCallLog } from './tool-call-log.js'
import type { ToolCenter } from './tool-center.js'
import type { ListenerRegistry } from './listener-registry.js'

export type { Config, WebChannel }

export interface Plugin {
  name: string
  start(ctx: EngineContext): Promise<void>
  stop(): Promise<void>
}

export interface ReconnectResult {
  success: boolean
  error?: string
  message?: string
}

export interface EngineContext {
  config: Config
  connectorCenter: ConnectorCenter
  agentCenter: AgentCenter
  eventLog: EventLog
  toolCallLog: ToolCallLog
  heartbeat: Heartbeat
  cronEngine: CronEngine
  toolCenter: ToolCenter
  listenerRegistry: ListenerRegistry

  // Market data
  bbEngine: QueryExecutor

  // Trading (unified account model)
  accountManager: AccountManager
  fxService: FxService
  snapshotService?: SnapshotService
  newsProvider?: INewsProvider
  /** Reconnect connector plugins (Telegram, MCP-Ask, etc.). */
  reconnectConnectors: () => Promise<ReconnectResult>
}

/** A media attachment collected from tool results (e.g. browser screenshots). */
export interface MediaAttachment {
  type: 'image'
  /** Absolute path to the file on disk. */
  path: string
}
