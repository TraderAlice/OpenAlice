import type { BrokerHealthInfo } from '../api/types'
import { accountHealthLive } from '../live/account-health'

/**
 * Returns the live broker-health map (accountId → BrokerHealthInfo).
 *
 * Backed by the shared `accountHealthLive` LiveStore — every component
 * that calls this hook reads from the same in-memory state and shares
 * one SSE connection to `/api/events/stream`. Connection opens on first
 * subscriber, closes on last unmount.
 */
export function useAccountHealth(): Record<string, BrokerHealthInfo> {
  return accountHealthLive.useStore((s) => s)
}
