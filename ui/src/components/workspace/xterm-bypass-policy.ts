import {
  isTerminalImeCandidateDigitKeyEvent,
  isTerminalImeCandidateSelectionKeyEvent
} from './terminal-ime-candidate-key-release-guard'

export type XtermBypassEvent = {
  type: string
  key: string
  code?: string
  keyCode?: number
  isComposing?: boolean
  repeat?: boolean
  defaultPrevented?: boolean
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
}

export type XtermBypassOptions = {
  isMac: boolean
  hasSelection: boolean
}

export type XtermImeKeyboardOptions = {
  compositionActive: boolean
  candidateKeyGuardActive: boolean
  pendingCandidateKeyReleaseActive: boolean
  linuxOrphanCandidateDigitGuardActive?: boolean
  isMac: boolean
  isLinux: boolean
}

export const TERMINAL_INTERRUPT_INPUT = '\x03'
const TERMINAL_MODIFIER_KEYS = new Set(['Alt', 'AltGraph', 'Control', 'Meta', 'Shift'])
const TERMINAL_IME_OWNED_KEYS = new Set([
  'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Backspace', 'Delete',
  'End', 'Enter', 'Escape', 'Home', 'PageDown', 'PageUp'
])

function isSingleNonAsciiPrintableText(key: string): boolean {
  const chars = Array.from(key)
  if (chars.length !== 1) return false
  const codePoint = chars[0].codePointAt(0)
  return codePoint !== undefined && codePoint >= 0x80
}

function isXtermHandledKeyEvent(type: string): boolean {
  return type === 'keydown' || type === 'keyup'
}

export function shouldSuppressTerminalImeKeyboardEvent(
  event: XtermBypassEvent,
  options: XtermImeKeyboardOptions
): boolean {
  const {
    compositionActive,
    candidateKeyGuardActive,
    pendingCandidateKeyReleaseActive,
    linuxOrphanCandidateDigitGuardActive = false,
    isMac,
    isLinux
  } = options
  const suppressOrphanCandidateDigit =
    isLinux && linuxOrphanCandidateDigitGuardActive && isTerminalImeCandidateDigitKeyEvent(event)
  const suppressCandidateKey =
    isLinux &&
    (pendingCandidateKeyReleaseActive ||
      (candidateKeyGuardActive && isTerminalImeCandidateSelectionKeyEvent(event)) ||
      suppressOrphanCandidateDigit)
  if (event.type === 'keypress') return suppressCandidateKey
  if (!isXtermHandledKeyEvent(event.type)) return false
  const passesStandalone229Keydown = isMac || isLinux
  return (
    event.isComposing === true ||
    (event.keyCode === 229 &&
      (event.type !== 'keydown' || compositionActive || !passesStandalone229Keydown)) ||
    (compositionActive && TERMINAL_IME_OWNED_KEYS.has(event.key)) ||
    suppressCandidateKey
  )
}

export function shouldPreventDefaultTerminalImeCandidateKey(
  event: XtermBypassEvent,
  options: XtermImeKeyboardOptions
): boolean {
  return (
    event.type === 'keydown' &&
    options.isLinux &&
    ((options.candidateKeyGuardActive && isTerminalImeCandidateSelectionKeyEvent(event)) ||
      (options.linuxOrphanCandidateDigitGuardActive === true &&
        isTerminalImeCandidateDigitKeyEvent(event)))
  )
}

function isTerminalInterruptCKey(event: XtermBypassEvent): boolean {
  const normalizedKey = event.key.toLowerCase()
  const logicalKeyAvailable = normalizedKey !== '' && normalizedKey !== 'unidentified'
  return logicalKeyAvailable ? normalizedKey === 'c' : event.code === 'KeyC' || event.keyCode === 67
}

function isPlainCtrlC(event: XtermBypassEvent): boolean {
  return (
    isTerminalInterruptCKey(event) && event.ctrlKey &&
    !event.metaKey && !event.altKey && !event.shiftKey
  )
}

export function shouldHandleTerminalInterruptKeyboardEvent(
  event: XtermBypassEvent,
  options: XtermBypassOptions
): boolean {
  if (!isXtermHandledKeyEvent(event.type) || !isPlainCtrlC(event)) return false
  return options.isMac || !options.hasSelection
}

export function shouldSuppressTerminalInterruptKeyup(event: XtermBypassEvent): boolean {
  return (
    event.type === 'keyup' && isTerminalInterruptCKey(event) &&
    !event.metaKey && !event.altKey && !event.shiftKey
  )
}

export function shouldSuppressTerminalModifierKeyboardEvent(event: XtermBypassEvent): boolean {
  return isXtermHandledKeyEvent(event.type) && TERMINAL_MODIFIER_KEYS.has(event.key)
}

function matchesClipboardChord(event: XtermBypassEvent, isMac: boolean): boolean {
  const key = event.key.toLowerCase()
  if (isMac) {
    return event.metaKey && !event.ctrlKey && !event.altKey && (key === 'c' || key === 'v')
  }
  if (event.metaKey || event.altKey || !event.ctrlKey) {
    return !event.ctrlKey && !event.metaKey && !event.altKey && event.shiftKey && key === 'insert'
  }
  if (key === 'c') return event.shiftKey
  if (key === 'v') return true
  return false
}

export function shouldBypassXtermKeyboardEvent(
  event: XtermBypassEvent,
  options: XtermBypassOptions
): boolean {
  if (!isXtermHandledKeyEvent(event.type)) return false
  const { isMac, hasSelection } = options
  const platformModifierHeld = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey

  if (event.defaultPrevented && platformModifierHeld) return true
  if (
    event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey &&
    isSingleNonAsciiPrintableText(event.key)
  ) {
    return true
  }
  if (matchesClipboardChord(event, isMac)) return true
  if (!isMac && event.ctrlKey && !event.shiftKey && event.key.toLowerCase() === 'c') {
    return hasSelection
  }
  return false
}
