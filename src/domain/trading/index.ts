// Contract extension (aliceId on IBKR Contract)
import './contract-ext.js'

// UTA
export { UnifiedTradingAccount } from './UnifiedTradingAccount.js'
export type { UnifiedTradingAccountOptions, StagePlaceOrderParams, StageModifyOrderParams, StageClosePositionParams } from './UnifiedTradingAccount.js'

// AccountManager
export { AccountManager } from './account-manager.js'
export type {
  AccountSummary,
  AggregatedEquity,
  ContractSearchResult,
} from './account-manager.js'

// Brokers (types + implementations + factory)
export type {
  IBroker,
  Position,
  PlaceOrderResult,
  OpenOrder,
  AccountInfo,
  Quote,
  FundingRate,
  OrderBookLevel,
  OrderBook,
  MarketClock,
  AccountCapabilities,
} from './brokers/index.js'
export type { IPlatform, PlatformCredentials } from './brokers/index.js'
export {
  createPlatformFromConfig,
  createBrokerFromConfig,
  validatePlatformRefs,
  AlpacaBroker,
  AlpacaPlatform,
  CcxtBroker,
  CcxtPlatform,
  createCcxtProviderTools,
} from './brokers/index.js'
export type { AlpacaBrokerConfig, AlpacaPlatformConfig, CcxtBrokerConfig, CcxtPlatformConfig } from './brokers/index.js'

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
