/**
 * Shared TWS connection for all e2e tests.
 *
 * Usage in test files:
 *   import { client, available, waitFor } from './setup'
 *
 * The connection is established once and reused across all e2e files.
 * If TWS is not running, `available` is false and tests should skip.
 */

import Decimal from 'decimal.js'
import { EClient, DefaultEWrapper, type ContractDetails, type Contract, type Order, type OrderState } from '../../src/index.js'
import { isTwsAvailable, TWS_HOST, TWS_PORT } from '../helpers/tws.js'

// --- Collected results from TWS callbacks ---
export const results = {
  serverVersion: 0,
  connTime: '',
  nextValidId: undefined as number | undefined,
  managedAccounts: undefined as string | undefined,
  currentTime: undefined as number | undefined,
  errors: [] as Array<{ reqId: number; code: number; msg: string }>,
  contractDetails: new Map<number, ContractDetails[]>(),
  contractDetailsEnded: new Set<number>(),
  // openOrder callback payloads keyed by orderId (last-write wins)
  openOrders: new Map<number, { contract: Contract; order: Order; orderState: OrderState }>(),
  openOrderEnded: false,
  orderStatus: new Map<number, { status: string; filled: Decimal; remaining: Decimal }>(),
}

// --- Wrapper that collects everything ---
class E2EWrapper extends DefaultEWrapper {
  connectAck() {
    results.serverVersion = client.serverVersion()
    results.connTime = client.twsConnectionTime() ?? ''
  }

  nextValidId(orderId: number) {
    results.nextValidId = orderId
  }

  managedAccounts(list: string) {
    results.managedAccounts = list
  }

  currentTime(time: number) {
    results.currentTime = time
  }

  contractDetails(reqId: number, cd: ContractDetails) {
    if (!results.contractDetails.has(reqId)) {
      results.contractDetails.set(reqId, [])
    }
    results.contractDetails.get(reqId)!.push(cd)
  }

  contractDetailsEnd(reqId: number) {
    results.contractDetailsEnded.add(reqId)
  }

  error(reqId: number, _t: number, code: number, msg: string) {
    // Capture everything during order-flow debugging. Informational (2000+)
    // is useful too: 2109 ("order located behind market"), 2110 ("order
    // rejected—no trading permissions"), etc.
    results.errors.push({ reqId, code, msg })
  }

  openOrder(orderId: number, contract: Contract, order: Order, orderState: OrderState) {
    results.openOrders.set(orderId, { contract, order, orderState })
  }

  openOrderEnd() {
    results.openOrderEnded = true
  }

  orderStatus(
    orderId: number,
    status: string,
    filled: Decimal,
    remaining: Decimal,
  ) {
    results.orderStatus.set(orderId, { status, filled, remaining })
  }
}

// --- Shared client instance ---
export const client = new EClient(new E2EWrapper())

// --- Connection state ---
export const available = await isTwsAvailable()

if (available) {
  await client.connect(TWS_HOST, TWS_PORT, 0)
  // Wait for initial messages (nextValidId, managedAccounts, etc.)
  await sleep(2000)
}

// --- Helpers ---

/** Wait for a condition to become true, with timeout. */
export async function waitFor(
  condition: () => boolean,
  timeoutMs = 5000,
  intervalMs = 100,
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (condition()) return true
    await sleep(intervalMs)
  }
  return condition()
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/** Cleanup — call in globalTeardown or afterAll at the suite level. */
export function disconnect() {
  if (client.isConnected()) {
    client.disconnect()
  }
}
