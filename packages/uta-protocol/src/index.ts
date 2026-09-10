/**
 * UTA-Alice wire protocol.
 *
 * Contract package shared by:
 *   - Alice main process (consumed as client SDK + types)
 *   - UTA service (consumed as runtime schema validators + handler types)
 *
 * The protocol is treated as a long-term public API — even though UTA today
 * lives in this same monorepo, future deployments may run UTA on a separate
 * carrier (mobile / home server). At that point this package becomes the
 * stable contract between the two halves, so any breaking change here needs
 * coordinated migration on both sides.
 */

export * from './types/index.js'
export * from './schemas/index.js'
export * from './client/UTAClient.js'
export * from './brokers/preset-catalog.js'
export * from './brokers/presets.js'
export * from './brokers/search-rules.js'

export * from './broker-research.js'
