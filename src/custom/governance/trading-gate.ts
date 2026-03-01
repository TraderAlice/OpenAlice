import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Config } from '../../core/config.js'
import type { EventLog } from '../../core/event-log.js'

type TradingMarket = 'crypto' | 'securities'

interface ReleaseGateStatus {
  generatedAt?: string
  expiresAt?: string
  allowPaperTrading?: boolean
  allowLiveTrading?: boolean
  reasonCodes?: unknown
}

interface GovernanceReleaseGateEvalInput {
  market: TradingMarket
  action: string
  paperTrading: boolean
  symbol?: string
  governance: Config['governance']
  eventLog: EventLog
}

interface GovernanceGatedDispatcherInput<TOperation extends { action: string; params: Record<string, unknown> }> {
  market: TradingMarket
  paperTrading: boolean
  governance: Config['governance']
  eventLog: EventLog
  dispatch: (op: TOperation) => Promise<unknown>
}

const RELEASE_GATE_ERROR_PREFIX = '[governance:release-gate]'

function parseIso(value: unknown): Date | null {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null
  }
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function normalizeReasonCodes(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

async function readReleaseGateStatus(path: string): Promise<{ status: ReleaseGateStatus | null; error?: string }> {
  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      return { status: null, error: 'release gate status must be a JSON object' }
    }
    return { status: parsed as ReleaseGateStatus }
  } catch (err) {
    return { status: null, error: err instanceof Error ? err.message : String(err) }
  }
}

async function emitEvent(
  eventLog: EventLog,
  type: 'governance.block' | 'governance.warn',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await eventLog.append(type, payload)
  } catch {
    // Event logging is best-effort and must not affect trading flow.
  }
}

function formatBlockMessage(reason: string): string {
  return `${RELEASE_GATE_ERROR_PREFIX} ${reason}`
}

function resolveReleaseGateStatusPath(config: Config['governance']): string {
  return resolve(config.releaseGate.statusPath)
}

export async function enforceGovernanceReleaseGate(
  input: GovernanceReleaseGateEvalInput,
): Promise<void> {
  if (input.action !== 'placeOrder') {
    return
  }
  if (!input.governance.enabled || !input.governance.releaseGate.enabled) {
    return
  }

  const statusPath = resolveReleaseGateStatusPath(input.governance)
  const now = new Date()
  const { status, error } = await readReleaseGateStatus(statusPath)
  const reasonCodes = normalizeReasonCodes(status?.reasonCodes)

  const basePayload = {
    market: input.market,
    action: input.action,
    symbol: input.symbol,
    paperTrading: input.paperTrading,
    statusPath,
    reasonCodes,
  }

  if (!status) {
    const reason = `status unavailable: ${error ?? 'unknown error'}`
    if (input.governance.releaseGate.blockOnExpired) {
      await emitEvent(input.eventLog, 'governance.block', { ...basePayload, reason })
      throw new Error(formatBlockMessage(reason))
    }
    await emitEvent(input.eventLog, 'governance.warn', { ...basePayload, reason })
    return
  }

  const allowPaperTrading = status.allowPaperTrading
  const allowLiveTrading = status.allowLiveTrading
  const expectedAllowKey = input.paperTrading ? 'allowPaperTrading' : 'allowLiveTrading'
  const expectedAllowValue = input.paperTrading ? allowPaperTrading : allowLiveTrading

  if (expectedAllowValue !== true) {
    const reason = `${expectedAllowKey}=false`
    await emitEvent(input.eventLog, 'governance.block', { ...basePayload, reason })
    throw new Error(formatBlockMessage(reason))
  }

  const generatedAt = parseIso(status.generatedAt)
  const expiresAt = parseIso(status.expiresAt)
  const staleReasons: string[] = []

  if (!generatedAt) {
    staleReasons.push('generatedAt missing or invalid')
  } else {
    const ageHours = (now.getTime() - generatedAt.getTime()) / 3_600_000
    if (ageHours > input.governance.releaseGate.maxStatusAgeHours) {
      staleReasons.push(
        `status too old: ${ageHours.toFixed(2)}h > ${input.governance.releaseGate.maxStatusAgeHours}h`,
      )
    }
  }

  if (!expiresAt) {
    staleReasons.push('expiresAt missing or invalid')
  } else if (now.getTime() > expiresAt.getTime()) {
    staleReasons.push(`status expired at ${expiresAt.toISOString()}`)
  }

  if (staleReasons.length === 0) {
    return
  }

  const reason = staleReasons.join('; ')
  if (input.governance.releaseGate.blockOnExpired) {
    await emitEvent(input.eventLog, 'governance.block', { ...basePayload, reason })
    throw new Error(formatBlockMessage(reason))
  }

  await emitEvent(input.eventLog, 'governance.warn', { ...basePayload, reason })
}

export function createGovernanceGatedDispatcher<
  TOperation extends { action: string; params: Record<string, unknown> },
>(
  input: GovernanceGatedDispatcherInput<TOperation>,
): (op: TOperation) => Promise<unknown> {
  return async (op: TOperation): Promise<unknown> => {
    await enforceGovernanceReleaseGate({
      market: input.market,
      action: op.action,
      paperTrading: input.paperTrading,
      symbol: typeof op.params.symbol === 'string' ? op.params.symbol : undefined,
      governance: input.governance,
      eventLog: input.eventLog,
    })
    return input.dispatch(op)
  }
}

