import type { ICryptoTradingEngine, Wallet } from '../extension/crypto-trading/index.js'
import type { ISecuritiesTradingEngine, SecWallet } from '../extension/securities-trading/index.js'
import type { GovernanceServiceContract } from '../custom/governance/types.js'
import type { CronEngine } from '../task/cron/engine.js'
import type { Heartbeat } from '../task/heartbeat/index.js'
import type { Config } from './config.js'
import type { ConnectorCenter } from './connector-center.js'
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
  connectorCenter: ConnectorCenter
  cryptoEngine: ICryptoTradingEngine | null
  engine: Engine
  eventLog: EventLog
  heartbeat: Heartbeat
  cronEngine: CronEngine
  reconnectCrypto?: () => Promise<ReconnectResult>
  reconnectSecurities?: () => Promise<ReconnectResult>
  reconnectConnectors?: () => Promise<ReconnectResult>
  /** Current crypto trading engine (updates on reconnect). */
  getCryptoEngine?: () => ICryptoTradingEngine | null
  /** Current securities trading engine (updates on reconnect). */
  getSecuritiesEngine?: () => ISecuritiesTradingEngine | null
  /** Current crypto wallet (updates on reconnect). */
  getCryptoWallet?: () => Wallet | null
  /** Current securities wallet (updates on reconnect). */
  getSecWallet?: () => SecWallet | null
  /** Governance service (decision packet / verification pipeline). */
  governance?: GovernanceServiceContract
}

/** A media attachment collected from tool results (e.g. browser screenshots). */
export interface MediaAttachment {
  type: 'image'
  /** Absolute path to the file on disk. */
  path: string
}
