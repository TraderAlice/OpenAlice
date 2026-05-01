/**
 * Internal Broker Engine Registry — maps engine names to implementation classes.
 *
 * NOT exposed to the frontend. The user-facing surface is BROKER_PRESET_CATALOG
 * (preset-catalog.ts), which decides *which* engine to use and translates
 * preset form data into the engine's internal config dict.
 *
 * This keeps the option open to swap CcxtBroker for native exchange clients
 * later without touching the preset surface or any UI.
 */

import type { z } from 'zod'
import type { IBroker } from './types.js'
import { CcxtBroker } from './ccxt/CcxtBroker.js'
import { AlpacaBroker } from './alpaca/AlpacaBroker.js'
import { IbkrBroker } from './ibkr/IbkrBroker.js'
import type { BrokerEngine } from './preset-catalog.js'

/** Minimal engine entry: just enough to validate + instantiate. */
export interface BrokerEngineEntry {
  /** Zod schema for the engine-shaped config dict (post preset translation). */
  configSchema: z.ZodType
  /** Construct a broker instance from { id, label, brokerConfig }. */
  fromConfig: (config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) => IBroker
}

export const BROKER_ENGINE_REGISTRY: Record<BrokerEngine, BrokerEngineEntry> = {
  ccxt: {
    configSchema: CcxtBroker.configSchema,
    fromConfig: CcxtBroker.fromConfig,
  },
  alpaca: {
    configSchema: AlpacaBroker.configSchema,
    fromConfig: AlpacaBroker.fromConfig,
  },
  ibkr: {
    configSchema: IbkrBroker.configSchema,
    fromConfig: IbkrBroker.fromConfig,
  },
}
