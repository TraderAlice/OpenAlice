// Types
export type {
  IBroker,
  Position,
  PlaceOrderResult,
  OpenOrder,
  AccountInfo,
  Quote,
  MarketClock,
  AccountCapabilities,
  BrokerConfigField,
  TpSlParams,
} from './types.js'

// Factory
export { createBroker } from './factory.js'

// Presets (the user-facing surface — many presets, few engines) — re-export
// from the shared `@traderalice/uta-protocol` package so existing consumers
// importing `from '@/domain/trading/brokers/index.js'` keep working.
export {
  BROKER_PRESET_CATALOG,
  getBrokerPreset,
  isPaperPreset,
  BUILTIN_BROKER_PRESETS,
} from '@traderalice/uta-protocol'
export type {
  BrokerPresetDef,
  BrokerEngine,
  ModeOption,
  SubtitleSegment,
  SerializedBrokerPreset,
} from '@traderalice/uta-protocol'

// Alpaca
export { AlpacaBroker } from './alpaca/index.js'
export type { AlpacaBrokerConfig } from './alpaca/index.js'

// CCXT
export { CcxtBroker } from './ccxt/index.js'
export { createCcxtProviderTools } from './ccxt/index.js'
export type { CcxtBrokerConfig } from './ccxt/index.js'

// IBKR
export { IbkrBroker } from './ibkr/index.js'
export type { IbkrBrokerConfig } from './ibkr/index.js'

// Schwab
export { SchwabBroker } from './schwab/index.js'
export type { SchwabBrokerConfig } from './schwab/index.js'
