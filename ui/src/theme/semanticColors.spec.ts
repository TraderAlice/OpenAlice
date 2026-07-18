import { readdirSync, readFileSync } from 'node:fs'
import { basename, extname, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

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

describe('semantic color contract', () => {
  it('defines the Orca/shadcn core vocabulary for light, dark, and auto-dark', () => {
    for (const token of CORE_TOKENS) {
      expect(palette.match(new RegExp(`--${token}:`, 'g'))?.length, token).toBe(3)
      expect(indexCss, token).toContain(`--color-${token}: var(--${token});`)
    }
  })

  it('keeps every palette token symmetric across light, dark, and auto-dark', () => {
    const lightBlock = palette.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1]
    expect(lightBlock).toBeDefined()

    const tokens = [...lightBlock!.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1])
    expect(tokens.length).toBeGreaterThan(CORE_TOKENS.length)

    for (const token of tokens) {
      expect(palette.match(new RegExp(`${token}:`, 'g'))?.length, token).toBe(3)
    }
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
