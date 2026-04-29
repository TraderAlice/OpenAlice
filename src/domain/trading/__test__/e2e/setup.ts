/**
 * E2E test setup — shared, lazily-initialized broker instances.
 *
 * Uses the same code path as main.ts: readUTAsConfig → createBroker.
 * Only selects accounts in paper/sandbox/demo environments (isPaper check).
 *
 * Singleton: first call loads config + inits all brokers. Subsequent calls
 * return the same instances. Requires fileParallelism: false in vitest config.
 */

import net from 'node:net'
import { readUTAsConfig, type UTAConfig } from '@/core/config.js'
import type { IBroker } from '../../brokers/types.js'
import { createBroker } from '../../brokers/factory.js'
import { getBrokerPreset, isPaperPreset, type BrokerEngine } from '../../brokers/preset-catalog.js'
import { CCXT_CREDENTIAL_FIELDS } from '../../brokers/ccxt/ccxt-types.js'

export interface TestAccount {
  id: string
  label: string
  provider: BrokerEngine
  broker: IBroker
}

// ==================== Safety ====================

/** Unified paper/sandbox check — E2E only runs non-live accounts. Routed through preset.isPaper. */
function isPaper(acct: UTAConfig): boolean {
  return isPaperPreset(acct.presetId, acct.presetConfig)
}

/** Check whether API credentials are configured (not applicable for all broker types). */
function hasCredentials(acct: UTAConfig): boolean {
  const engine = getBrokerPreset(acct.presetId).engine
  const pc = acct.presetConfig as Record<string, unknown>
  switch (engine) {
    case 'alpaca':
      return !!pc.apiKey
    case 'ccxt':
      // Different exchanges use different credential schemes — apiKey/secret for
      // most, walletAddress/privateKey for Hyperliquid. Either side counts.
      return CCXT_CREDENTIAL_FIELDS.some(k => !!pc[k]) || !!pc.walletAddress
    case 'ibkr':
      return true  // no API key — auth via TWS/Gateway login
    default:
      return true
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
  const accounts = await readUTAsConfig()
  const result: TestAccount[] = []

  for (const acct of accounts) {
    if (!isPaper(acct)) continue
    if (!hasCredentials(acct)) continue

    // Skip disabled accounts
    if (acct.enabled === false) continue

    const engine = getBrokerPreset(acct.presetId).engine
    // IBKR: check TWS/Gateway reachability before attempting connect
    if (engine === 'ibkr') {
      const pc = acct.presetConfig as Record<string, unknown>
      const host = String(pc.host ?? '127.0.0.1')
      const port = Number(pc.port ?? 7497)
      const reachable = await isTcpReachable(host, port)
      if (!reachable) {
        console.warn(`e2e setup: ${acct.id} — TWS not reachable at ${host}:${port}, skipping`)
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
      provider: engine,
      broker,
    })
  }

  return result
}

/** Filter test accounts by provider engine. */
export function filterByProvider(accounts: TestAccount[], provider: BrokerEngine): TestAccount[] {
  return accounts.filter(a => a.provider === provider)
}
