import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  THEME_PALETTES,
  paletteAppearance,
  resolveEffectivePalette,
  resolveEffectiveSlot,
  type ThemePaletteId,
} from './palettes'

const repoRoot = basename(process.cwd()) === 'ui' ? resolve(process.cwd(), '..') : process.cwd()
const uiRoot = resolve(repoRoot, 'ui')
const palette = readFileSync(resolve(uiRoot, 'src/theme/palette.css'), 'utf8')
const indexCss = readFileSync(resolve(uiRoot, 'src/index.css'), 'utf8')

const CORE_TOKENS = [
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'primary',
  'primary-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
] as const

const PALETTE_IDS: readonly ThemePaletteId[] = [
  'paper', 'porcelain', 'linen', 'graphite', 'midnight', 'moss', 'iris',
]

const ALLOWED_LITERAL_COLOR_FILES = new Set([
  // Single product color authority.
  resolve(uiRoot, 'src/theme/palette.css'),
  // An origin-less document has no access to parent CSS variables; these are
  // safe fallback colors for unstyled agent-authored HTML, not app chrome.
  resolve(uiRoot, 'src/components/HtmlReportView.tsx'),
])

function productionStyleFiles(directory: string): string[] {
  const output: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === '__tests__') continue
      output.push(...productionStyleFiles(path))
      continue
    }
    if (!['.css', '.ts', '.tsx'].includes(extname(entry.name))) continue
    if (/\.(?:spec|test)\./.test(entry.name)) continue
    output.push(path)
  }
  return output
}

function withoutComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
}

function paletteBlock(id: ThemePaletteId): string {
  const block = palette.match(new RegExp(`\\[data-palette-preview="${id}"\\]\\s*\\{([\\s\\S]*?)\\n\\}`))?.[1]
  expect(block, `missing ${id} palette`).toBeDefined()
  return block!
}

function paletteToken(id: ThemePaletteId, token: string): string {
  const value = paletteBlock(id).match(new RegExp(`--${token}:\\s*([^;]+);`))?.[1]?.trim()
  expect(value, `${id}: --${token}`).toBeDefined()
  return value!
}

function hexContrast(a: string, b: string): number {
  const luminance = (hex: string): number => {
    expect(hex).toMatch(/^#[\da-f]{6}$/i)
    const channels = [1, 3, 5].map((start) => {
      const value = Number.parseInt(hex.slice(start, start + 2), 16) / 255
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
    })
    return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722
  }
  const [lighter, darker] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (lighter! + 0.05) / (darker! + 0.05)
}

describe('semantic color contract', () => {
  it('ships one universal library with seven complete semantic cards', () => {
    expect(THEME_PALETTES.map(({ id }) => id)).toEqual(PALETTE_IDS)
    expect(THEME_PALETTES.map(({ appearance }) => appearance)).toEqual([
      'light', 'light', 'light', 'dark', 'dark', 'dark', 'dark',
    ])
    expect(new Set(PALETTE_IDS).size).toBe(7)

    for (const id of PALETTE_IDS) {
      const block = paletteBlock(id)
      for (const token of CORE_TOKENS) {
        expect(block, `${id}: --${token}`).toContain(`--${token}:`)
        expect(indexCss, token).toContain(`--color-${token}: var(--${token});`)
      }
    }
  })

  it('keeps every semantic token symmetric across all seven cards', () => {
    const tokens = [...paletteBlock('paper').matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1])
    expect(tokens.length).toBeGreaterThan(CORE_TOKENS.length)

    for (const id of PALETTE_IDS) {
      const cardTokens = [...paletteBlock(id).matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1])
      expect(cardTokens.sort(), id).toEqual([...tokens].sort())
    }
  })

  it('keeps all visible palette preview signatures distinct', () => {
    const previewTokens = [
      'background',
      'secondary',
      'primary',
      'success',
      'warning',
      'destructive',
      'ai-action',
      'terminal-background',
      'terminal-red',
      'terminal-green',
      'terminal-blue',
      'terminal-magenta',
      'terminal-cyan',
    ]
    const signatures = PALETTE_IDS.map((id) => previewTokens.map((token) => paletteToken(id, token)).join('|'))

    expect(new Set(signatures).size).toBe(PALETTE_IDS.length)
    expect(palette).toContain('[data-palette-preview][data-selected="true"]')
    expect(palette).toContain('.oa-palette-preview-terminal')
  })

  it('keeps the new product and ANSI text roles at normal-text contrast', () => {
    const ansiTokens = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const
    for (const id of ['linen', 'moss', 'iris'] as const) {
      expect(hexContrast(paletteToken(id, 'foreground'), paletteToken(id, 'background')), id).toBeGreaterThanOrEqual(4.5)
      expect(hexContrast(paletteToken(id, 'muted-foreground'), paletteToken(id, 'background')), id).toBeGreaterThanOrEqual(4.5)
      expect(hexContrast(paletteToken(id, 'primary-foreground'), paletteToken(id, 'primary')), id).toBeGreaterThanOrEqual(4.5)
      expect(hexContrast(paletteToken(id, 'terminal-foreground'), paletteToken(id, 'terminal-background')), id).toBeGreaterThanOrEqual(4.5)
      for (const token of ansiTokens) {
        expect(
          hexContrast(paletteToken(id, `terminal-${token}`), paletteToken(id, 'terminal-background')),
          `${id}: terminal-${token}`,
        ).toBeGreaterThanOrEqual(4.5)
      }
    }
  })

  it('assigns any palette to either preference slot', () => {
    expect(resolveEffectiveSlot('auto', false)).toBe('day')
    expect(resolveEffectiveSlot('auto', true)).toBe('night')
    expect(resolveEffectiveSlot('day', true)).toBe('day')
    expect(resolveEffectiveSlot('night', false)).toBe('night')
    expect(resolveEffectivePalette('auto', false, 'porcelain', 'midnight')).toBe('porcelain')
    expect(resolveEffectivePalette('auto', true, 'porcelain', 'midnight')).toBe('midnight')
    expect(resolveEffectivePalette('day', true, 'midnight', 'paper')).toBe('midnight')
    expect(resolveEffectivePalette('night', false, 'midnight', 'paper')).toBe('paper')
    expect(resolveEffectivePalette('day', false, 'moss', 'linen')).toBe('moss')
    expect(resolveEffectivePalette('night', true, 'iris', 'linen')).toBe('linen')
    expect(paletteAppearance('midnight')).toBe('dark')
    expect(paletteAppearance('paper')).toBe('light')
    expect(paletteAppearance('linen')).toBe('light')
    expect(paletteAppearance('moss')).toBe('dark')
    expect(paletteAppearance('iris')).toBe('dark')
    expect(palette).not.toMatch(/data-theme|prefers-color-scheme/)
  })

  it('keeps literal product colors in the color card', () => {
    const files = [
      ...productionStyleFiles(resolve(uiRoot, 'src')),
      resolve(repoRoot, 'packages/uta-protocol/src/brokers/preset-catalog.ts'),
    ]
    const violations: string[] = []
    const literalColor = /#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})\b|\b(?:rgb|rgba|hsl|hsla|oklch)\(/i

    for (const file of files) {
      if (ALLOWED_LITERAL_COLOR_FILES.has(file)) continue
      if (literalColor.test(withoutComments(readFileSync(file, 'utf8')))) {
        violations.push(file.replace(`${repoRoot}/`, ''))
      }
    }

    expect(violations).toEqual([])
  })

  it('rejects legacy OpenAlice names and palette-specific utility colors', () => {
    const files = [
      ...productionStyleFiles(resolve(uiRoot, 'src')),
      resolve(repoRoot, 'packages/uta-protocol/src/brokers/preset-catalog.ts'),
    ]
    const violations: string[] = []
    const legacyToken = /--color-(?:bg|text|green|red|purple|overlay|notification)(?:-|\b)/
    const legacyUtility = /\b(?:bg-bg(?:-secondary|-tertiary)?|text-text(?:-muted)?|text-bg|(?:bg|text|border|ring|fill|stroke)-(?:red|rose|green|emerald|lime|yellow|amber|orange|blue|sky|cyan|purple|violet|fuchsia)(?:-\d{2,3})?)(?:\/[^\s'"`]+)?\b/

    for (const file of files) {
      const source = withoutComments(readFileSync(file, 'utf8'))
      if (legacyToken.test(source) || legacyUtility.test(source)) {
        violations.push(file.replace(`${repoRoot}/`, ''))
      }
    }

    expect(violations).toEqual([])
  })
})
