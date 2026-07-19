export type TerminalShortcutEvent = {
  key: string
  code?: string
  metaKey: boolean
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
}

export type TerminalShortcutAction = { type: 'sendInput'; data: string; source: string }

/**
 * Terminal byte fallbacks lifted from Orca's shortcut policy. Shift+Enter is
 * selected by the application's live Kitty negotiation rather than agent name.
 */
export function resolveTerminalShortcutAction(
  event: TerminalShortcutEvent,
  options: { isMac: boolean; isKittyKeyboardActive: () => boolean }
): TerminalShortcutAction | null {
  if (
    !event.metaKey && !event.ctrlKey && !event.altKey && event.shiftKey && event.key === 'Enter'
  ) {
    return {
      type: 'sendInput',
      data: options.isKittyKeyboardActive() ? '\x1b[13;2u' : '\x1b\r',
      source: 'shortcut:shift+enter'
    }
  }

  if (
    event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && event.key === 'Enter'
  ) {
    return { type: 'sendInput', data: '\x1b[13;5u', source: 'shortcut:ctrl+enter' }
  }

  if (
    event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey &&
    event.key === 'Backspace'
  ) {
    return { type: 'sendInput', data: '\x17', source: 'shortcut:ctrl+backspace' }
  }

  if (options.isMac && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
    if (event.key === 'Backspace') {
      return { type: 'sendInput', data: '\x15', source: 'shortcut:cmd+backspace' }
    }
    if (event.key === 'Delete') {
      return { type: 'sendInput', data: '\x0b', source: 'shortcut:cmd+delete' }
    }
    if (event.key === 'ArrowLeft') {
      return { type: 'sendInput', data: '\x01', source: 'shortcut:cmd+arrowleft' }
    }
    if (event.key === 'ArrowRight') {
      return { type: 'sendInput', data: '\x05', source: 'shortcut:cmd+arrowright' }
    }
  }

  if (
    !event.metaKey && !event.ctrlKey && event.altKey && !event.shiftKey &&
    event.key === 'Backspace' && !options.isKittyKeyboardActive()
  ) {
    return { type: 'sendInput', data: '\x1b\x7f', source: 'shortcut:alt+backspace' }
  }

  if (
    !event.metaKey && !event.ctrlKey && event.altKey && !event.shiftKey &&
    (event.key === 'ArrowLeft' || event.key === 'ArrowRight') &&
    !options.isKittyKeyboardActive()
  ) {
    return {
      type: 'sendInput',
      data: event.key === 'ArrowLeft' ? '\x1bb' : '\x1bf',
      source: `shortcut:alt+${event.key.toLowerCase()}`
    }
  }

  return null
}
