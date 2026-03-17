// Types
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
} from './types.js'

// Factory
export type { IPlatform, PlatformCredentials } from './factory.js'
export { createPlatformFromConfig, createBrokerFromConfig, validatePlatformRefs } from './factory.js'

// Alpaca
export { AlpacaBroker } from './alpaca/index.js'
export type { AlpacaBrokerConfig } from './alpaca/index.js'
export { AlpacaPlatform } from './alpaca/AlpacaPlatform.js'
export type { AlpacaPlatformConfig } from './alpaca/AlpacaPlatform.js'

// CCXT
export { CcxtBroker } from './ccxt/index.js'
export { createCcxtProviderTools } from './ccxt/index.js'
export type { CcxtBrokerConfig } from './ccxt/index.js'
export { CcxtPlatform } from './ccxt/CcxtPlatform.js'
export type { CcxtPlatformConfig } from './ccxt/CcxtPlatform.js'
