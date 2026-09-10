// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { installTerminalKeyboardController } from '../terminal-keyboard-controller'
import type { MacNativeTextInputSourceFeatures } from '../terminal-ime-input-source'
import type { TerminalKeyboardPlatform } from '../terminal-keyboard-platform'

function keyEvent(
  type: string,
  key: string,
  overrides: Partial<KeyboardEventInit & { code: string; keyCode: number }> = {}
): KeyboardEvent {
  return new KeyboardEvent(type, {
    key,
    code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
    bubbles: true,
    cancelable: true,
    ...overrides
  })
}

function setup(options: {
  platform?: TerminalKeyboardPlatform
  hasSelection?: boolean
  kittyActive?: boolean
  inputSourceFeatures?: MacNativeTextInputSourceFeatures
} = {}) {
  const terminalElement = document.createElement('div')
  const textarea = document.createElement('textarea')
  terminalElement.append(textarea)
  document.body.append(terminalElement)
  const sent: Array<{ data: string; source: string }> = []
  const resetKittyProtocol = vi.fn()
  const controller = installTerminalKeyboardController({
    terminalElement,
    platform: options.platform ?? 'linux',
    hasSelection: () => options.hasSelection ?? false,
    isKittyKeyboardActive: () => options.kittyActive ?? false,
    sendInput: (data, source) => sent.push({ data, source }),
    resetKittyProtocol,
    ...(options.inputSourceFeatures
      ? { getMacInputSourceFeatures: () => options.inputSourceFeatures as MacNativeTextInputSourceFeatures }
      : {})
  })
  return {
    terminalElement,
    textarea,
    sent,
    resetKittyProtocol,
    controller,
    dispose: () => {
      controller.dispose()
      terminalElement.remove()
    }
  }
}

describe('terminal keyboard controller', () => {
  it('keeps Ctrl+C as ETX without a selection and resets stale Kitty state', () => {
    const fixture = setup()
    try {
      expect(fixture.controller.handle(keyEvent('keydown', 'c', { code: 'KeyC', ctrlKey: true }))).toBe(false)
      expect(fixture.controller.handle(keyEvent('keyup', 'c', { code: 'KeyC', ctrlKey: true }))).toBe(false)
      expect(fixture.sent).toEqual([{ data: '\x03', source: 'key:ctrl+c' }])
      expect(fixture.resetKittyProtocol).toHaveBeenCalledOnce()
    } finally {
      fixture.dispose()
    }
  })

  it('keeps native clipboard chords out of xterm', () => {
    const linux = setup({ hasSelection: true })
    const mac = setup({ platform: 'darwin', inputSourceFeatures: {
      forwardAsciiPunctuation: false,
      forwardShortTextReplacements: false
    } })
    try {
      expect(linux.controller.handle(keyEvent('keydown', 'c', { ctrlKey: true }))).toBe(false)
      expect(linux.controller.handle(keyEvent('keydown', 'v', { ctrlKey: true }))).toBe(false)
      expect(mac.controller.handle(keyEvent('keydown', 'c', { metaKey: true }))).toBe(false)
      expect(mac.controller.handle(keyEvent('keydown', 'v', { metaKey: true }))).toBe(false)
      expect(linux.sent).toEqual([])
      expect(mac.sent).toEqual([])
    } finally {
      linux.dispose()
      mac.dispose()
    }
  })

  it('keeps Linux IME navigation and candidate selectors out of the PTY', () => {
    const fixture = setup()
    try {
      fixture.terminalElement.dispatchEvent(new CompositionEvent('compositionstart', { data: 'n' }))
      expect(fixture.controller.handle(keyEvent('keydown', 'ArrowDown'))).toBe(false)
      const candidate = keyEvent('keydown', ' ', { code: 'Space' })
      expect(fixture.controller.handle(candidate)).toBe(false)
      expect(candidate.defaultPrevented).toBe(true)
      expect(fixture.controller.handle(keyEvent('keyup', ' ', { code: 'Space' }))).toBe(false)
      expect(fixture.sent).toEqual([])
    } finally {
      fixture.dispose()
    }
  })

  it('forwards Chinese full stop from input when keydown still reports ASCII period', () => {
    const fixture = setup({
      platform: 'darwin',
      inputSourceFeatures: {
        forwardAsciiPunctuation: true,
        forwardShortTextReplacements: false
      }
    })
    try {
      expect(
        fixture.controller.handle(keyEvent('keydown', '.', { code: 'Period', keyCode: 190 }))
      ).toBe(false)
      expect(
        fixture.controller.handle(keyEvent('keypress', '。', { code: '', keyCode: 0 }))
      ).toBe(false)
      fixture.textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: '。'
      }))
      expect(
        fixture.controller.handle(keyEvent('keyup', '.', { code: 'Period', keyCode: 190 }))
      ).toBe(false)
      expect(fixture.sent).toEqual([{ data: '。', source: 'ime-native-text' }])
      expect(fixture.textarea.value).toBe('')
    } finally {
      fixture.dispose()
    }
  })

  it('forwards ordinary ASCII period unchanged through the same browser fallback', () => {
    const fixture = setup({
      platform: 'darwin',
      inputSourceFeatures: {
        forwardAsciiPunctuation: true,
        forwardShortTextReplacements: false
      }
    })
    try {
      expect(
        fixture.controller.handle(keyEvent('keydown', '.', { code: 'Period', keyCode: 190 }))
      ).toBe(false)
      fixture.textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: '.'
      }))
      expect(fixture.sent).toEqual([{ data: '.', source: 'ime-native-text' }])
    } finally {
      fixture.dispose()
    }
  })

  it('leaves IME-processed (keyCode 229) punctuation keydowns to xterm', () => {
    // macOS Chromium reports every keydown with keyCode 229 while an IME is
    // active — including its ASCII/English mode — and xterm then batches the
    // inserted text behind CompositionHelper's 0ms textarea diff. Claiming
    // these keydowns made the forwarder clear the shared textarea mid-window,
    // which dropped fast-typed letters and could emit a DEL that swallowed
    // the just-forwarded character (the "cannot type ?" symptom).
    const fixture = setup({
      platform: 'darwin',
      inputSourceFeatures: {
        forwardAsciiPunctuation: true,
        forwardShortTextReplacements: false
      }
    })
    try {
      expect(
        fixture.controller.handle(
          keyEvent('keydown', '?', { code: 'Slash', keyCode: 229, shiftKey: true })
        )
      ).toBe(true)
      expect(
        fixture.controller.handle(keyEvent('keydown', '？', { code: 'Slash', keyCode: 229 }))
      ).toBe(true)
      fixture.textarea.value = 'why?'
      fixture.textarea.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertText',
        data: '?'
      }))
      // Unclaimed input events must pass through untouched: nothing forwarded
      // and the textarea (xterm's diff baseline) must not be cleared.
      expect(fixture.sent).toEqual([])
      expect(fixture.textarea.value).toBe('why?')
    } finally {
      fixture.dispose()
    }
  })

  it('leaves IME-processed letter keydowns to xterm even when replacements are on', () => {
    const fixture = setup({
      platform: 'darwin',
      inputSourceFeatures: {
        forwardAsciiPunctuation: true,
        forwardShortTextReplacements: true
      }
    })
    try {
      expect(
        fixture.controller.handle(keyEvent('keydown', 'a', { code: 'KeyA', keyCode: 229 }))
      ).toBe(true)
      expect(fixture.sent).toEqual([])
    } finally {
      fixture.dispose()
    }
  })
})
