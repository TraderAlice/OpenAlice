import type { XtermBypassEvent } from './xterm-bypass-policy'
import { TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS } from './terminal-ime-composition-tracker'

export type TerminalImePendingCandidateKeyReleases = Map<string, number>

const TERMINAL_IME_CANDIDATE_SELECTION_KEYS = new Set([
  ' ', '0', '1', '2', '3', '4', '5', '6', '7', '8', '9'
])
const TERMINAL_IME_CANDIDATE_DIGITS = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'])

function isTerminalImeCandidateSelectionKey(key: string): boolean {
  return TERMINAL_IME_CANDIDATE_SELECTION_KEYS.has(key)
}

export function isTerminalImeCandidateSelectionKeyEvent(event: XtermBypassEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return false
  return isTerminalImeCandidateSelectionKey(event.key)
}

export function isTerminalImeCandidateDigitKeyEvent(event: XtermBypassEvent): boolean {
  return (
    isTerminalImeCandidateSelectionKeyEvent(event) && TERMINAL_IME_CANDIDATE_DIGITS.has(event.key)
  )
}

export function createTerminalImePendingCandidateKeyReleases(): TerminalImePendingCandidateKeyReleases {
  return new Map()
}

export function armTerminalImePendingCandidateKeyRelease(
  releases: TerminalImePendingCandidateKeyReleases,
  event: XtermBypassEvent,
  now: number
): void {
  if (event.type !== 'keydown' || !isTerminalImeCandidateSelectionKeyEvent(event)) return
  releases.set(event.key, now + TERMINAL_IME_CANDIDATE_GUARD_POST_COMPOSITION_MS)
}

export function shouldApplyTerminalImePendingCandidateKeyRelease(
  event: XtermBypassEvent,
  releases: TerminalImePendingCandidateKeyReleases,
  now: number
): boolean {
  if (event.type === 'keydown') {
    return (
      event.repeat === true &&
      isTerminalImeCandidateSelectionKeyEvent(event) &&
      releases.has(event.key)
    )
  }
  if (event.type === 'keyup') {
    return isTerminalImeCandidateSelectionKey(event.key) && releases.has(event.key)
  }
  if (!isTerminalImeCandidateSelectionKeyEvent(event)) return false
  const expiresAt = releases.get(event.key)
  return expiresAt !== undefined && now <= expiresAt
}

export function clearTerminalImePendingCandidateKeyRelease(
  releases: TerminalImePendingCandidateKeyReleases,
  event: XtermBypassEvent
): void {
  if (event.type === 'keyup' || (event.type === 'keydown' && event.repeat !== true)) {
    releases.delete(event.key)
  }
}
