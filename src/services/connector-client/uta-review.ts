import {
  MAX_CONNECTOR_UTA_ACCOUNTS,
  MAX_CONNECTOR_UTA_OPERATIONS,
  isConnectorActionExpired,
  utaFailureMessage,
  type ConnectorUtaAccountReview,
  type ConnectorUtaFailure,
  type ConnectorUtaOperation,
  type ConnectorUtaPresentation,
  type ConnectorUtaRequest,
  type ConnectorUtaResult,
  type ConnectorUtaReview,
} from '@traderalice/connector-protocol'
import { UTAHttpError, type PushResult, type UTASummary } from '@traderalice/uta-protocol'
import type { TradingModePolicy } from '../trading-mode.js'
import { describeTradingMode } from '../trading-mode.js'
import type { UTAAccountSDK, UTAManagerSDK } from '../uta-client/index.js'

export interface ConnectorUtaBridgeDeps {
  isEnabled(): Promise<boolean>
  drainUtaActions(): Promise<ConnectorUtaRequest[]>
  claimUtaActions?(): Promise<{ claimId: string; items: ConnectorUtaRequest[] }>
  ackUtaActions?: (claimId: string, itemIds: string[]) => Promise<void>
  releaseUtaActions?: (claimId: string, itemIds: string[]) => Promise<void>
  presentUta(presentation: ConnectorUtaPresentation): Promise<void>
  failUta(failure: ConnectorUtaFailure): Promise<void>
  warn(message: string): void
  utaManager: UTAManagerSDK
  tradingModePolicy(): TradingModePolicy
  now?: () => number
}

export async function processConnectorUtaRequests(deps: ConnectorUtaBridgeDeps): Promise<void> {
  if (!await deps.isEnabled()) return
  const claim = deps.claimUtaActions ? await deps.claimUtaActions() : null
  const requests = claim?.items ?? await deps.drainUtaActions()
  const now = deps.now?.() ?? Date.now()
  const completed: string[] = []
  const retry: string[] = []
  for (const request of requests) {
    if (await fulfillUtaRequest(deps, request, now)) completed.push(request.requestId)
    else retry.push(request.requestId)
  }
  if (claim && completed.length > 0) await deps.ackUtaActions?.(claim.claimId, completed)
  if (claim && retry.length > 0) await deps.releaseUtaActions?.(claim.claimId, retry)
}

export function compactUtaOperation(op: unknown): ConnectorUtaOperation {
  if (!op || typeof op !== 'object') return { action: 'unknown', summary: 'unknown operation' }
  const rec = op as Record<string, unknown>
  const action = typeof rec.action === 'string' && rec.action.trim() ? rec.action : 'unknown'
  const contract = asRecord(rec.contract)
  const order = asRecord(rec.order) ?? asRecord(rec.changes) ?? {}
  const symbol = firstField(contract?.symbol, contract?.localSymbol, stripAliceId(contract?.aliceId))
  const side = firstField(order.action)
  const orderType = firstField(order.orderType)
  const quantity = firstField(order.totalQuantity, order.cashQty, rec.quantity)
  const limitPrice = firstField(order.lmtPrice)
  const auxPrice = firstField(order.auxPrice)
  const summary = summarizeOperation({ action, symbol, side, orderType, quantity, limitPrice, auxPrice, orderId: firstField(rec.orderId) })
  return {
    action,
    summary,
    ...(symbol ? { symbol } : {}),
    ...(side ? { side } : {}),
    ...(orderType ? { orderType } : {}),
    ...(quantity ? { quantity } : {}),
    ...(limitPrice ? { limitPrice } : {}),
    ...(auxPrice ? { auxPrice } : {}),
  }
}

export async function buildConnectorUtaReview(
  manager: UTAManagerSDK,
  policy: TradingModePolicy,
): Promise<ConnectorUtaReview> {
  if (policy.mode === 'lite') {
    return {
      generatedAt: new Date().toISOString(),
      unavailable: describeTradingMode('lite'),
      accounts: [],
    }
  }

  let summaries: UTASummary[]
  try {
    summaries = (await manager.listUTAs()).filter((uta) => uta.health.tier !== 'data')
  } catch (error) {
    return {
      generatedAt: new Date().toISOString(),
      unavailable: error instanceof Error ? error.message : 'Trading service is not reachable.',
      accounts: [],
    }
  }

  const visible = summaries.slice(0, MAX_CONNECTOR_UTA_ACCOUNTS)
  const accounts: ConnectorUtaAccountReview[] = []
  for (const summary of visible) {
    const uta = await manager.get(summary.id)
    if (!uta) continue
    try {
      accounts.push(await accountReview(uta, summary))
    } catch (error) {
      accounts.push({
        id: summary.id,
        label: truncate(summary.label || summary.id, 80),
        pendingMessage: null,
        pendingHash: null,
        stagedCount: 0,
        hiddenOperationCount: 0,
        operations: [{
          action: 'unavailable',
          summary: truncate(error instanceof Error ? error.message : 'Could not read wallet status', 120),
        }],
      })
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    ...(policy.mode === 'readonly' ? { readonly: true } : {}),
    accounts,
    ...(summaries.length > visible.length
      ? { hiddenAccountCount: summaries.length - visible.length }
      : {}),
  }
}

async function fulfillUtaRequest(
  deps: ConnectorUtaBridgeDeps,
  request: ConnectorUtaRequest,
  now: number,
): Promise<boolean> {
  const fail = async (reason: ConnectorUtaFailure['reason'], message?: string) => {
    const failure: ConnectorUtaFailure = {
      requestId: request.requestId,
      connectorId: request.connectorId,
      reason,
      message: message ?? utaFailureMessage(reason),
    }
    try {
      await deps.failUta(failure)
      return true
    } catch (error) {
      deps.warn(error instanceof Error ? error.message : String(error))
      return false
    }
  }

  if (isConnectorActionExpired(request.createdAt, now)) {
    return fail('expired')
  }

  try {
    if (request.action === 'review') {
      return present(deps, request, await buildConnectorUtaReview(deps.utaManager, deps.tradingModePolicy()))
    }

    const policy = deps.tradingModePolicy()
    if (policy.mode === 'lite') {
      return fail('unavailable', describeTradingMode('lite'))
    }
    if (!request.utaId) {
      return fail('not_found')
    }
    if (!request.pendingHash) {
      return fail('conflict')
    }

    const uta = await deps.utaManager.get(request.utaId)
    if (!uta) {
      return fail('not_found')
    }
    const status = await uta.status()
    if (!status.pendingMessage) {
      return present(deps, request, await buildConnectorUtaReview(deps.utaManager, policy), {
        kind: 'error',
        utaId: request.utaId,
        message: 'Nothing is waiting for approval on that account.',
      })
    }
    if (status.staged.length > MAX_CONNECTOR_UTA_OPERATIONS) {
      return present(deps, request, await buildConnectorUtaReview(deps.utaManager, policy), {
        kind: 'error',
        utaId: request.utaId,
        message: `This commit has ${status.staged.length} operations. Approve it in OpenAlice → Trading as Git.`,
      })
    }

    if (request.action === 'push') {
      if (policy.mode === 'readonly') {
        return fail('readonly')
      }
      const pushed = await uta.push(request.pendingHash)
      return present(deps, request, await buildConnectorUtaReview(deps.utaManager, policy), {
        kind: 'pushed',
        utaId: request.utaId,
        message: formatPushResult(uta.label || request.utaId, pushed),
      })
    }

    const rejected = await uta.reject(undefined, request.pendingHash)
    return present(deps, request, await buildConnectorUtaReview(deps.utaManager, policy), {
      kind: 'rejected',
      utaId: request.utaId,
      message: `Rejected ${uta.label || request.utaId} · ${rejected.hash}`,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (isHashConflict(error)) {
      return fail('conflict')
    }
    if (/readonly/i.test(message)) {
      return fail('readonly', message)
    }
    deps.warn(message)
    return fail('delivery_failed', truncate(message, 400))
  }
}

async function present(
  deps: ConnectorUtaBridgeDeps,
  request: ConnectorUtaRequest,
  review: ConnectorUtaReview,
  result?: ConnectorUtaResult,
): Promise<boolean> {
  try {
    await deps.presentUta({
      requestId: request.requestId,
      connectorId: request.connectorId,
      review,
      ...(result ? { result } : {}),
    })
    return true
  } catch (error) {
    deps.warn(error instanceof Error ? error.message : String(error))
    return deps.failUta({
      requestId: request.requestId,
      connectorId: request.connectorId,
      reason: 'delivery_failed',
      message: utaFailureMessage('delivery_failed'),
    }).then(() => true).catch((failError) => {
      deps.warn(failError instanceof Error ? failError.message : String(failError))
      return false
    })
  }
}

async function accountReview(uta: UTAAccountSDK, summary: UTASummary): Promise<ConnectorUtaAccountReview> {
  const status = await uta.status()
  return {
    id: summary.id,
    label: truncate(summary.label || summary.id, 80),
    pendingMessage: status.pendingMessage ? truncate(status.pendingMessage, 200) : null,
    pendingHash: status.pendingHash ? truncate(status.pendingHash, 16) : null,
    stagedCount: status.staged.length,
    hiddenOperationCount: Math.max(0, status.staged.length - MAX_CONNECTOR_UTA_OPERATIONS),
    operations: status.staged.slice(0, MAX_CONNECTOR_UTA_OPERATIONS).map((operation) => compactUtaOperation(operation)),
  }
}

function isHashConflict(error: unknown): boolean {
  if (error instanceof UTAHttpError && error.status === 409) return true
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined
  return code === 'PENDING_HASH_CONFLICT' || code === 'PENDING_HASH_REQUIRED'
}

function formatPushResult(label: string, result: PushResult): string {
  const submitted = result.submitted?.length ?? 0
  const rejected = result.rejected?.length ?? 0
  return `Pushed ${label} · ${result.hash} · ${submitted} submitted${rejected > 0 ? `, ${rejected} rejected` : ''}`
}

function summarizeOperation(input: {
  action: string
  symbol?: string
  side?: string
  orderType?: string
  quantity?: string
  limitPrice?: string
  auxPrice?: string
  orderId?: string
}): string {
  const symbol = input.symbol ?? 'unknown'
  switch (input.action) {
    case 'placeOrder':
    case 'observeExternalOrder': {
      const parts = [input.side ?? 'ORDER', symbol, input.orderType].filter(Boolean)
      if (input.quantity) parts.push(`× ${input.quantity}`)
      if (input.limitPrice) parts.push(`@ ${input.limitPrice}`)
      if (input.auxPrice) parts.push(`aux ${input.auxPrice}`)
      return truncate(parts.join(' '), 120)
    }
    case 'closePosition':
      return truncate(input.quantity ? `Close ${symbol} × ${input.quantity}` : `Close ${symbol}`, 120)
    case 'modifyOrder':
      return truncate(`Modify ${input.orderId ?? 'order'}`, 120)
    case 'cancelOrder':
      return truncate(`Cancel ${input.orderId ?? 'order'}`, 120)
    default:
      return truncate(input.action, 120)
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined
}

function firstField(...values: unknown[]): string | undefined {
  for (const value of values) {
    const text = field(value)
    if (text) return text
  }
  return undefined
}

function field(value: unknown): string | undefined {
  if (value == null) return undefined
  const text = typeof value === 'object' && value && 'toFixed' in value
    ? String((value as { toFixed: (dp?: number) => string }).toFixed())
    : String(value).trim()
  if (!text) return undefined
  if (text === '2147483647' || text.includes('e+308') || /^1\.?70141183460469/.test(text)) return undefined
  return text
}

function stripAliceId(value: unknown): string | undefined {
  const text = field(value)
  if (!text) return undefined
  const sep = text.indexOf('|')
  return sep === -1 ? text : text.slice(sep + 1)
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value
  if (max <= 1) return '…'
  return `${value.slice(0, max - 1)}…`
}
