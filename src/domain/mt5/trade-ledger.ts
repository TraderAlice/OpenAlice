import { readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'

export type Mt5TradeOrigin = 'manual' | 'ea' | 'other' | 'unknown'
export type Mt5TradeLedgerState = 'no_data' | 'learning' | 'blocked' | 'stale'

export interface Mt5TradeLedgerRow {
  accountMode: string
  server: string
  login: string
  broker: string
  symbol: string
  dealTicket: string
  orderTicket: string
  positionId: string
  time: string
  entry: string
  type: string
  reason: string
  volume: number
  price: number
  commission: number
  fee: number
  swap: number
  profit: number
  magic: number
  comment: string
  origin: Mt5TradeOrigin
}

export interface Mt5TradeLedgerSummary {
  state: Mt5TradeLedgerState
  label: string
  detail: string
  broker: string
  symbol: string
  accountMode: string | null
  server: string | null
  lastDealTime: string | null
  lastUpdated: string | null
  totalDeals: number
  manualDeals: number
  eaDeals: number
  otherDeals: number
  unknownDeals: number
  netProfit: number
}

const STALE_AFTER_MS = 24 * 60 * 60_000

function parseCsvLine(line: string): string[] {
  const cells: string[] = []
  let current = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"'
        index += 1
      } else {
        quoted = !quoted
      }
    } else if (character === ',' && !quoted) {
      cells.push(current)
      current = ''
    } else {
      current += character
    }
  }
  cells.push(current)
  return cells
}

function numberField(row: Record<string, string>, key: string, lineNumber: number): number {
  const value = row[key] ?? ''
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`Invalid numeric MT5 trade ledger field "${key}" on row ${lineNumber}`)
  return parsed
}

export function deriveMt5TradeOrigin(row: Pick<Mt5TradeLedgerRow, 'magic' | 'reason' | 'comment'>): Mt5TradeOrigin {
  const reason = row.reason.toLowerCase()
  const comment = row.comment.toLowerCase()
  if (row.magic !== 0 || reason === 'expert' || comment.includes('jmb goldmine')) return 'ea'
  if (reason === 'client' || reason === 'mobile' || reason === 'web') return 'manual'
  if (reason === 'balance' || reason === 'correction' || reason === 'charge') return 'other'
  return 'unknown'
}

export function parseMt5TradeLedgerCsv(text: string): Mt5TradeLedgerRow[] {
  const lines = text.trim().split(/\r?\n/).filter(Boolean)
  if (lines.length === 0) return []
  const headers = parseCsvLine(lines[0]!).map((header) => header.trim())
  return lines.slice(1).map((line, index) => {
    const lineNumber = index + 2
    const values = parseCsvLine(line)
    if (values.length !== headers.length) throw new Error(`Malformed MT5 trade ledger row ${lineNumber}`)
    const raw = Object.fromEntries(headers.map((header, headerIndex) => [header, values[headerIndex]!.trim()]))
    const base = {
      accountMode: raw['account_mode'] ?? '',
      server: raw['server'] ?? '',
      login: raw['login'] ?? '',
      broker: raw['broker'] ?? '',
      symbol: raw['symbol'] ?? '',
      dealTicket: raw['deal_ticket'] ?? '',
      orderTicket: raw['order_ticket'] ?? '',
      positionId: raw['position_id'] ?? '',
      time: raw['time'] ?? '',
      entry: raw['entry'] ?? '',
      type: raw['type'] ?? '',
      reason: raw['reason'] ?? '',
      volume: numberField(raw, 'volume', lineNumber),
      price: numberField(raw, 'price', lineNumber),
      commission: numberField(raw, 'commission', lineNumber),
      fee: numberField(raw, 'fee', lineNumber),
      swap: numberField(raw, 'swap', lineNumber),
      profit: numberField(raw, 'profit', lineNumber),
      magic: numberField(raw, 'magic', lineNumber),
      comment: raw['comment'] ?? '',
    }
    return { ...base, origin: deriveMt5TradeOrigin(base) }
  })
}

export async function summarizeMt5TradeLedger(
  root: string,
  broker: string,
  symbol: string,
  now = new Date(),
): Promise<Mt5TradeLedgerSummary> {
  const path = join(root, broker, symbol, 'deals.csv')
  let text: string
  let modified: Date
  try {
    const result = await Promise.all([readFile(path, 'utf8'), stat(path).then((entry) => entry.mtime)])
    text = result[0]
    modified = result[1]
  } catch {
    return {
      state: 'no_data',
      label: 'Awaiting trade history',
      detail: 'Run the read-only MT5 trade ledger exporter for this demo account and symbol.',
      broker,
      symbol,
      accountMode: null,
      server: null,
      lastDealTime: null,
      lastUpdated: null,
      totalDeals: 0,
      manualDeals: 0,
      eaDeals: 0,
      otherDeals: 0,
      unknownDeals: 0,
      netProfit: 0,
    }
  }

  const rows = parseMt5TradeLedgerCsv(text).filter((row) => row.broker === broker && row.symbol === symbol)
  const first = rows[0]
  const lastDealTime = rows.map((row) => row.time).sort().at(-1) ?? null
  const totalMoney = rows.reduce((total, row) => total + row.profit + row.commission + row.fee + row.swap, 0)
  const base = {
    broker,
    symbol,
    accountMode: first?.accountMode ?? null,
    server: first?.server ?? null,
    lastDealTime,
    lastUpdated: modified.toISOString(),
    totalDeals: rows.length,
    manualDeals: rows.filter((row) => row.origin === 'manual').length,
    eaDeals: rows.filter((row) => row.origin === 'ea').length,
    otherDeals: rows.filter((row) => row.origin === 'other').length,
    unknownDeals: rows.filter((row) => row.origin === 'unknown').length,
    netProfit: Number(totalMoney.toFixed(2)),
  }
  if (rows.length === 0) {
    return { ...base, state: 'no_data', label: 'Awaiting trade history', detail: 'No matching demo trade history was found for this broker and symbol.' }
  }
  if (rows.some((row) => row.accountMode !== 'demo')) {
    return { ...base, state: 'blocked', label: 'Trade history blocked', detail: 'The ledger contains non-demo account history, so it cannot unlock demo automation.' }
  }
  if (now.getTime() - modified.getTime() > STALE_AFTER_MS) {
    return { ...base, state: 'stale', label: 'Trade history stale', detail: 'The trade ledger has not been refreshed in the last 24 hours.' }
  }
  return { ...base, state: 'learning', label: 'Learning from demo history', detail: 'Manual and EA demo trades are available for review and journaling.' }
}
