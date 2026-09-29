/**
 * A-side projection window for the live Web snapshot.
 *
 * Native Agent transcripts stay complete. Alice only bounds what rides in the
 * ephemeral browser snapshot so long sessions stay cheap to poll and render.
 * Hidden prefix stays in process memory for explicit "load earlier" reveals.
 */

import type { WebConversationMessage } from './model.js'

/** Soft cap on messages shipped in each Web snapshot. */
export const WEB_HISTORY_WINDOW_MESSAGES = 120

/** Default chunk size when the browser asks for earlier history. */
export const WEB_HISTORY_REVEAL_CHUNK = 60

/**
 * Split so `visible` is the newest window. Prefer cutting on a user message
 * so tool-call / tool-result chains are not orphaned mid-turn.
 */
export function splitProjectionWindow(
  messages: readonly WebConversationMessage[],
  limit = WEB_HISTORY_WINDOW_MESSAGES,
): { hidden: WebConversationMessage[]; visible: WebConversationMessage[] } {
  if (limit <= 0 || messages.length <= limit) {
    return { hidden: [], visible: messages.slice() }
  }
  let cut = messages.length - limit
  for (let i = cut; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') {
      cut = i
      break
    }
  }
  if (messages.length - cut > Math.ceil(limit * 1.5)) {
    cut = messages.length - limit
  }
  return {
    hidden: messages.slice(0, cut),
    visible: messages.slice(cut),
  }
}

/**
 * Peel the newest slice of the hidden prefix (closest to the visible window).
 * Prefer expanding back to a user message so a reveal starts on a turn boundary.
 */
export function takeEarlierChunk(
  hidden: readonly WebConversationMessage[],
  count = WEB_HISTORY_REVEAL_CHUNK,
): { remaining: WebConversationMessage[]; chunk: WebConversationMessage[] } {
  if (hidden.length === 0 || count <= 0) {
    return { remaining: hidden.slice(), chunk: [] }
  }
  const take = Math.min(count, hidden.length)
  let start = hidden.length - take
  for (let i = start; i >= 0; i -= 1) {
    if (hidden[i]?.role === 'user') {
      start = i
      break
    }
    if (i === 0) start = 0
  }
  return {
    remaining: hidden.slice(0, start),
    chunk: hidden.slice(start),
  }
}
