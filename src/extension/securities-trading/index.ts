// Extension adapter
export { createSecuritiesTradingTools } from './adapter';

// Trading domain types
export type {
  ISecuritiesTradingEngine,
  SecOrderRequest,
  SecOrderResult,
  SecOrder,
  SecHolding,
  SecAccountInfo,
  MarketClock,
} from './interfaces';
export { SEC_ALLOWED_SYMBOLS, initSecAllowedSymbols } from './interfaces';

// Wallet domain
export { SecWallet } from './wallet/SecWallet';
export type { ISecWallet, SecWalletConfig } from './wallet/interfaces';
export type {
  Operation as SecOperation,
  WalletCommit as SecWalletCommit,
  WalletExportState as SecWalletExportState,
  CommitHash as SecCommitHash,
  OrderStatusUpdate as SecOrderStatusUpdate,
  SyncResult as SecSyncResult,
} from './wallet/types';

// Provider infrastructure
export { createSecuritiesTradingEngine } from './factory';
export type { SecuritiesTradingEngineResult } from './factory';
export { createSecOperationDispatcher } from './operation-dispatcher';
export { createSecWalletStateBridge } from './wallet-state-bridge';

// Guard pipeline
export type { SecOperationGuard, SecGuardContext } from './guards/index';
export { createSecGuardPipeline, resolveSecGuards, registerSecGuard } from './guards/index';
