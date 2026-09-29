import type { ConversationItem } from '../conversation/types'
import type { WebSessionPhase } from './api'

const USER_TURN_THRESHOLD = 12
const TOOL_STEP_THRESHOLD = 20

export function countUserTurns(items: readonly ConversationItem[]): number {
  return items.filter((item) => item.kind === 'user').length
}

export function countToolSteps(items: readonly ConversationItem[]): number {
  let count = 0
  for (const item of items) {
    if (item.kind === 'assistant-turn' && item.activity) count += item.activity.steps.length
  }
  return count
}

/** Soft tip when an AutoQuant idle thread has grown long. */
export function shouldOfferContextContinue(input: {
  readonly source?: string
  readonly phase?: WebSessionPhase
  readonly items: readonly ConversationItem[]
}): boolean {
  if (input.source !== 'auto-quant') return false
  if (input.phase && input.phase !== 'idle') return false
  const userTurns = countUserTurns(input.items)
  const tools = countToolSteps(input.items)
  return userTurns >= USER_TURN_THRESHOLD || tools >= TOOL_STEP_THRESHOLD
}
