// Contract extension (aliceId on IBKR Contract)
import './contract-ext.js'

// UTA
export { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
export type { UnifiedTradingAccountOptions, StagePlaceOrderParams, StageModifyOrderParams, StageClosePositionParams } from './UnifiedTradingAccount.js'

// UTAManager
export { UTAManager } from './uta-manager.js'
export type {
  UTASummary,
  AggregatedEquity,
  ContractSearchResult,
  SnapshotHooks,
} from './uta-manager.js'

// Brokers (types + async factory). Live implementations are optional packs and
// must never be re-exported from the UTA composition root: a static re-export
// would eagerly evaluate every vendor SDK at process startup.
export type {
  IBroker,
  Position,
  PlaceOrderResult,
  OpenOrder,
  AccountInfo,
  Quote,
  MarketClock,
  TradingCalendar,
  TradingCalendarDay,
  AccountCapabilities,
  TpSlParams,
} from './brokers/index.js'
export {
  createBroker,
} from './brokers/index.js'

// Trading-as-Git
export { TradingGit } from './git/index.js'
export type {
  ITradingGit,
  TradingGitConfig,
  CommitHash,
  Operation,
  OperationAction,
  OperationResult,
  OperationStatus,
  AddResult,
  CommitPrepareResult,
  PushResult,
  GitStatus,
  GitCommit,
  GitState,
  CommitLogEntry,
  GitExportState,
  OperationSummary,
  OrderStatusUpdate,
  SyncResult,
  PriceChangeInput,
  SimulatePriceChangeResult,
} from './git/index.js'

// Snapshots
export {
  createSnapshotService,
  createSnapshotScheduler,
  createSnapshotStore,
  buildSnapshot,
} from './snapshot/index.js'
export type {
  SnapshotService,
  SnapshotScheduler,
  SnapshotStore,
  UTASnapshot,
  SnapshotTrigger,
  SnapshotIndex,
} from './snapshot/index.js'

// Guards
export {
  createGuardPipeline,
  registerGuard,
  resolveGuards,
  MaxPositionSizeGuard,
  CooldownGuard,
  SymbolWhitelistGuard,
} from './guards/index.js'
export type {
  GuardContext,
  OperationGuard,
  GuardRegistryEntry,
} from './guards/index.js'
