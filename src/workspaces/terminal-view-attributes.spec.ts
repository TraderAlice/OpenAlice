import { describe, expect, it } from 'vitest'

import {
  formatXColorRgbSpec,
  parseXColorSpec,
  terminalViewAttributesEqual,
  validateTerminalViewAttributes,
  type TerminalViewAttributes,
} from './terminal-view-attributes.js'

function valid(): TerminalViewAttributes {
  return {
    foreground: [1, 2, 3],
    background: [4, 5, 6],
    cursor: [7, 8, 9],
    ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
    colorSchemeMode: 'dark',
    cursorStyle: 'block',
    cursorBlink: true,
  }
}

describe('terminal view attributes', () => {
  it('mirrors xterm XParseColor and reply formatting', () => {
    expect(parseXColorSpec('rgb:f/0/a')).toEqual([255, 0, 170])
    expect(parseXColorSpec('#123456')).toEqual([0x12, 0x34, 0x56])
    expect(parseXColorSpec('red')).toBeNull()
    expect(formatXColorRgbSpec([0x12, 0x34, 0x56])).toBe('rgb:1212/3434/5656')
  })

  it('validates the complete 256-color renderer payload', () => {
    expect(validateTerminalViewAttributes(valid())).toEqual(valid())
    expect(validateTerminalViewAttributes({ ...valid(), ansi: [] })).toBeNull()
    expect(validateTerminalViewAttributes({ ...valid(), foreground: [-1, 2, 3] })).toBeNull()
  })

  it('value-compares snapshots so identical re-pushes preserve OSC overrides', () => {
    expect(terminalViewAttributesEqual(valid(), valid())).toBe(true)
    expect(terminalViewAttributesEqual(valid(), { ...valid(), colorSchemeMode: 'light' })).toBe(false)
  })
})
