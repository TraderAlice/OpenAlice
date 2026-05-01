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

// Presets (the user-facing surface — many presets, few engines)
export { BROKER_PRESET_CATALOG, getBrokerPreset, isPaperPreset } from './preset-catalog.js'
export type { BrokerPresetDef, BrokerEngine, ModeOption, SubtitleSegment } from './preset-catalog.js'
export { BUILTIN_BROKER_PRESETS } from './presets.js'
export type { SerializedBrokerPreset } from './presets.js'

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
