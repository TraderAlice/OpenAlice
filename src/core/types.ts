import type { ICryptoTradingEngine } from '../extension/crypto-trading/index.js'
import type { CronEngine } from '../task/cron/engine.js'
import type { Heartbeat } from '../task/heartbeat/index.js'
import type { Config } from './config.js'
import type { Engine } from './engine.js'
import type { EventLog } from './event-log.js'

export type { Config }

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
  cryptoEngine: ICryptoTradingEngine | null
  engine: Engine
  eventLog: EventLog
  heartbeat: Heartbeat
  cronEngine: CronEngine
  reconnectCrypto?: () => Promise<ReconnectResult>
  reconnectSecurities?: () => Promise<ReconnectResult>
}

/** A media attachment collected from tool results (e.g. browser screenshots). */
export interface MediaAttachment {
  type: 'image'
  /** Absolute path to the file on disk. */
  path: string
}
