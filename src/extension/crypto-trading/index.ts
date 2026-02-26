// Extension adapter
export { createCryptoTradingTools } from './adapter';

// Trading domain types
export type {
  ICryptoTradingEngine,
  CryptoPlaceOrderRequest,
  CryptoOrderResult,
  CryptoOrder,
  CryptoPosition,
  CryptoAccountInfo,
  CryptoAllowedSymbol,
  SymbolPrecision,
} from './interfaces';
export { CRYPTO_ALLOWED_SYMBOLS, initCryptoAllowedSymbols } from './interfaces';

// Wallet domain
export { Wallet } from './wallet/Wallet';
export type { IWallet, WalletConfig } from './wallet/interfaces';
export type {
  Operation,
  WalletCommit,
  WalletExportState,
  CommitHash,
  OrderStatusUpdate,
  SyncResult,
} from './wallet/types';

// Provider infrastructure
export { createCryptoTradingEngine } from './factory';
export type { CryptoTradingEngineResult } from './factory';
export { createCryptoOperationDispatcher } from './operation-dispatcher';
export { createCryptoWalletStateBridge } from './wallet-state-bridge';

// Guard system
export { createGuardPipeline, resolveGuards, registerGuard } from './guards/index';
export type { OperationGuard, GuardContext, GuardRegistryEntry } from './guards/index';
