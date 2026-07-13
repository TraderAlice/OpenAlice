import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type Mt5BridgeState = 'awaiting_bridge' | 'stale' | 'unsafe_account' | 'disconnected' | 'ready'

export interface Mt5ReadOnlyBridgeStatus {
  state: Mt5BridgeState
  label: string
  detail: string
  broker: string
  symbol: string
  server: string | null
  capturedAt: string | null
  lastUpdated: string | null
  bid: number | null
  ask: number | null
  spread: number | null
  openPositions: number | null
  openOrders: number | null
}

const STALE_AFTER_MS = 2 * 60_000

type BridgeRow = Record<string, string>

function parseCsv(text: string): BridgeRow | null {
  const [header, value] = text.trim().split(/\r?\n/, 2)
  if (!header || !value) return null
  const keys = header.split(',')
  const values = value.split(',')
  if (keys.length !== values.length) return null
  return Object.fromEntries(keys.map((key, index) => [key.trim(), values[index]!.trim()]))
}

function numberOrNull(value: string | undefined): number | null {
  if (!value) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function waiting(broker: string, symbol: string, detail: string): Mt5ReadOnlyBridgeStatus {
  return {
    state: 'awaiting_bridge',
    label: 'Bridge not attached',
    detail,
    broker,
    symbol,
    server: null,
    capturedAt: null,
    lastUpdated: null,
    bid: null,
    ask: null,
    spread: null,
    openPositions: null,
    openOrders: null,
  }
}

/** Reads a status file produced by the local MT5 EA. This path has no order API. */
export async function readMt5ReadOnlyBridge(
  root: string,
  broker: string,
  symbol: string,
  now = new Date(),
): Promise<Mt5ReadOnlyBridgeStatus> {
  const path = join(root, broker, symbol, 'status.csv')
  let text: string
  let modified: Date
  try {
    [text, modified] = await Promise.all([readFile(path, 'utf8'), stat(path).then((entry) => entry.mtime)])
  } catch {
    return waiting(broker, symbol, 'Attach OpenAliceMt5ReadOnlyBridge to this demo terminal and symbol.')
  }

  const row = parseCsv(text)
  if (!row) return waiting(broker, symbol, 'The bridge status file is unreadable; restart the EA and check the MT5 Experts log.')

  const base = {
    broker,
    symbol,
    server: row['server'] || null,
    capturedAt: row['captured_at'] || null,
    lastUpdated: modified.toISOString(),
    bid: numberOrNull(row['bid']),
    ask: numberOrNull(row['ask']),
    spread: numberOrNull(row['spread_price']),
    openPositions: numberOrNull(row['open_positions']),
    openOrders: numberOrNull(row['open_orders']),
  }
  if (row['bridge_mode'] !== 'read_only' || row['account_mode'] !== 'demo') {
    return { ...base, state: 'unsafe_account', label: 'Demo-only check failed', detail: 'The bridge is not reporting a demo, read-only terminal. It is blocked from progression.' }
  }
  if (row['terminal_connected'] !== '1') {
    return { ...base, state: 'disconnected', label: 'Terminal disconnected', detail: 'MT5 reported no broker connection. No execution capability is available.' }
  }
  if (now.getTime() - modified.getTime() > STALE_AFTER_MS) {
    return { ...base, state: 'stale', label: 'Bridge heartbeat stale', detail: 'The last terminal update is older than two minutes. Check that the EA is attached and Algo Trading settings permit it to run.' }
  }
  return { ...base, state: 'ready', label: 'Demo bridge connected', detail: 'Read-only telemetry is current. This bridge has no order-submission code.' }
}
