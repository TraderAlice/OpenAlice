/**
 * E2E test setup — shared, lazily-initialized broker instances.
 *
 * Uses the same code path as main.ts: readAccountsConfig → createBroker.
 * Only selects accounts in paper/sandbox/demo environments (isPaper check).
 *
 * Singleton: first call loads config + inits all brokers. Subsequent calls
 * return the same instances. Requires fileParallelism: false in vitest config.
 */

import net from 'node:net'
import { readAccountsConfig, type AccountConfig } from '@/core/config.js'
import type { IBroker } from '../../brokers/types.js'
import { createBroker } from '../../brokers/factory.js'

export interface TestAccount {
  id: string
  label: string
  provider: AccountConfig['type']
  broker: IBroker
}

// ==================== Safety ====================

/** Unified paper/sandbox check — E2E only runs non-live accounts. */
function isPaper(acct: AccountConfig): boolean {
  const bc = acct.brokerConfig
  switch (acct.type) {
    case 'alpaca': return !!bc.paper
    case 'ccxt':   return !!(bc.sandbox || bc.demoTrading)
    case 'ibkr':   return !!bc.paper
    default:       return false
  }
}

/** Check whether API credentials are configured (not applicable for all broker types). */
function hasCredentials(acct: AccountConfig): boolean {
  const bc = acct.brokerConfig
  switch (acct.type) {
    case 'alpaca':
    case 'ccxt':   return !!bc.apiKey
    case 'ibkr':   return true  // no API key — auth via TWS/Gateway login
    default:       return true
  }
}

/** TCP reachability check (for brokers that connect to a local process). */
function isTcpReachable(host: string, port: number, timeoutMs = 2000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const timer = setTimeout(() => { socket.destroy(); resolve(false) }, timeoutMs)
    socket.connect(port, host, () => { clearTimeout(timer); socket.destroy(); resolve(true) })
    socket.on('error', () => { clearTimeout(timer); resolve(false) })
  })
}

// ==================== Lazy singleton ====================

let cached: Promise<TestAccount[]> | null = null

/**
 * Get initialized test accounts. First call loads config + inits brokers.
 * Subsequent calls return the same instances (module-level cache).
 */
export function getTestAccounts(): Promise<TestAccount[]> {
  if (!cached) cached = initAll()
  return cached
}

async function initAll(): Promise<TestAccount[]> {
  const accounts = await readAccountsConfig()
  const result: TestAccount[] = []

  for (const acct of accounts) {
    if (!isPaper(acct)) continue
    if (!hasCredentials(acct)) continue

    // Skip disabled accounts
    if (acct.enabled === false) continue

    // IBKR: check TWS/Gateway reachability before attempting connect
    if (acct.type === 'ibkr') {
      const bc = acct.brokerConfig
      const reachable = await isTcpReachable(String(bc.host ?? '127.0.0.1'), Number(bc.port ?? 7497))
      if (!reachable) {
        console.warn(`e2e setup: ${acct.id} — TWS not reachable at ${bc.host ?? '127.0.0.1'}:${bc.port ?? 7497}, skipping`)
        continue
      }
    }

    const broker = createBroker(acct)

    try {
      await broker.init()
    } catch (err) {
      console.warn(`e2e setup: ${acct.id} init failed, skipping:`, err)
      continue
    }

    result.push({
      id: acct.id,
      label: acct.label ?? acct.id,
      provider: acct.type,
      broker,
    })
  }

  return result
}

/** Filter test accounts by provider type. */
export function filterByProvider(accounts: TestAccount[], provider: AccountConfig['type']): TestAccount[] {
  return accounts.filter(a => a.provider === provider)
}
