import { describe, expect, it } from 'vitest'

import {
  describeTerminalInput,
  keyMapForAgent,
  keySignature,
  TERMINAL_FONT_FAMILY,
} from '../terminalInput'

function keyEvent(key: string, mods: Partial<Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>> = {}) {
  return {
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...mods,
  }
}

describe('terminal input helpers', () => {
  it('builds stable key signatures for modified keys', () => {
    expect(keySignature(keyEvent('Enter', { shiftKey: true }))).toBe('shift+enter')
    expect(keySignature(keyEvent('L', { ctrlKey: true }))).toBe('ctrl+l')
    expect(keySignature(keyEvent('ArrowUp', { altKey: true, metaKey: true }))).toBe('alt+meta+arrowup')
  })

  it('uses agent-specific Shift+Enter sequences', () => {
    expect(keyMapForAgent('claude')).toEqual({ 'shift+enter': '\x1b\r' })
    expect(keyMapForAgent('codex')).toEqual({ 'shift+enter': '\x1b[13;2u' })
    expect(keyMapForAgent('shell')).toBeUndefined()
    expect(keyMapForAgent('opencode')).toBeUndefined()
    expect(keyMapForAgent(null)).toBeUndefined()
  })

  it('keeps CJK-capable fallback fonts in the terminal stack', () => {
    expect(TERMINAL_FONT_FAMILY).toContain('Noto Sans Mono CJK SC')
    expect(TERMINAL_FONT_FAMILY).toContain('PingFang SC')
  })

  it('diagnoses fullwidth punctuation without normalizing it to ASCII', () => {
    expect(describeTerminalInput('，。,.')).toBe('，=U+FF0C 。=U+3002 ,=U+002C .=U+002E')
  })
})
