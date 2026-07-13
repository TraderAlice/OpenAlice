import type { QueryExecutor } from '@traderalice/opentypebb'
import type { UTAManagerSDK } from '../services/uta-client/index.js'
import type { INewsProvider } from '../domain/news/types.js'
import type { MarketSearchDeps } from '../domain/market-data/aggregate-search.js'
import type { EquityClientLike } from '../domain/market-data/client/types.js'
import type { BarService } from '../domain/market-data/bars/index.js'
import type { ReferenceDataService } from '../domain/market-data/reference/types.js'
import type { Config, WebChannel } from './config.js'
import type { TradingModePolicy } from '../services/trading-mode.js'
import type { ToolCallLog } from './tool-call-log.js'
import type { ToolCenter } from './tool-center.js'
import type { WorkspaceToolCenter } from './workspace-tool-center.js'
import type { IInboxStore } from './inbox-store.js'
import type { IEntityStore } from './entity-store.js'

export type { Config, WebChannel }

export interface Plugin {
  name: string
  start(ctx: EngineContext): Promise<void>
  stop(): Promise<void>
}

/** Generic result of an out-of-band reconnect attempt. Still used by the
 *  UTA client SDK (`reconnectUTA`); the connector-reconnect path that
 *  used to share it was removed with the legacy connector cluster. */
export interface ReconnectResult {
  success: boolean
  error?: string
  message?: string
}

export interface EngineContext {
  config: Config
  /** Workspace-anchored push surface. Written by workspace agents through
   *  inbox_push and by headless issue runs when they report results. */
  inboxStore: IInboxStore
  /** Durable cross-workspace tracked-index (assets / topics). Written by
   *  workspace agents via the entity_upsert MCP tool; read by the Tracked
   *  tab. Notes point at entities with `[[name]]` links. */
  entityStore: IEntityStore
  toolCallLog: ToolCallLog
  toolCenter: ToolCenter
  workspaceToolCenter: WorkspaceToolCenter

  // Market data
  bbEngine: QueryExecutor
  /** Deps for cross-asset-class heuristic symbol search. Shared between the
   *  AI tool (marketSearchForResearch) and the /api/market/search HTTP route. */
  marketSearch: MarketSearchDeps
  /** Equity market-data client. Shared between the equity/analysis/sector-rotation
   *  AI tools and the /api/market/* HTTP routes (e.g. sector-rotation). */
  equityClient: EquityClientLike
  /** Federated K-line / bar layer — unifies embedded vendors + broker (UTA)
   *  OHLCV behind one barId-keyed interface. Consumed by the analysis tools and
   *  (Phase 3) the /api/bars chart route. */
  barService: BarService
  /** Reference-data contract (low-frequency boards: movers, macro, calendar,
   *  …). OpenAlice's own standard replacing the OpenBB-compatible
   *  passthrough; the future hosted-hub seam. Served at /api/reference. */
  reference: ReferenceDataService

  // Trading — HTTP-backed SDK that talks to the co-located UTA service.
  // FxService and SnapshotService live entirely inside UTA after Step 6;
  // anything Alice used to read off `ctx.fxService` / `ctx.snapshotService`
  // now goes through the SDK (e.g. `await utaManager.getAggregatedEquity()`
  // for FX-converted totals).
  utaManager: UTAManagerSDK
  tradingModePolicy: () => TradingModePolicy
  newsProvider?: INewsProvider
}

/** A media attachment collected from tool results (e.g. browser screenshots). */
export interface MediaAttachment {
  type: 'image'
  /** Absolute path to the file on disk. */
  path: string
}
