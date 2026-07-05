/**
 * Agent-boundary compaction for trading tool outputs.
 *
 * The wire shapes are IBKR-superset objects: an Order serializes to ~120
 * fields, most carrying UNSET sentinels (1.7976931348623157e+308,
 * 2147483647, 1.70141…e+38 Decimal max). For an LLM that's not just token
 * waste — sentinels READ AS DATA ("minQty: 2147483647" looks like a real
 * constraint) and actively mislead analysis. Principle at this boundary:
 * **unset = absent**. Only fields that carry information leave the tool.
 *
 * Tolerant of all three value forms the SDK can hand us (Decimal instance,
 * Decimal-as-string, plain number) because rehydration depth varies by
 * call path.
 */

import Decimal from 'decimal.js'

// ==================== value normalization ====================

const UNSET_DOUBLE_STR = '1.7976931348623157e+308'
const UNSET_I32_STR = '2147483647'
// Decimal UNSET sentinel = 2^127-ish; match the canonical prefix in both
// scientific ("1.70141…e+38") and toFixed plain-integer ("170141…", 39
// digits) renderings.
const UNSET_DECIMAL_RE = /^1\.?70141183460469/

/** Normalize a maybe-Decimal/string/number to a string, or undefined when
 *  it's an UNSET sentinel / empty. */
export function val(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = v instanceof Decimal ? v.toFixed()
    : typeof v === 'object' && 'toFixed' in (v as object) ? (v as Decimal).toFixed()
    : String(v)
  if (s === '' || s === UNSET_DOUBLE_STR || s === UNSET_I32_STR) return undefined
  if (UNSET_DECIMAL_RE.test(s)) return undefined
  return s
}

/** val() + decimal-place cap (display precision for money fields the AI
 *  reads but never feeds back into order entry). */
export function money(v: unknown, dp = 2): string | undefined {
  const s = val(v)
  if (s === undefined) return undefined
  try {
    return new Decimal(s).toDecimalPlaces(dp).toFixed()
  } catch {
    return s
  }
}

/** val() with a looser cap for prices/costs (crypto needs sub-cent). */
export function price(v: unknown): string | undefined {
  const s = val(v)
  if (s === undefined) return undefined
  try {
    return new Decimal(s).toDecimalPlaces(8).toFixed()
  } catch {
    return s
  }
}

// ==================== shape compactors ====================

type AnyRec = Record<string, unknown>

function pick(out: AnyRec, key: string, value: unknown): void {
  if (value !== undefined) out[key] = value
}

/** Contract → only the fields that identify the instrument (IBKR superset:
 *  derivative fields ride along exactly when set). */
export function compactContract(c: unknown): AnyRec {
  if (!c || typeof c !== 'object') return {}
  const k = c as AnyRec
  const out: AnyRec = {}
  pick(out, 'aliceId', val(k['aliceId']))
  pick(out, 'symbol', val(k['symbol']))
  pick(out, 'localSymbol', val(k['localSymbol']))
  pick(out, 'secType', val(k['secType']))
  pick(out, 'currency', val(k['currency']))
  pick(out, 'exchange', val(k['exchange']))
  pick(out, 'description', val(k['description']))
  pick(out, 'expiry', val(k['lastTradeDateOrContractMonth']))
  // strike 0 = "not an option" — carries no signal, drop like a sentinel
  const strike = val(k['strike'])
  if (strike && strike !== '0') out['strike'] = strike
  const right = val(k['right'])
  if (right === 'C' || right === 'CALL') out['right'] = 'C'
  else if (right === 'P' || right === 'PUT') out['right'] = 'P'
  const mult = val(k['multiplier'])
  if (mult && mult !== '1') out['multiplier'] = mult
  return out
}

/** Order → the set fields only (the ~115 others are IBKR defaults). */
export function compactOrderFields(o: unknown): AnyRec {
  if (!o || typeof o !== 'object') return {}
  const k = o as AnyRec
  const out: AnyRec = {}
  pick(out, 'action', val(k['action']))
  pick(out, 'orderType', val(k['orderType']))
  pick(out, 'totalQuantity', val(k['totalQuantity']))
  pick(out, 'cashQty', val(k['cashQty']))
  pick(out, 'lmtPrice', val(k['lmtPrice']))
  pick(out, 'auxPrice', val(k['auxPrice']))
  pick(out, 'trailStopPrice', val(k['trailStopPrice']))
  pick(out, 'trailingPercent', val(k['trailingPercent']))
  pick(out, 'tif', val(k['tif']))
  pick(out, 'goodTillDate', val(k['goodTillDate']))
  if (k['outsideRth'] === true) out['outsideRth'] = true
  const filled = val(k['filledQuantity'])
  if (filled) out['filledQuantity'] = filled
  return out
}

/** Operation (staged / committed) → human-scale summary. */
export function compactOperation(op: unknown): AnyRec {
  if (!op || typeof op !== 'object') return {}
  const k = op as AnyRec
  const action = k['action'] as string
  switch (action) {
    case 'placeOrder':
    case 'observeExternalOrder':
      return {
        action,
        contract: compactContract(k['contract']),
        order: compactOrderFields(k['order']),
        ...(k['tpsl'] ? { tpsl: k['tpsl'] } : {}),
      }
    case 'closePosition':
      return {
        action,
        contract: compactContract(k['contract']),
        ...(val(k['quantity']) ? { quantity: val(k['quantity']) } : {}),
      }
    case 'modifyOrder':
      return { action, orderId: k['orderId'], changes: compactOrderFields(k['changes']) }
    case 'cancelOrder':
      return { action, orderId: k['orderId'] }
    default:
      return { action }
  }
}

/** OperationResult → status + execution data; never the raw echo or the
 *  120-field orderState. The reject reason is the one orderState field
 *  that carries signal. */
export function compactResult(r: unknown): AnyRec {
  if (!r || typeof r !== 'object') return {}
  const k = r as AnyRec
  const out: AnyRec = {
    action: k['action'],
    success: k['success'],
    status: k['status'],
  }
  pick(out, 'orderId', val(k['orderId']))
  pick(out, 'filledQty', val(k['filledQty']))
  pick(out, 'filledPrice', price(k['filledPrice']))
  pick(out, 'error', val(k['error']))
  // Bracket TP/SL leg ids — the agent's only confirmation the protective
  // legs exist (and the handle for cancelling them).
  const legs = k['legs'] as Array<{ orderId?: unknown; kind?: unknown }> | undefined
  if (Array.isArray(legs) && legs.length > 0) {
    out['legs'] = legs.map((l) => ({ orderId: l.orderId, kind: l.kind }))
  }
  const orderState = k['orderState'] as AnyRec | undefined
  const rejectReason = orderState ? val(orderState['rejectReason']) : undefined
  if (rejectReason) out['rejectReason'] = rejectReason
  const warning = orderState ? val(orderState['warningText']) : undefined
  if (warning) out['warning'] = warning
  return out
}

/** GitStatus → staged ops compacted; scalars pass through. */
export function compactStatus(status: unknown): AnyRec {
  if (!status || typeof status !== 'object') return {}
  const k = status as AnyRec
  // "pending" is overloaded in trading (pending ORDERS = working on the
  // exchange) — at the agent boundary the committed-not-pushed state is
  // named what it is: awaiting approval.
  const msg = k['pendingMessage']
  return {
    staged: Array.isArray(k['staged']) ? k['staged'].map(compactOperation) : [],
    awaitingApproval: msg ? { message: msg, hash: k['pendingHash'] ?? null } : null,
    head: k['head'] ?? null,
    commitCount: k['commitCount'],
  }
}

/** AddResult (stage echo) → confirmation, not a serialization dump. */
export function compactStageResult(r: unknown): AnyRec {
  if (!r || typeof r !== 'object') return {}
  const k = r as AnyRec
  return {
    staged: k['staged'],
    index: k['index'],
    operation: compactOperation(k['operation']),
  }
}

/** PushResult → per-op outcomes without raw/orderState noise. */
export function compactPushResult(r: unknown): AnyRec {
  if (!r || typeof r !== 'object') return {}
  const k = r as AnyRec
  return {
    hash: k['hash'],
    message: k['message'],
    operationCount: k['operationCount'],
    submitted: Array.isArray(k['submitted']) ? k['submitted'].map(compactResult) : [],
    rejected: Array.isArray(k['rejected']) ? k['rejected'].map(compactResult) : [],
  }
}

/** GitCommit (tradingShow) → ops + results compacted; stateAfter collapsed
 *  to the account-level numbers + counts (the full position/order arrays
 *  are reachable via getPortfolio/getOrders when actually needed). */
export function compactCommit(commit: unknown): AnyRec {
  if (!commit || typeof commit !== 'object') return {}
  const k = commit as AnyRec
  const state = (k['stateAfter'] ?? {}) as AnyRec
  return {
    hash: k['hash'],
    parentHash: k['parentHash'],
    message: k['message'],
    timestamp: k['timestamp'],
    operations: Array.isArray(k['operations']) ? k['operations'].map(compactOperation) : [],
    results: Array.isArray(k['results']) ? k['results'].map(compactResult) : [],
    stateAfter: {
      netLiquidation: money(state['netLiquidation']),
      totalCashValue: money(state['totalCashValue']),
      unrealizedPnL: money(state['unrealizedPnL']),
      realizedPnL: money(state['realizedPnL']),
      positionCount: Array.isArray(state['positions']) ? state['positions'].length : 0,
      pendingOrderCount: Array.isArray(state['pendingOrders']) ? state['pendingOrders'].length : 0,
    },
  }
}

/** ContractDetails → contract compacted + primitive fields that carry
 *  signal (generic sentinel sweep over scalars; nested IBKR noise dropped). */
export function compactContractDetails(details: unknown): AnyRec {
  if (!details || typeof details !== 'object') return {}
  const k = details as AnyRec
  const out: AnyRec = {}
  for (const [key, v] of Object.entries(k)) {
    if (key === 'contract') { out['contract'] = compactContract(v); continue }
    if (v == null || typeof v === 'object') continue
    const s = val(v)
    if (s !== undefined && s !== '0' && s !== 'false') out[key] = v
  }
  return out
}

/** AccountInfo → 2dp money (display precision; the ledger keeps full). */
export function compactAccountInfo(info: unknown): AnyRec {
  if (!info || typeof info !== 'object') return {}
  const k = info as AnyRec
  const out: AnyRec = { baseCurrency: k['baseCurrency'] }
  pick(out, 'netLiquidation', money(k['netLiquidation']))
  pick(out, 'totalCashValue', money(k['totalCashValue']))
  pick(out, 'unrealizedPnL', money(k['unrealizedPnL']))
  pick(out, 'realizedPnL', money(k['realizedPnL']))
  pick(out, 'buyingPower', money(k['buyingPower']))
  pick(out, 'initMarginReq', money(k['initMarginReq']))
  pick(out, 'maintMarginReq', money(k['maintMarginReq']))
  if (k['dayTradesRemaining'] != null) out['dayTradesRemaining'] = k['dayTradesRemaining']
  return out
}
