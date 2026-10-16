import { CtraderBroker } from '../../../services/uta/src/domain/trading/brokers/ctrader/CtraderBroker.js'

export const BROKER_PACK_API_VERSION = 1
export const BROKER_ENGINE = 'ctrader'
export const configSchema = CtraderBroker.configSchema

export function createBroker(config: { id: string; label?: string; brokerConfig: Record<string, unknown> }) {
  return Object.assign(CtraderBroker.fromConfig(config), { brokerEngine: BROKER_ENGINE })
}
