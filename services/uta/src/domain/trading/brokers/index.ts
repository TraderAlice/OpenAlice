// Types
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

// Live broker implementations intentionally are not re-exported here. They
// are built and loaded as optional broker packs by registry.ts.
