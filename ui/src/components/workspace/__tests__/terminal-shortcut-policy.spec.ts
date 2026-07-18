// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { installTerminalShortcutHandler } from '../terminal-shortcut-handler'

function setup(kittyActive: boolean) {
  const terminal = document.createElement('div')
  const textarea = document.createElement('textarea')
  terminal.append(textarea)
  document.body.append(terminal)
  const sent: Array<{ data: string; source: string }> = []
  const handler = installTerminalShortcutHandler({
    terminalElement: terminal,
    isMac: true,
    isKittyKeyboardActive: () => kittyActive,
    sendInput: (data, source) => sent.push({ data, source })
  })
  return { textarea, sent, dispose: () => { handler.dispose(); terminal.remove() } }
}

describe('Orca terminal shortcut policy', () => {
  it('uses CSI-u for Shift+Enter only after the application negotiates Kitty', () => {
    const fixture = setup(true)
    try {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true
      })
      fixture.textarea.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true)
      expect(fixture.sent).toEqual([
        { data: '\x1b[13;2u', source: 'shortcut:shift+enter' }
      ])
    } finally {
      fixture.dispose()
    }
  })

  it('falls back to Esc+CR for Shift+Enter without Kitty negotiation', () => {
    const fixture = setup(false)
    try {
      fixture.textarea.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Enter', code: 'Enter', shiftKey: true, bubbles: true, cancelable: true
      }))
      expect(fixture.sent).toEqual([{ data: '\x1b\r', source: 'shortcut:shift+enter' }])
    } finally {
      fixture.dispose()
    }
  })
})
