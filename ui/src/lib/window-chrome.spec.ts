import { describe, expect, it } from 'vitest'
import { captionInsets, opaqueHex } from './window-chrome'

describe('captionInsets', () => {
  const safe = { x: 0, y: 0, width: 1142, height: 44 }
  it('reserves only the rightmost split panel, not the conversation or lower toolbar', () => {
    expect(captionInsets({ x: 260, y: 0, width: 500, height: 44 }, safe)).toEqual({ left: 0, right: 0, caption: true })
    expect(captionInsets({ x: 760, y: 0, width: 520, height: 44 }, safe)).toEqual({ left: 0, right: 138, caption: true })
    expect(captionInsets({ x: 760, y: 44, width: 520, height: 44 }, safe)).toEqual({ left: 0, right: 0, caption: false })
  })
  it('uses reported geometry for narrow/high-DPI windows and left-side controls', () => {
    expect(captionInsets({ x: 0, y: 0, width: 600, height: 48 }, { x: 0, y: 0, width: 450, height: 44 }).right).toBe(150)
    expect(captionInsets({ x: 0, y: 0, width: 600, height: 44 }, { x: 138, y: 0, width: 462, height: 44 }).left).toBe(138)
  })
  it('releases caption space in fullscreen or for hidden headers', () => {
    expect(captionInsets({ x: 0, y: 0, width: 1280, height: 44 }, null)).toEqual({ left: 0, right: 0, caption: false })
    expect(captionInsets({ x: 0, y: 0, width: 0, height: 0 }, safe).caption).toBe(false)
  })
})

it('uses opaque surface colors and skips transparent layers', () => {
  expect(opaqueHex('rgb(250, 249, 246)')).toBe('#faf9f6')
  expect(opaqueHex('rgba(0, 0, 0, 0)')).toBeNull()
  expect(opaqueHex('rgba(20, 30, 40, 0.4)')).toBeNull()
  expect(opaqueHex('#eeeeee')).toBe('#eeeeee')
})
