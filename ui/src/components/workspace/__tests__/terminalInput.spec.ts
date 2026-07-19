import { describe, expect, it } from 'vitest'

import {
  describeTerminalInput,
  TERMINAL_FONT_FAMILY,
} from '../terminalInput'

describe('terminal input helpers', () => {
  it('keeps CJK-capable fallback fonts in the terminal stack', () => {
    expect(TERMINAL_FONT_FAMILY).toContain('Noto Sans Mono CJK SC')
    expect(TERMINAL_FONT_FAMILY).toContain('PingFang SC')
  })

  it('diagnoses fullwidth punctuation without normalizing it to ASCII', () => {
    expect(describeTerminalInput('，。,.')).toBe('，=U+FF0C 。=U+3002 ,=U+002C .=U+002E')
  })
})
