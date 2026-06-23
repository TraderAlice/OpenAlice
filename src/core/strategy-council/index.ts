/**
 * Strategy Council — three-role multi-agent deliberation.
 *
 * Usage:
 *   import { StrategyCouncil } from '@/core/strategy-council'
 *
 *   const council = new StrategyCouncil({ agentCenter, toolCenter, eventLog })
 *   const decision = await council.deliberate('2330 TT intraday outlook for next hour')
 *   console.log(decision.finalAction, decision.positionFactor)
 */

export { StrategyCouncil } from './council.js'
export type { StrategyCouncilOpts, DeliberateOpts, CombinedResult } from './council.js'
export { extractJsonBlock, parseRoleReply, combineVerdicts } from './council.js'
export { DEFAULT_ROLES, JSON_CONTRACT, getRole } from './roles.js'
export type {
  RoleName,
  RoleDefinition,
  RoleVerdict,
  VerdictLabel,
  StrategyDecision,
  FinalAction,
} from './types.js'
export { STRATEGY_DECISION_EVENT, STRATEGY_ERROR_EVENT } from './types.js'
