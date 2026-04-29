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

// Brokers (types + implementations + factory)
export type {
  IBroker,
  Position,
  PlaceOrderResult,
  OpenOrder,
  AccountInfo,
  Quote,
  MarketClock,
  AccountCapabilities,
  TpSlParams,
} from './brokers/index.js'
export {
  createBroker,
  AlpacaBroker,
  CcxtBroker,
  createCcxtProviderTools,
} from './brokers/index.js'
export type { AlpacaBrokerConfig, CcxtBrokerConfig } from './brokers/index.js'

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
