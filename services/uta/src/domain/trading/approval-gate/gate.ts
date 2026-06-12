import { readFile } from 'node:fs/promises'
import Decimal from 'decimal.js'
import type { ApprovalGateAudit, Operation } from '../git/types.js'
import { ApprovalGateError } from './errors.js'
import {
  findMatchingTicket,
  loadApprovalTickets,
  resolveApprovalGatePath,
  verifyApprovalTicket,
  type VerifiedApprovalTicket,
} from './tickets.js'

export interface ApprovalGateConfig {
  enabled: boolean
  ticketDirectory: string
  publicKeyPath: string
  allowedAccountRole: 'paper'
  requireTicket: boolean
}

export interface ApprovalGateContext {
  config?: ApprovalGateConfig
  accountId: string
  pendingHash: string | null
  pendingMessage: string | null
  staged: Operation[]
  pendingOrders: Array<{ orderId: string; symbol: string }>
  now: Date
}

export async function evaluateApprovalGate(ctx: ApprovalGateContext): Promise<ApprovalGateAudit | null> {
  if (!ctx.config?.enabled) return null

  const pendingHash = requireNonEmpty(ctx.pendingHash, 'pending hash')
  const pendingMessage = requireNonEmpty(ctx.pendingMessage, 'pending message')
  if (ctx.staged.length === 0) {
    throw new ApprovalGateError('approval_gate_pending_commit_missing', 'Approval gate requires at least one staged operation.')
  }

  const tickets = await loadApprovalTickets({ ticketDirectory: ctx.config.ticketDirectory })
  const publicKeyPem = await readApprovalPublicKey(ctx.config.publicKeyPath)
  const verified = tickets.map((ticket) => verifyApprovalTicket(ticket, publicKeyPem))
  const ticket = findMatchingTicket(ctx.accountId, ctx.now, verified, ctx.config.allowedAccountRole)
  if (!ticket && ctx.config.requireTicket) {
    throw new ApprovalGateError('approval_gate_ticket_missing', `No approval ticket matches account "${ctx.accountId}".`, {
      accountId: ctx.accountId,
    })
  }
  if (!ticket) return null

  bindCommitMessage(pendingMessage, ticket)
  return validateOperations({
    ticket,
    pendingHash,
    staged: ctx.staged,
    pendingOrders: ctx.pendingOrders,
  })
}

async function readApprovalPublicKey(publicKeyPath: string): Promise<string> {
  const resolved = resolveApprovalGatePath(publicKeyPath)
  try {
    return await readFile(resolved, 'utf-8')
  } catch (err) {
    throw new ApprovalGateError('approval_gate_config_invalid', `Approval gate public key "${resolved}" could not be read: ${errorMessage(err)}.`, {
      publicKeyPath: resolved,
    })
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function requireNonEmpty(value: string | null, label: string): string {
  if (!value || !value.trim()) {
    throw new ApprovalGateError('approval_gate_pending_commit_missing', `Approval gate requires ${label}.`)
  }
  return value
}

function bindCommitMessage(message: string, ticket: VerifiedApprovalTicket): void {
  if (!message.includes(ticket.ticket_id)) {
    throw new ApprovalGateError('approval_gate_commit_binding_failed', `Pending commit message must include approval ticket id "${ticket.ticket_id}".`, {
      ticketId: ticket.ticket_id,
    })
  }
  if (ticket.run_id && !message.includes(ticket.run_id)) {
    throw new ApprovalGateError('approval_gate_commit_binding_failed', `Pending commit message must include approval run id "${ticket.run_id}".`, {
      ticketId: ticket.ticket_id,
      runId: ticket.run_id,
    })
  }
}

function validateOperations(args: {
  ticket: VerifiedApprovalTicket
  pendingHash: string
  staged: Operation[]
  pendingOrders: Array<{ orderId: string; symbol: string }>
}): ApprovalGateAudit {
  const placeOrders = args.staged.filter((op): op is Extract<Operation, { action: 'placeOrder' }> => op.action === 'placeOrder')
  if (placeOrders.length > 1) {
    throw new ApprovalGateError('approval_gate_operation_denied', 'Initial pilot approval allows at most one placeOrder operation.')
  }

  const pendingSymbolById = new Map(args.pendingOrders.map((entry) => [entry.orderId, entry.symbol]))
  const actions: string[] = []
  const symbols: string[] = []
  const entries: ApprovalGateAudit['entries'] = []
  let sawStagedTpSl = false

  for (const op of args.staged) {
    switch (op.action) {
      case 'placeOrder': {
        const action = String(op.order.action)
        const symbol = operationSymbol(op.contract)
        requireAllowedAction(args.ticket, action)
        requireAllowedSymbol(args.ticket, symbol)
        const notional = computeNotionalUsd(op)
        const limit = toDecimal(args.ticket.max_notional_usd, 'max_notional_usd')
        if (notional.gt(limit)) {
          throw new ApprovalGateError('approval_gate_notional_exceeded', `Approval gate rejected ${symbol} ${action}: notional ${notional.toFixed()} exceeds ticket limit ${limit.toFixed()}.`, {
            ticketId: args.ticket.ticket_id,
            symbol,
          })
        }
        sawStagedTpSl = Boolean(op.tpsl?.takeProfit || op.tpsl?.stopLoss)
        actions.push(action)
        symbols.push(symbol)
        entries.push({ symbol, action, notionalUsd: notional.toFixed() })
        break
      }
      case 'cancelOrder': {
        requireAllowedAction(args.ticket, 'cancelOrder')
        const symbol = pendingSymbolById.get(op.orderId)
        if (!symbol) {
          throw new ApprovalGateError('approval_gate_cancel_symbol_unknown', `Approval gate cannot resolve cancelOrder id "${op.orderId}" to a pending order symbol.`, {
            orderId: op.orderId,
          })
        }
        requireAllowedSymbol(args.ticket, symbol)
        actions.push('cancelOrder')
        symbols.push(symbol)
        break
      }
      case 'closePosition': {
        requireAllowedAction(args.ticket, 'closePosition')
        const symbol = operationSymbol(op.contract)
        requireAllowedSymbol(args.ticket, symbol)
        actions.push('closePosition')
        symbols.push(symbol)
        break
      }
      default:
        throw new ApprovalGateError('approval_gate_operation_denied', `Approval gate rejected unsupported staged operation "${op.action}".`)
    }
  }

  const exitPlanMode = validateExitPlan(args.ticket, sawStagedTpSl)
  return {
    ticketId: args.ticket.ticket_id,
    runId: args.ticket.run_id,
    pendingHash: args.pendingHash,
    operationCount: args.staged.length,
    actions,
    symbols: [...new Set(symbols)],
    exitPlanMode,
    entries,
  }
}

function operationSymbol(contract: { symbol?: unknown; localSymbol?: unknown; aliceId?: unknown }): string {
  const symbol = typeof contract.symbol === 'string' && contract.symbol.trim()
    ? contract.symbol.trim()
    : typeof contract.localSymbol === 'string' && contract.localSymbol.trim()
      ? contract.localSymbol.trim()
      : typeof contract.aliceId === 'string' && contract.aliceId.includes('|')
        ? contract.aliceId.split('|').at(-1) ?? ''
        : ''
  if (!symbol) {
    throw new ApprovalGateError('approval_gate_operation_denied', 'Approval gate cannot validate an operation without a contract symbol.')
  }
  return symbol
}

function requireAllowedAction(ticket: VerifiedApprovalTicket, action: string): void {
  if (!ticket.allowed_actions.includes(action)) {
    throw new ApprovalGateError('approval_gate_operation_denied', `Approval ticket "${ticket.ticket_id}" does not allow action "${action}".`, {
      ticketId: ticket.ticket_id,
      action,
    })
  }
}

function requireAllowedSymbol(ticket: VerifiedApprovalTicket, symbol: string): void {
  if (!ticket.allowed_symbols.includes(symbol)) {
    throw new ApprovalGateError('approval_gate_operation_denied', `Approval ticket "${ticket.ticket_id}" does not allow symbol "${symbol}".`, {
      ticketId: ticket.ticket_id,
      symbol,
    })
  }
}

function computeNotionalUsd(op: Extract<Operation, { action: 'placeOrder' }>): Decimal {
  const cashQty = optionalPositiveDecimal(op.order.cashQty)
  if (cashQty) return cashQty

  const totalQuantity = optionalPositiveDecimal(op.order.totalQuantity)
  const limitPrice = optionalPositiveDecimal(op.order.lmtPrice)
  if (totalQuantity && limitPrice) return totalQuantity.mul(limitPrice)

  throw new ApprovalGateError('approval_gate_notional_unproven', 'Approval gate cannot prove USD notional from cashQty or totalQuantity * lmtPrice.')
}

function optionalPositiveDecimal(value: unknown): Decimal | null {
  if (value === undefined || value === null) return null
  const decimal = toDecimal(value, 'numeric order field')
  return decimal.gt(0) ? decimal : null
}

function toDecimal(value: unknown, label: string): Decimal {
  try {
    const decimal = Decimal.isDecimal(value) ? value : new Decimal(String(value))
    if (!decimal.isFinite()) throw new Error('not finite')
    return decimal
  } catch {
    throw new ApprovalGateError('approval_gate_notional_unproven', `Approval gate cannot parse ${label} as a decimal.`)
  }
}

function validateExitPlan(ticket: VerifiedApprovalTicket, sawStagedTpSl: boolean): ApprovalGateAudit['exitPlanMode'] {
  if (!ticket.require_exit_plan) return 'not-required'
  if (typeof ticket.exit_plan !== 'string' || !ticket.exit_plan.trim()) {
    throw new ApprovalGateError('approval_gate_exit_plan_missing', `Approval ticket "${ticket.ticket_id}" requires a signed exit plan.`)
  }
  return sawStagedTpSl ? 'staged-tpsl' : 'ticket-exit-plan'
}
