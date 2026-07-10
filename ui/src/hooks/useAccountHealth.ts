import type { BrokerHealthInfo } from '../api/types'
import { accountHealthLive } from '../live/account-health'

/**
 * Returns the live broker-health map (accountId → BrokerHealthInfo).
 *
 * Backed by the shared `accountHealthLive` LiveStore — every component reads
 * the same periodically refreshed UTA summary and shares one polling timer.
 */
export function useAccountHealth(): Record<string, BrokerHealthInfo> {
  return accountHealthLive.useStore((s) => s)
}
