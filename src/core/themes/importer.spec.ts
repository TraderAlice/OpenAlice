import { describe, expect, it } from 'vitest'

import { importThemeScheme, ThemeImportError } from './importer.js'

const base16 = {
  base00: '101010', base01: '181818', base02: '282828', base03: '585858',
  base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
  base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
  base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
} as const

describe('theme scheme importer', () => {
  it('imports the current YAML shape with the same normalized result as JSON', () => {
    const palette = Object.entries(base16).map(([slot, color]) => `    ${slot}: "#${color}"`).join('\n')
    const preview = importThemeScheme([
      'system: base16',
      'name: Eighties YAML',
      'author: Chris Kempson',
      'variant: dark',
      'palette:',
      palette,
    ].join('\n'), { filename: 'eighties.yaml' })
    expect(preview.format).toBe('tinted-base16')
    expect(preview.family.variants.dark?.palette.base0F).toBe('#a16946')
  })

  it('strictly imports a current Tinted Base16 document', () => {
    const contents = JSON.stringify({
      system: 'base16', name: 'Eighties', author: 'Chris Kempson', variant: 'dark', palette: base16,
    })
    const preview = importThemeScheme(contents, {
      filename: 'eighties.json',
      now: new Date('2026-07-18T01:02:03.000Z'),
    })
    expect(preview.format).toBe('tinted-base16')
    expect(preview.family.id).toBe('imported-eighties-f44540734e')
    expect(preview.family.variants.dark?.palette.base00).toBe('#101010')
    expect(preview.family.variants.dark?.provenance).toMatchObject({
      kind: 'imported', format: 'tinted-base16', sourceName: 'eighties.json', importedAt: '2026-07-18T01:02:03.000Z',
    })
  })

  it('requires an explicit variant for legacy flat Base16', () => {
    const contents = JSON.stringify({ scheme: 'Legacy', author: 'Author', ...base16 })
    expectImportCode(() => importThemeScheme(contents, { filename: 'legacy.json' }), 'legacy_variant_required')
    expect(importThemeScheme(contents, {
      filename: 'legacy.json', legacyVariant: 'light', now: new Date('2026-07-18T00:00:00.000Z'),
    }).family.variants.light?.mode).toBe('light')
  })

  it('imports legacy flat YAML only after the caller supplies its missing variant', () => {
    const colors = Object.entries(base16).map(([slot, color]) => `${slot}: "${color}"`).join('\n')
    const contents = `scheme: Legacy YAML\nauthor: Author\n${colors}\n`
    expectImportCode(() => importThemeScheme(contents, { filename: 'legacy.yaml' }), 'legacy_variant_required')
    expect(importThemeScheme(contents, {
      filename: 'legacy.yaml', legacyVariant: 'dark',
    }).family.variants.dark?.palette.base00).toBe('#101010')
  })

  it('preserves all Base24 extension slots', () => {
    const palette = {
      ...base16,
      base10: '202020', base11: '303030', base12: 'ba1e2e', base13: 'f7ca88',
      base14: 'a1b56c', base15: '86c1b9', base16: '7cafc2', base17: 'ba8baf',
    }
    const preview = importThemeScheme(JSON.stringify({
      system: 'base24', name: 'Extended', author: 'Author', variant: 'dark', palette,
    }), { filename: 'extended.json' })
    expect(preview.format).toBe('tinted-base24')
    expect(preview.family.variants.dark?.palette.base17).toBe('#ba8baf')
  })

  it('returns field diagnostics instead of filling missing or unknown input', () => {
    const { base0F: _missing, ...incomplete } = base16
    expectImportCode(() => importThemeScheme(JSON.stringify({
      system: 'base16', name: 'Bad', author: 'Author', variant: 'dark', palette: incomplete,
    }), { filename: 'bad.json' }), 'unsupported_schema')
    expectImportCode(() => importThemeScheme(JSON.stringify({
      system: 'base32', name: 'Bad', author: 'Author', variant: 'dark', palette: base16,
    }), { filename: 'bad.json' }), 'unsupported_schema')
  })

  it('rejects themes whose semantic token pairs fail contrast', () => {
    expectImportCode(() => importThemeScheme(JSON.stringify({
      system: 'base16', name: 'No contrast', author: 'Author', variant: 'dark',
      palette: { ...base16, base04: '202020', base05: '202020', base0D: '202020' },
    }), { filename: 'bad.json' }), 'contrast_failed')
  })
})

function expectImportCode(run: () => unknown, code: ThemeImportError['code']): void {
  try {
    run()
    throw new Error('Expected import to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeImportError)
    expect((error as ThemeImportError).code).toBe(code)
  }
}
