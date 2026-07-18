import { describe, expect, it } from 'vitest'

import {
  contrastRatio,
  mixOklab,
  normalizeRgbHex,
  resolveThemeTokens,
  TerminalThemeContrastError,
  ThemeContrastError,
  validateTerminalThemeContrast,
} from './colors.js'
import type { ThemePalette } from './types.js'

const palette: ThemePalette = {
  base00: '#101010', base01: '#181818', base02: '#282828', base03: '#585858',
  base04: '#b8b8b8', base05: '#d8d8d8', base06: '#e8e8e8', base07: '#f8f8f8',
  base08: '#ab4642', base09: '#dc9656', base0A: '#f7ca88', base0B: '#a1b56c',
  base0C: '#86c1b9', base0D: '#7cafc2', base0E: '#ba8baf', base0F: '#a16946',
}

describe('theme colors', () => {
  it('normalizes opaque RGB and rejects alpha or shorthand', () => {
    expect(normalizeRgbHex('AABBCC')).toBe('#aabbcc')
    expect(() => normalizeRgbHex('#abc')).toThrow('six-digit')
    expect(() => normalizeRgbHex('#aabbccdd')).toThrow('six-digit')
  })

  it('mixes deterministically in OKLab', () => {
    expect(mixOklab('#000000', '#ffffff', 0.5)).toBe('#636363')
    expect(mixOklab('#ff0000', '#0000ff', 0.5)).toBe('#8c53a2')
  })

  it('resolves semantic and derived tokens with verified contrast', () => {
    const tokens = resolveThemeTokens(palette)
    expect(tokens.pageBackground).toBe('#101010')
    expect(tokens.accent).toBe('#7cafc2')
    expect(tokens.onAccent).toBe('#101010')
    expect(contrastRatio(tokens.bodyText, tokens.pageBackground)).toBeGreaterThan(4.5)
    expect(tokens.hoverSurface).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('reports exact token pairs when a theme is unusable', () => {
    expect(() => resolveThemeTokens({
      ...palette,
      base04: '#222222',
      base05: '#222222',
      base0D: '#222222',
    })).toThrow(ThemeContrastError)
  })

  it('validates terminal foreground, cursor, and selection pairs without changing colors', () => {
    const colors = {
      foreground: '#f0f0f0', background: '#101010', cursor: '#80c0ff',
      selectionForeground: '#ffffff', selectionBackground: '#303060',
    } as const
    expect(() => validateTerminalThemeContrast(colors)).not.toThrow()
    expect(colors).toEqual({
      foreground: '#f0f0f0', background: '#101010', cursor: '#80c0ff',
      selectionForeground: '#ffffff', selectionBackground: '#303060',
    })
  })

  it('reports every unusable terminal pair', () => {
    expect(() => validateTerminalThemeContrast({
      foreground: '#777777', background: '#777777', cursor: '#777777',
      selectionForeground: '#888888', selectionBackground: '#888888',
    })).toThrow(TerminalThemeContrastError)
    try {
      validateTerminalThemeContrast({
        foreground: '#777777', background: '#777777', cursor: '#777777',
        selectionForeground: '#888888', selectionBackground: '#888888',
      })
    } catch (error) {
      expect((error as TerminalThemeContrastError).failures.map((failure) => (
        `${failure.foreground}/${failure.background}`
      ))).toEqual([
        'foreground/background', 'cursor/background', 'selectionForeground/selectionBackground',
      ])
    }
  })
})
