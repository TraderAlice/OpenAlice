import {
  armTerminalImePendingCandidateKeyRelease,
  clearTerminalImePendingCandidateKeyRelease,
  createTerminalImePendingCandidateKeyReleases,
  shouldApplyTerminalImePendingCandidateKeyRelease
} from './terminal-ime-candidate-key-release-guard'
import { installTerminalImeCompositionTracker } from './terminal-ime-composition-tracker'
import {
  DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES,
  getMacNativeTextInputSourceTracker,
  type MacNativeTextInputSourceFeatures
} from './terminal-ime-input-source'
import { installTerminalImeLinuxCandidateState } from './terminal-ime-linux-candidate-state'
import { installTerminalImeNativeTextForwarder } from './terminal-ime-native-text-forwarder'
import {
  detectTerminalKeyboardPlatform,
  type TerminalKeyboardPlatform
} from './terminal-keyboard-platform'
import { installTerminalShortcutHandler } from './terminal-shortcut-handler'
import {
  shouldBypassXtermKeyboardEvent,
  shouldHandleTerminalInterruptKeyboardEvent,
  shouldPreventDefaultTerminalImeCandidateKey,
  shouldSuppressTerminalImeKeyboardEvent,
  shouldSuppressTerminalInterruptKeyup,
  shouldSuppressTerminalModifierKeyboardEvent,
  TERMINAL_INTERRUPT_INPUT,
  type XtermBypassEvent
} from './xterm-bypass-policy'

export interface TerminalKeyboardController {
  handle(event: KeyboardEvent): boolean
  dispose(): void
}

interface TerminalKeyboardControllerOptions {
  readonly terminalElement: HTMLElement | null | undefined
  readonly platform?: TerminalKeyboardPlatform
  readonly hasSelection: () => boolean
  readonly isKittyKeyboardActive: () => boolean
  readonly sendInput: (data: string, source: string) => void
  readonly resetKittyProtocol: () => void
  readonly now?: () => number
  readonly getMacInputSourceFeatures?: () => MacNativeTextInputSourceFeatures
}

/**
 * Wires Orca's focused IME/xterm policy modules around the one OpenAlice
 * boundary that remains: sending resolved bytes to the active PTY transport.
 */
export function installTerminalKeyboardController(
  options: TerminalKeyboardControllerOptions
): TerminalKeyboardController {
  const platform = options.platform ?? detectTerminalKeyboardPlatform()
  const isMac = platform === 'darwin'
  const isLinux = platform === 'linux'
  const now = options.now ?? Date.now
  const composition = installTerminalImeCompositionTracker(options.terminalElement, { now })
  const linuxCandidateState = installTerminalImeLinuxCandidateState(options.terminalElement, now)
  const pendingCandidateReleases = createTerminalImePendingCandidateKeyReleases()
  const macInputSource = isMac && !options.getMacInputSourceFeatures
    ? getMacNativeTextInputSourceTracker()
    : null
  let pendingInterruptKeyup = false

  const nativeTextForwarder = isMac
    ? installTerminalImeNativeTextForwarder({
        terminalElement: options.terminalElement,
        isComposing: composition.isActive,
        sendInput: (data) => options.sendInput(data, 'ime-native-text'),
        getInputSourceFeatures: options.getMacInputSourceFeatures ??
          macInputSource?.getFeatures ??
          (() => DISABLED_MAC_NATIVE_TEXT_INPUT_SOURCE_FEATURES)
      })
    : { claimKeyEvent: () => false, dispose: () => undefined }

  const shortcuts = installTerminalShortcutHandler({
    terminalElement: options.terminalElement,
    isMac,
    isKittyKeyboardActive: options.isKittyKeyboardActive,
    sendInput: options.sendInput
  })

  const handle = (keyboardEvent: KeyboardEvent): boolean => {
    const event = keyboardEvent as KeyboardEvent & XtermBypassEvent
    const linuxClassification = isLinux
      ? linuxCandidateState.classifyKeyboardEvent(event)
      : { candidateDigitGuardActive: false }
    const observeLinuxEvent = (): void => {
      if (isLinux) linuxCandidateState.observeKeyboardEvent(event, linuxClassification)
    }

    const pendingCandidateRelease = shouldApplyTerminalImePendingCandidateKeyRelease(
      event,
      pendingCandidateReleases,
      now()
    )
    const imeOptions = {
      compositionActive: composition.isActive(),
      candidateKeyGuardActive:
        composition.isCandidateKeyGuardActive() || pendingCandidateRelease,
      pendingCandidateKeyReleaseActive: pendingCandidateRelease,
      linuxOrphanCandidateDigitGuardActive: linuxClassification.candidateDigitGuardActive,
      isMac,
      isLinux
    }

    if (shouldSuppressTerminalImeKeyboardEvent(event, imeOptions)) {
      clearTerminalImePendingCandidateKeyRelease(pendingCandidateReleases, event)
      if (shouldPreventDefaultTerminalImeCandidateKey(event, imeOptions)) {
        event.preventDefault()
        event.stopPropagation()
        armTerminalImePendingCandidateKeyRelease(pendingCandidateReleases, event, now())
      }
      observeLinuxEvent()
      return false
    }
    clearTerminalImePendingCandidateKeyRelease(pendingCandidateReleases, event)

    if (pendingInterruptKeyup && shouldSuppressTerminalInterruptKeyup(event)) {
      pendingInterruptKeyup = false
      observeLinuxEvent()
      return false
    }

    if (
      shouldHandleTerminalInterruptKeyboardEvent(event, {
        isMac,
        hasSelection: options.hasSelection()
      })
    ) {
      if (event.type === 'keydown') {
        pendingInterruptKeyup = true
        options.sendInput(TERMINAL_INTERRUPT_INPUT, 'key:ctrl+c')
        options.resetKittyProtocol()
      } else {
        pendingInterruptKeyup = false
      }
      observeLinuxEvent()
      return false
    }

    if (shouldSuppressTerminalModifierKeyboardEvent(event)) {
      observeLinuxEvent()
      return false
    }

    if (nativeTextForwarder.claimKeyEvent(event)) {
      observeLinuxEvent()
      return false
    }

    const bypass = shouldBypassXtermKeyboardEvent(event, {
      isMac,
      hasSelection: options.hasSelection()
    })
    observeLinuxEvent()
    return !bypass
  }

  const resetTransientState = (): void => {
    pendingInterruptKeyup = false
    pendingCandidateReleases.clear()
    linuxCandidateState.reset()
  }
  options.terminalElement?.addEventListener('blur', resetTransientState, true)

  return {
    handle,
    dispose: () => {
      options.terminalElement?.removeEventListener('blur', resetTransientState, true)
      resetTransientState()
      shortcuts.dispose()
      nativeTextForwarder.dispose()
      linuxCandidateState.dispose()
      composition.dispose()
    }
  }
}
