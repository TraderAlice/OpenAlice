import { describe, expect, it } from 'vitest'

import { displayWidth } from './supervisor-display.ts'

describe('Supervisor terminal display width', () => {
  it('keeps text-presentation symbols in one terminal cell', () => {
    expect(displayWidth('▶')).toBe(1)
    expect(displayWidth('©')).toBe(1)
    expect(displayWidth('⚠')).toBe(1)
  })

  it('reserves two cells for default or explicit emoji presentation', () => {
    expect(displayWidth('😀')).toBe(2)
    expect(displayWidth('❤️')).toBe(2)
    expect(displayWidth('1️⃣')).toBe(2)
  })

  it('retains double-width East Asian text', () => {
    expect(displayWidth('爱')).toBe(2)
  })
})
