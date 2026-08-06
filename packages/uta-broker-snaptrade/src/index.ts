import { SnapTradeBroker } from '../../../services/uta/src/domain/trading/brokers/snaptrade/SnapTradeBroker.js'
export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'snaptrade'
export const configSchema = SnapTradeBroker.configSchema
export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(SnapTradeBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
