/**
 * Broker Factory — creates broker instances from account config.
 *
 * Delegates to the broker registry. Each broker class owns its own
 * configSchema + fromConfig — no manual field mapping here.
 */

import type { IBroker } from './types.js'
import { BROKER_REGISTRY } from './registry.js'
import type { AccountConfig } from '../../../core/config.js'

/** Create an IBroker from account config. */
export function createBroker(config: AccountConfig): IBroker {
  const entry = BROKER_REGISTRY[config.type]
  if (!entry) {
    throw new Error(`Unknown broker type: "${config.type}". Registered types: ${Object.keys(BROKER_REGISTRY).join(', ')}`)
  }
  return entry.fromConfig(config)
}
