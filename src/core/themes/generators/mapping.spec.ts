import { describe, expect, it } from 'vitest'

import {
  parseHellwalOutput,
  parseMatugenOutput,
  ThemeGeneratorOutputError,
} from './mapping.js'

const tones = {
  neutral: {
    0: '#000000', 10: '#1c1b1e', 15: '#272529', 20: '#313033',
    90: '#e6e1e6', 95: '#f4eff4', 98: '#fdf8fd', 100: '#ffffff',
  },
  neutral_variant: { 40: '#615d66', 60: '#948f99', 70: '#afa9b4' },
  error: { 30: '#93000a', 40: '#ba1a1a', 70: '#ff897d', 80: '#ffb4ab' },
  primary: { 30: '#4f378a', 40: '#6750a4', 70: '#b69df8', 80: '#cfbcff' },
  secondary: { 30: '#4a4458', 40: '#625b71', 70: '#b0a7c0', 80: '#cbc2db' },
  tertiary: { 30: '#633b48', 40: '#7e5260', 70: '#d29dad', 80: '#efb8c8' },
} as const

function matugenOutput(base16 = { base00: '#ff00ff' }): string {
  return JSON.stringify({
    colors: { background: { color: '#ffffff' } },
    palettes: Object.fromEntries(Object.entries(tones).map(([name, palette]) => [
      name,
      Object.fromEntries(Object.entries(palette).map(([tone, color]) => [tone, { color }])),
    ])),
    base16,
  })
}

const ansi = [
  '#101010', '#ab4642', '#a1b56c', '#f7ca88', '#7cafc2', '#ba8baf', '#86c1b9', '#d8d8d8',
  '#585858', '#dc9656', '#b5d680', '#ffe0a8', '#9dcfe0', '#d8a9cd', '#a6e1d9', '#f8f8f8',
] as const

function hellwalOutput(): string {
  return JSON.stringify({
    wallpaper: '/untrusted/source.png',
    special: { background: '#101010', foreground: '#D8D8D8', cursor: 'E8E8E8', border: '#d8d8d8' },
    colors: Object.fromEntries(ansi.map((color, index) => [`color${index}`, color])),
  })
}

describe('theme generator output mappings', () => {
  it('maps every Matugen v1 light slot and ignores its competing base16 projection', () => {
    const result = parseMatugenOutput(matugenOutput(), 'light')
    expect(Object.values(result.palette)).toEqual([
      '#fdf8fd', '#f4eff4', '#e6e1e6', '#948f99', '#615d66', '#313033', '#1c1b1e', '#000000',
      '#ba1a1a', '#633b48', '#4a4458', '#4f378a', '#625b71', '#6750a4', '#7e5260', '#93000a',
    ])
    expect(result.palette.base00).not.toBe('#ff00ff')
    expect(result.tokens.pageBackground).toBe(result.palette.base00)
    expect(result.ansi16Override).toBeUndefined()
  })

  it('maps every Matugen v1 dark slot independently of the light projection', () => {
    const result = parseMatugenOutput(matugenOutput({ base00: '#00ff00' }), 'dark')
    expect(Object.values(result.palette)).toEqual([
      '#1c1b1e', '#272529', '#313033', '#948f99', '#afa9b4', '#e6e1e6', '#f4eff4', '#ffffff',
      '#ffb4ab', '#d29dad', '#b0a7c0', '#b69df8', '#cbc2db', '#cfbcff', '#efb8c8', '#ff897d',
    ])
    expect(result.tokens.accent).toBe('#cfbcff')
  })

  it.each([
    ['invalid JSON', '{', 'invalid-json'],
    ['missing colors', JSON.stringify({ palettes: {} }), 'invalid-output'],
    ['missing selected tone', JSON.stringify({ ...JSON.parse(matugenOutput()), palettes: { ...JSON.parse(matugenOutput()).palettes, neutral: {} } }), 'invalid-output'],
    ['invalid selected color', matugenOutput().replace('#fdf8fd', '#fff'), 'invalid-output'],
  ])('rejects Matugen %s', (_case, raw, code) => {
    expectErrorCode(() => parseMatugenOutput(raw, 'light'), code)
  })

  it('projects complete Hellwal ANSI through the shared OKLab mapping with explicit defaults', () => {
    const result = parseHellwalOutput(hellwalOutput())
    expect(result.ansi16Override).toEqual({
      background: '#101010', foreground: '#d8d8d8', cursor: '#e8e8e8',
      cursorText: '#101010', selectionBackground: '#585858', selectionForeground: '#d8d8d8',
      colors: ansi,
    })
    expect(result.palette).toEqual({
      base00: '#101010', base01: '#262626', base02: '#3e3e3e', base03: '#585858',
      base04: '#959595', base05: '#d8d8d8', base06: '#e8e8e8', base07: '#f8f8f8',
      base08: '#ab4642', base09: '#dc9656', base0A: '#f7ca88', base0B: '#a1b56c',
      base0C: '#86c1b9', base0D: '#7cafc2', base0E: '#ba8baf', base0F: '#d8a9cd',
    })
    expect(result.tokens.accent).toBe('#7cafc2')
  })

  it.each([
    ['missing special', JSON.stringify({ colors: {} })],
    ['incomplete ANSI table', hellwalOutput().replace('"color15":"#f8f8f8"', '"missing":"#f8f8f8"')],
    ['transparent color', hellwalOutput().replace('#7cafc2', '#7cafc280')],
  ])('rejects Hellwal %s', (_case, raw) => {
    expectErrorCode(() => parseHellwalOutput(raw), 'invalid-output')
  })
})

function expectErrorCode(run: () => unknown, expected: string): void {
  try {
    run()
    throw new Error('Expected generator output mapping to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeGeneratorOutputError)
    expect((error as ThemeGeneratorOutputError).code).toBe(expected)
  }
}
