/**
 * Strategy Council types — three-role multi-agent deliberation.
 *
 * Each role (trend / signal / risk) is a stateless sub-agent with its own
 * system prompt and tool whitelist. The Council coordinates them and
 * produces a unified StrategyDecision event.
 */

// ==================== Role Definitions ====================

export type RoleName = 'trend' | 'signal' | 'risk'

export interface RoleDefinition {
  name: RoleName
  label: string
  /** System prompt (required — each role needs distinct framing). */
  systemPrompt: string
  /**
   * Tool group whitelist. Only tools whose group name is in this list
   * are exposed to the role. Built-in Claude tools (Read/Glob/etc.) are
   * separately controlled via the Agent SDK's own disallow list.
   */
  allowedToolGroups: string[]
  /** Optional per-call disabled tool names, in addition to the group filter. */
  extraDisabledTools?: string[]
}

// ==================== Verdict ====================

/**
 * A role's structured verdict for one deliberation round.
 *
 * `verdict` semantics differ by role:
 *   - trend:  bullish / bearish / neutral — market regime direction
 *   - signal: long / short / hold        — immediate entry direction
 *   - risk:   allow / reduce / block     — gating decision
 *
 * We use one enum to keep the schema uniform and let the coordinator
 * interpret per-role meaning.
 */
export type VerdictLabel =
  | 'bullish'
  | 'bearish'
  | 'neutral'
  | 'long'
  | 'short'
  | 'hold'
  | 'allow'
  | 'reduce'
  | 'block'

export interface RoleVerdict {
  role: RoleName
  verdict: VerdictLabel
  /** 0.0–1.0 self-reported confidence. */
  confidence: number
  /** Short human-readable explanation. */
  reasoning: string
  /** Optional list of symbols the verdict applies to. */
  symbols?: string[]
  /** Optional numeric suggested position size factor, 0.0–1.0. */
  positionFactor?: number
  /** Raw text returned by the role agent, for audit. */
  rawText: string
  /** Wall-clock duration of the sub-agent call. */
  elapsedMs: number
  /** True if the role returned malformed JSON and we fell back to defaults. */
  parseError?: string
}

// ==================== Final Decision ====================

export type FinalAction = 'long' | 'short' | 'hold' | 'blocked'

export interface StrategyDecision {
  /** Unique id, used as the event-log payload key. */
  id: string
  /** ISO-8601 timestamp of coordinator completion. */
  timestamp: string
  /** The raw market context prompt fed to all three roles. */
  input: string
  /** All three role verdicts, in fixed order: trend, signal, risk. */
  verdicts: RoleVerdict[]
  /** Coordinator output — the combined action. */
  finalAction: FinalAction
  /** Human-readable explanation of how the coordinator combined verdicts. */
  rationale: string
  /** Optional position-size factor (0.0–1.0) after risk scaling. */
  positionFactor: number
  /** Total wall-clock duration of the deliberation, in ms. */
  elapsedMs: number
}

// ==================== Events ====================

/** Event type pushed to event-log when a deliberation finishes. */
export const STRATEGY_DECISION_EVENT = 'strategy.decision'

/** Event type pushed when coordinator is blocked due to an exception. */
export const STRATEGY_ERROR_EVENT = 'strategy.error'
