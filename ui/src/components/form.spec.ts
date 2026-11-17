import { describe, expect, it } from 'vitest'
import { inputClass, isImeComposing } from './form'

describe('form helpers', () => {
  it('detects active IME composition across Chromium and Safari WebKit 229', () => {
    expect(isImeComposing({ nativeEvent: { isComposing: true, keyCode: 13 }, keyCode: 13 })).toBe(true)
    expect(isImeComposing({ nativeEvent: { isComposing: false, keyCode: 229 }, keyCode: 13 })).toBe(true)
    expect(isImeComposing({ nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 229 })).toBe(true)
    expect(isImeComposing({ nativeEvent: { isComposing: false, keyCode: 13 }, keyCode: 13 })).toBe(false)
    expect(isImeComposing({ nativeEvent: {} })).toBe(false)
  })

  it('uses user-invalid instead of eager invalid border styling on shared inputs', () => {
    expect(inputClass).toContain('user-invalid:border-destructive')
    expect(inputClass).not.toMatch(/(?:^|\s)invalid:border-destructive(?:\s|$)/)
  })
})
