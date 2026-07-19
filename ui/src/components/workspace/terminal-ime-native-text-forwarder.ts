import type { IDisposable } from '@xterm/xterm'
import {
  DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES,
  type MacNativeTextInputSourceFeatures
} from './terminal-ime-input-source'
import {
  isImeNativeTextKeydownCandidate,
  isSinglePrintableTextKey,
  type ImeNativeTextKeyEvent
} from './terminal-ime-native-text-candidates'

type ClaimedKeyPress = { key: string; code?: string }

export type TerminalImeNativeTextForwarder = IDisposable & {
  claimKeyEvent: (event: ImeNativeTextKeyEvent) => boolean
}

function matchesClaimedPress(event: ImeNativeTextKeyEvent, claimedPress: ClaimedKeyPress): boolean {
  if (event.code && claimedPress.code) return event.code === claimedPress.code
  return event.key === claimedPress.key
}

function matchesClaimedKeypress(
  event: ImeNativeTextKeyEvent,
  claimedPress: ClaimedKeyPress
): boolean {
  if (matchesClaimedPress(event, claimedPress)) return true
  if (event.code && claimedPress.code) return false
  return isSinglePrintableTextKey(event.key)
}

export function installTerminalImeNativeTextForwarder(args: {
  terminalElement: HTMLElement | null | undefined
  isComposing: () => boolean
  sendInput: (data: string) => void
  getInputSourceFeatures?: () => MacNativeTextInputSourceFeatures
}): TerminalImeNativeTextForwarder {
  if (!args.terminalElement) {
    return { claimKeyEvent: () => false, dispose: () => undefined }
  }

  const terminalElement = args.terminalElement
  let pendingForward = false
  let pendingForwardClearTimer: number | null = null
  let claimedPress: ClaimedKeyPress | null = null

  const clearPendingForwardTimer = (): void => {
    if (pendingForwardClearTimer !== null) {
      window.clearTimeout(pendingForwardClearTimer)
      pendingForwardClearTimer = null
    }
  }
  const disarmPendingForward = (): void => {
    clearPendingForwardTimer()
    pendingForward = false
  }
  const schedulePendingForwardClear = (): void => {
    clearPendingForwardTimer()
    pendingForwardClearTimer = window.setTimeout(() => {
      pendingForward = false
      pendingForwardClearTimer = null
    }, 100)
  }

  const claimKeyEvent = (event: ImeNativeTextKeyEvent): boolean => {
    if (event.type === 'keydown') {
      if (
        !isImeNativeTextKeydownCandidate(
          event,
          args.isComposing(),
          args.getInputSourceFeatures?.() ?? DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES
        )
      ) {
        return false
      }
      clearPendingForwardTimer()
      pendingForward = true
      claimedPress = { key: event.key, code: event.code }
      return true
    }
    if (!claimedPress) return false
    if (event.ctrlKey || event.altKey || event.metaKey || event.isComposing === true) return false
    if (event.type === 'keyup') {
      if (!matchesClaimedPress(event, claimedPress)) return false
      claimedPress = null
      if (pendingForward) schedulePendingForwardClear()
      return true
    }
    if (event.type === 'keypress') return matchesClaimedKeypress(event, claimedPress)
    return false
  }

  const forwardCommittedText = (event: Event): void => {
    if (!(event instanceof InputEvent) || !pendingForward) return
    if (event.inputType !== 'insertText') {
      disarmPendingForward()
      return
    }
    disarmPendingForward()
    if (event.data) args.sendInput(event.data)
    event.stopImmediatePropagation()
    if (event.target instanceof HTMLTextAreaElement) event.target.value = ''
  }
  const cancelPending = (): void => {
    disarmPendingForward()
    claimedPress = null
  }

  terminalElement.addEventListener('input', forwardCommittedText, true)
  terminalElement.addEventListener('blur', cancelPending, true)
  return {
    claimKeyEvent,
    dispose: () => {
      cancelPending()
      terminalElement.removeEventListener('input', forwardCommittedText, true)
      terminalElement.removeEventListener('blur', cancelPending, true)
    }
  }
}
