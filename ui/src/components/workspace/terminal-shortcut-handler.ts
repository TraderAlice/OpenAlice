import type { IDisposable } from '@xterm/xterm'
import { resolveTerminalShortcutAction } from './terminal-shortcut-policy'

export function installTerminalShortcutHandler(args: {
  terminalElement: HTMLElement | null | undefined
  isMac: boolean
  isKittyKeyboardActive: () => boolean
  sendInput: (data: string, source: string) => void
}): IDisposable {
  const terminalElement = args.terminalElement
  if (!terminalElement) return { dispose: () => undefined }

  const onKeyDown = (event: KeyboardEvent): void => {
    const action = resolveTerminalShortcutAction(event, args)
    if (!action) return
    event.preventDefault()
    event.stopImmediatePropagation()
    args.sendInput(action.data, action.source)
  }
  terminalElement.addEventListener('keydown', onKeyDown, true)
  return {
    dispose: () => terminalElement.removeEventListener('keydown', onKeyDown, true)
  }
}
