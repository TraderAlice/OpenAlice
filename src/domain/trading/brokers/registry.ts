/**
 * Broker Registry — maps type strings to broker classes.
 *
 * Each broker self-registers via static configSchema + configFields + fromConfig.
 * Adding a new broker: import it here and add one entry to the registry.
 */

import type { z } from 'zod'
import type { IBroker, BrokerConfigField } from './types.js'
import type { AccountConfig } from '../../../core/config.js'
import { CcxtBroker } from './ccxt/CcxtBroker.js'
import { AlpacaBroker } from './alpaca/AlpacaBroker.js'
import { IbkrBroker } from './ibkr/IbkrBroker.js'

// ==================== Subtitle field descriptor ====================

export interface SubtitleField {
  field: string
  /** Text to show when boolean field is true */
  label?: string
  /** Text to show when boolean field is false (omitted = don't show) */
  falseLabel?: string
  /** Prefix before the value (e.g. "TWS ") */
  prefix?: string
}

// ==================== Registry entry ====================

export interface BrokerRegistryEntry {
  /** Zod schema for validating brokerConfig fields */
  configSchema: z.ZodType
  /** UI field descriptors for dynamic form rendering */
  configFields: BrokerConfigField[]
  /** Construct a broker instance from AccountConfig */
  fromConfig: (config: AccountConfig) => IBroker
  /** Display name */
  name: string
  /** Short description */
  description: string
  /** Badge text (2-3 chars) */
  badge: string
  /** Tailwind badge color class */
  badgeColor: string
  /** Fields to show in account card subtitle */
  subtitleFields: SubtitleField[]
  /** Guard category — determines which guard types are available */
  guardCategory: 'crypto' | 'securities'
}

// ==================== Registry ====================

export const BROKER_REGISTRY: Record<string, BrokerRegistryEntry> = {
  ccxt: {
    configSchema: CcxtBroker.configSchema,
    configFields: CcxtBroker.configFields,
    fromConfig: CcxtBroker.fromConfig,
    name: 'CCXT (Crypto)',
    description: 'Unified API for 100+ crypto exchanges. Supports Binance, Bybit, OKX, Coinbase, and more.',
    badge: 'CC',
    badgeColor: 'text-accent',
    subtitleFields: [
      { field: 'exchange' },
      { field: 'demoTrading', label: 'Demo' },
      { field: 'sandbox', label: 'Sandbox' },
    ],
    guardCategory: 'crypto',
  },
  alpaca: {
    configSchema: AlpacaBroker.configSchema,
    configFields: AlpacaBroker.configFields,
    fromConfig: AlpacaBroker.fromConfig,
    name: 'Alpaca (Securities)',
    description: 'Commission-free US equities and ETFs with fractional share support.',
    badge: 'AL',
    badgeColor: 'text-green',
    subtitleFields: [
      { field: 'paper', label: 'Paper Trading', falseLabel: 'Live Trading' },
    ],
    guardCategory: 'securities',
  },
  ibkr: {
    configSchema: IbkrBroker.configSchema,
    configFields: IbkrBroker.configFields,
    fromConfig: IbkrBroker.fromConfig,
    name: 'IBKR (Interactive Brokers)',
    description: 'Professional-grade trading via TWS or IB Gateway. Stocks, options, futures, bonds.',
    badge: 'IB',
    badgeColor: 'text-orange-400',
    subtitleFields: [
      { field: 'host', prefix: 'TWS ' },
      { field: 'port' },
    ],
    guardCategory: 'securities',
  },
}
