/**
 * StrategyCouncil — three-role multi-agent deliberation coordinator.
 *
 * The council runs three independent sub-agents (trend / signal / risk)
 * against the same market context, parses each one's structured JSON
 * verdict, then combines them into a single StrategyDecision.
 *
 * Design notes:
 * - Each sub-agent call is stateless (uses a throwaway MemorySessionStore)
 *   so council deliberations never pollute the main chat session history.
 * - Tool isolation is done via `disabledTools` computed from the ToolCenter
 *   inventory: any tool whose group is not in the role's whitelist, plus
 *   each role's explicit `extraDisabledTools`, is hidden from that call.
 * - Coordinator rules live in `combineVerdicts()` — simple and explicit.
 *   Complex ML-based gating belongs in a later iteration.
 */

import { randomUUID } from 'node:crypto'
import type { AgentCenter } from '../agent-center.js'
import type { ToolCenter } from '../tool-center.js'
import type { EventLog } from '../event-log.js'
import { MemorySessionStore } from '../session.js'
import { DEFAULT_ROLES, getRole } from './roles.js'
import type {
  RoleDefinition,
  RoleName,
  RoleVerdict,
  StrategyDecision,
  FinalAction,
  VerdictLabel,
} from './types.js'
import { STRATEGY_DECISION_EVENT, STRATEGY_ERROR_EVENT } from './types.js'

// ==================== Public options ====================

export interface StrategyCouncilOpts {
  agentCenter: AgentCenter
  toolCenter: ToolCenter
  /** Optional — if provided, deliberations are written as events. */
  eventLog?: EventLog
  /** Override the default three roles (for testing or custom setups). */
  roles?: RoleDefinition[]
  /** Per-role AI provider profile slug (for cheaper/faster roles on e.g. Haiku). */
  profileByRole?: Partial<Record<RoleName, string>>
}

export interface DeliberateOpts {
  /**
   * Role-level profile override for this call only. Useful for A/B testing
   * different models per role without touching global config.
   */
  profileByRole?: Partial<Record<RoleName, string>>
}

// ==================== StrategyCouncil ====================

export class StrategyCouncil {
  private agentCenter: AgentCenter
  private toolCenter: ToolCenter
  private eventLog?: EventLog
  private roles: RoleDefinition[]
  private profileByRole: Partial<Record<RoleName, string>>

  constructor(opts: StrategyCouncilOpts) {
    this.agentCenter = opts.agentCenter
    this.toolCenter = opts.toolCenter
    this.eventLog = opts.eventLog
    this.roles = opts.roles ?? DEFAULT_ROLES
    this.profileByRole = opts.profileByRole ?? {}
  }

  // ==================== Public API ====================

  /**
   * Run a single role against an input. Returns a parsed RoleVerdict.
   * This is the low-level building block; most callers want `deliberate()`.
   */
  async askAsRole(
    roleName: RoleName,
    input: string,
    opts?: { profileSlug?: string },
  ): Promise<RoleVerdict> {
    const role = getRole(roleName, this.roles)
    const disabledTools = this.computeDisabledTools(role)
    const session = new MemorySessionStore(`council-${roleName}-${randomUUID()}`)

    const start = Date.now()
    const profileSlug = opts?.profileSlug ?? this.profileByRole[roleName]

    const result = await this.agentCenter.askWithSession(input, session, {
      systemPrompt: role.systemPrompt,
      disabledTools,
      profileSlug,
    })

    const elapsedMs = Date.now() - start
    return parseRoleReply(role.name, result.text, elapsedMs)
  }

  /**
   * Run all three roles against the same input and combine their verdicts
   * into a final action. If an eventLog is configured, the decision is
   * appended as a `strategy.decision` event.
   */
  async deliberate(input: string, opts?: DeliberateOpts): Promise<StrategyDecision> {
    const start = Date.now()
    const roleNames: RoleName[] = ['trend', 'signal', 'risk']

    try {
      const verdicts = await Promise.all(
        roleNames.map((name) =>
          this.askAsRole(name, input, {
            profileSlug: opts?.profileByRole?.[name] ?? this.profileByRole[name],
          }),
        ),
      )

      const { finalAction, rationale, positionFactor } = combineVerdicts(verdicts)

      const decision: StrategyDecision = {
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        input,
        verdicts,
        finalAction,
        rationale,
        positionFactor,
        elapsedMs: Date.now() - start,
      }

      await this.eventLog?.append(STRATEGY_DECISION_EVENT, decision)
      return decision
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      await this.eventLog?.append(STRATEGY_ERROR_EVENT, {
        input,
        error: message,
        ts: new Date().toISOString(),
      })
      throw err
    }
  }

  // ==================== Helpers ====================

  /**
   * Compute the disabled-tools list for a role based on its allowed
   * group whitelist. Any tool whose group is NOT in the whitelist gets
   * disabled, plus the role's explicit extra blacklist.
   */
  private computeDisabledTools(role: RoleDefinition): string[] {
    const allowed = new Set(role.allowedToolGroups)
    const inventory = this.toolCenter.getInventory()
    const disabled: string[] = []
    for (const { name, group } of inventory) {
      if (!allowed.has(group)) disabled.push(name)
    }
    if (role.extraDisabledTools) disabled.push(...role.extraDisabledTools)
    return disabled
  }
}

// ==================== Reply parsing ====================

/**
 * Extract the last fenced JSON block from a role reply.
 * Tolerant of models that add trailing whitespace, language tags, or
 * surrounding prose.
 */
export function extractJsonBlock(text: string): unknown | null {
  // 1. Look for ```json … ``` fenced blocks (greedy match last one).
  const fenceRegex = /```(?:json)?\s*([\s\S]*?)```/gi
  let lastMatch: RegExpExecArray | null = null
  let match: RegExpExecArray | null
  while ((match = fenceRegex.exec(text)) !== null) lastMatch = match
  if (lastMatch) {
    try {
      return JSON.parse(lastMatch[1].trim())
    } catch {
      // fall through to regex fallback
    }
  }
  // 2. Fallback — look for the last top-level {...} block.
  const braceMatch = text.match(/\{[\s\S]*\}$/)
  if (braceMatch) {
    try {
      return JSON.parse(braceMatch[0])
    } catch {
      return null
    }
  }
  return null
}

const ALLOWED_VERDICTS: Record<RoleName, VerdictLabel[]> = {
  trend: ['bullish', 'bearish', 'neutral'],
  signal: ['long', 'short', 'hold'],
  risk: ['allow', 'reduce', 'block'],
}

const DEFAULT_VERDICTS: Record<RoleName, VerdictLabel> = {
  trend: 'neutral',
  signal: 'hold',
  risk: 'block', // fail-safe: if risk agent broke, do not trade
}

/**
 * Parse a single role's reply into a RoleVerdict. On parse failure,
 * returns a conservative default (hold / block) with `parseError` set.
 */
export function parseRoleReply(
  role: RoleName,
  rawText: string,
  elapsedMs: number,
): RoleVerdict {
  const parsed = extractJsonBlock(rawText) as Record<string, unknown> | null

  if (!parsed || typeof parsed !== 'object') {
    return {
      role,
      verdict: DEFAULT_VERDICTS[role],
      confidence: 0,
      reasoning: '(no structured verdict found in reply)',
      rawText,
      elapsedMs,
      parseError: 'no-json-block',
    }
  }

  const verdict = String(parsed.verdict ?? '').toLowerCase() as VerdictLabel
  const allowed = ALLOWED_VERDICTS[role]
  if (!allowed.includes(verdict)) {
    return {
      role,
      verdict: DEFAULT_VERDICTS[role],
      confidence: 0,
      reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
      rawText,
      elapsedMs,
      parseError: `invalid-verdict: ${verdict || '(missing)'}`,
    }
  }

  const confidenceRaw = typeof parsed.confidence === 'number' ? parsed.confidence : 0
  const confidence = Math.max(0, Math.min(1, confidenceRaw))

  const positionFactor =
    typeof parsed.positionFactor === 'number'
      ? Math.max(0, Math.min(1, parsed.positionFactor))
      : undefined

  const symbols =
    Array.isArray(parsed.symbols) && parsed.symbols.every((s) => typeof s === 'string')
      ? (parsed.symbols as string[])
      : undefined

  return {
    role,
    verdict,
    confidence,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
    symbols,
    positionFactor,
    rawText,
    elapsedMs,
  }
}

// ==================== Coordinator ====================

export interface CombinedResult {
  finalAction: FinalAction
  rationale: string
  positionFactor: number
}

/**
 * Simple, explicit fusion rules:
 *
 * 1. Risk gate has absolute veto. If risk says "block" → blocked.
 * 2. Otherwise compute the base direction from trend + signal:
 *    - trend bullish + signal long  → long
 *    - trend bearish + signal short → short
 *    - trend neutral                → follow signal
 *    - conflict                     → hold
 * 3. Risk "reduce" scales positionFactor down (default 0.5 if role did
 *    not supply one). Risk "allow" uses full 1.0.
 * 4. If final direction is hold/blocked, positionFactor = 0.
 *
 * This logic is intentionally dumb — the real alpha should come from the
 * role prompts and their tool use, not from a clever fusion rule.
 */
export function combineVerdicts(verdicts: RoleVerdict[]): CombinedResult {
  const trend = verdicts.find((v) => v.role === 'trend')
  const signal = verdicts.find((v) => v.role === 'signal')
  const risk = verdicts.find((v) => v.role === 'risk')

  if (!trend || !signal || !risk) {
    return {
      finalAction: 'blocked',
      rationale: 'missing one or more role verdicts — defaulted to blocked',
      positionFactor: 0,
    }
  }

  // 1. Risk veto
  if (risk.verdict === 'block') {
    return {
      finalAction: 'blocked',
      rationale: `risk agent blocked: ${risk.reasoning || '(no reason)'}`,
      positionFactor: 0,
    }
  }

  // 2. Base direction from trend + signal
  let direction: FinalAction = 'hold'
  let rationale = ''

  if (signal.verdict === 'long') {
    if (trend.verdict === 'bullish') {
      direction = 'long'
      rationale = 'trend bullish + signal long → long'
    } else if (trend.verdict === 'neutral') {
      direction = 'long'
      rationale = 'trend neutral + signal long → long (signal-led)'
    } else {
      direction = 'hold'
      rationale = 'trend bearish conflicts with signal long → hold'
    }
  } else if (signal.verdict === 'short') {
    if (trend.verdict === 'bearish') {
      direction = 'short'
      rationale = 'trend bearish + signal short → short'
    } else if (trend.verdict === 'neutral') {
      direction = 'short'
      rationale = 'trend neutral + signal short → short (signal-led)'
    } else {
      direction = 'hold'
      rationale = 'trend bullish conflicts with signal short → hold'
    }
  } else {
    direction = 'hold'
    rationale = 'signal hold → hold'
  }

  if (direction === 'hold') {
    return { finalAction: 'hold', rationale, positionFactor: 0 }
  }

  // 3. Apply risk scaling
  if (risk.verdict === 'reduce') {
    const factor = risk.positionFactor ?? 0.5
    return {
      finalAction: direction,
      rationale: `${rationale}; risk reduced size → ${factor.toFixed(2)}`,
      positionFactor: factor,
    }
  }

  return {
    finalAction: direction,
    rationale: `${rationale}; risk allow → full size`,
    positionFactor: 1.0,
  }
}
