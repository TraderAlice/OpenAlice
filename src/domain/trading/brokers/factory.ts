/**
 * Broker Factory — preset → engine resolver.
 *
 * Looks up the UTAConfig's preset, validates the user-facing form
 * data against the preset's own Zod schema, calls preset.toEngineConfig
 * to translate it into the engine-shaped dict, then delegates to the
 * target engine's fromConfig.
 *
 * UTAConfig.presetId is the only thing tying account records to
 * engine implementations — the engine identity is never serialized
 * directly. Swapping CCXT for a native client later means changing the
 * preset's `engine` field; on-disk account records stay valid.
 */

import type { IBroker } from './types.js'
import { BROKER_ENGINE_REGISTRY } from './registry.js'
import { getBrokerPreset } from './preset-catalog.js'
import type { UTAConfig } from '../../../core/config.js'

/** Create an IBroker from account config via preset resolution. */
export function createBroker(config: UTAConfig): IBroker {
  const preset = getBrokerPreset(config.presetId)
  const presetData = preset.zodSchema.parse(config.presetConfig) as Record<string, unknown>
  const engineConfig = preset.toEngineConfig(presetData)

  const entry = BROKER_ENGINE_REGISTRY[preset.engine]
  if (!entry) {
    throw new Error(`Unknown broker engine "${preset.engine}" referenced by preset "${preset.id}"`)
  }
  return entry.fromConfig({
    id: config.id,
    label: config.label,
    brokerConfig: engineConfig,
  })
}
