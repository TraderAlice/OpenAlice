import { describe, expect, it } from 'vitest'
import { build as buildPlist } from 'plist'

import { importThemeScheme, ThemeImportError } from './importer.js'

const base16 = {
  base00: '101010', base01: '181818', base02: '282828', base03: '585858',
  base04: 'b8b8b8', base05: 'd8d8d8', base06: 'e8e8e8', base07: 'f8f8f8',
  base08: 'ab4642', base09: 'dc9656', base0A: 'f7ca88', base0B: 'a1b56c',
  base0C: '86c1b9', base0D: '7cafc2', base0E: 'ba8baf', base0F: 'a16946',
} as const

const terminal = {
  background: '#101010', foreground: '#d8d8d8', cursor: '#e8e8e8',
  selectionBackground: '#585858', selectionForeground: '#f8f8f8',
  colors: [
    '#101010', '#ab4642', '#a1b56c', '#f7ca88', '#7cafc2', '#ba8baf', '#86c1b9', '#d8d8d8',
    '#585858', '#dc9656', '#b5d680', '#ffe0a8', '#9dcfe0', '#d8a9cd', '#a6e1d9', '#f8f8f8',
  ],
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

  it('imports iTerm2 plist and preserves the complete ANSI override', () => {
    const component = (hex: string) => ({
      'Red Component': Number.parseInt(hex.slice(1, 3), 16) / 255,
      'Green Component': Number.parseInt(hex.slice(3, 5), 16) / 255,
      'Blue Component': Number.parseInt(hex.slice(5, 7), 16) / 255,
      'Color Space': 'sRGB',
    })
    const plist: Record<string, ReturnType<typeof component>> = {
      'Background Color': component(terminal.background),
      'Foreground Color': component(terminal.foreground),
      'Cursor Color': component(terminal.cursor),
      'Cursor Text Color': component(terminal.background),
      'Selection Color': component(terminal.selectionBackground),
      'Selected Text Color': component(terminal.selectionForeground),
    }
    terminal.colors.forEach((color, index) => { plist[`Ansi ${index} Color`] = component(color) })
    const preview = importThemeScheme(buildPlist(plist), {
      filename: 'Project Night.itermcolors', legacyVariant: 'dark',
    })
    expect(preview.format).toBe('iterm2')
    expect(preview.family.name).toBe('Project Night')
    expect(preview.family.variants.dark?.ansi16Override?.colors).toEqual(terminal.colors)
    expect(preview.family.variants.dark?.palette).toMatchObject({
      base00: terminal.background,
      base03: terminal.colors[8],
      base05: terminal.foreground,
      base07: terminal.colors[15],
      base08: terminal.colors[1],
      base0F: terminal.colors[13],
    })
  })

  it('imports a strict Windows Terminal scheme', () => {
    const [black, red, green, yellow, blue, purple, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow,
      brightBlue, brightPurple, brightCyan, brightWhite] = terminal.colors
    const preview = importThemeScheme(JSON.stringify({
      name: 'Project Night', background: terminal.background, foreground: terminal.foreground,
      cursorColor: terminal.cursor, selectionBackground: terminal.selectionBackground,
      black, red, green, yellow, blue, purple, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightPurple, brightCyan, brightWhite,
    }), { filename: 'project-night.json', legacyVariant: 'dark' })
    expect(preview.format).toBe('windows-terminal')
    expect(preview.family.variants.dark?.ansi16Override?.colors[14]).toBe(terminal.colors[14])
  })

  it('uses bright black when a Windows Terminal scheme omits its optional selection color', () => {
    const [black, red, green, yellow, blue, purple, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow,
      brightBlue, brightPurple, brightCyan, brightWhite] = terminal.colors
    const preview = importThemeScheme(JSON.stringify({
      name: 'Minimal Windows', background: terminal.background, foreground: terminal.foreground,
      cursorColor: terminal.cursor,
      black, red, green, yellow, blue, purple, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightPurple, brightCyan, brightWhite,
    }), { filename: 'minimal.json', legacyVariant: 'dark' })
    expect(preview.family.variants.dark?.ansi16Override?.selectionBackground).toBe(brightBlack)
  })

  it.each([
    ['YAML', [
      'colors:',
      `  primary: { background: "${terminal.background}", foreground: "${terminal.foreground}" }`,
      `  cursor: { text: "${terminal.background}", cursor: "${terminal.cursor}" }`,
      `  selection: { text: "${terminal.selectionForeground}", background: "${terminal.selectionBackground}" }`,
      `  normal: { black: "${terminal.colors[0]}", red: "${terminal.colors[1]}", green: "${terminal.colors[2]}", yellow: "${terminal.colors[3]}", blue: "${terminal.colors[4]}", magenta: "${terminal.colors[5]}", cyan: "${terminal.colors[6]}", white: "${terminal.colors[7]}" }`,
      `  bright: { black: "${terminal.colors[8]}", red: "${terminal.colors[9]}", green: "${terminal.colors[10]}", yellow: "${terminal.colors[11]}", blue: "${terminal.colors[12]}", magenta: "${terminal.colors[13]}", cyan: "${terminal.colors[14]}", white: "${terminal.colors[15]}" }`,
    ].join('\n'), 'theme.yml'],
    ['TOML', [
      '[colors.primary]', `background = "${terminal.background}"`, `foreground = "${terminal.foreground}"`,
      '[colors.cursor]', `text = "${terminal.background}"`, `cursor = "${terminal.cursor}"`,
      '[colors.selection]', `text = "${terminal.selectionForeground}"`, `background = "${terminal.selectionBackground}"`,
      '[colors.normal]', ...namedToml(terminal.colors.slice(0, 8)),
      '[colors.bright]', ...namedToml(terminal.colors.slice(8, 16)),
    ].join('\n'), 'theme.toml'],
  ])('imports strict Alacritty %s', (_syntax, contents, filename) => {
    const preview = importThemeScheme(contents, { filename, legacyVariant: 'dark' })
    expect(preview.format).toBe('alacritty')
    expect(preview.family.variants.dark?.ansi16Override?.selectionForeground)
      .toBe(terminal.selectionForeground)
  })

  it.each([
    ['Kitty', [
      `background ${terminal.background}`, `foreground ${terminal.foreground}`,
      `cursor ${terminal.cursor}`, `cursor_text_color ${terminal.background}`,
      `selection_background ${terminal.selectionBackground}`,
      `selection_foreground ${terminal.selectionForeground}`,
      ...terminal.colors.map((color, index) => `color${index} ${color}`),
    ].join('\n')],
    ['Ghostty', [
      `background = ${terminal.background}`, `foreground = ${terminal.foreground}`,
      `cursor-color = ${terminal.cursor}`, `selection-background = ${terminal.selectionBackground}`,
      `selection-foreground = ${terminal.selectionForeground}`,
      ...terminal.colors.map((color, index) => `palette = ${index}=${color}`),
    ].join('\n')],
  ])('imports strict %s terminal text', (_dialect, contents) => {
    const preview = importThemeScheme(contents, { filename: 'project.conf', legacyVariant: 'dark' })
    expect(preview.format).toBe('kitty-ghostty')
    expect(preview.family.variants.dark?.ansi16Override?.colors).toEqual(terminal.colors)
  })

  it('imports an Xresources table without inventing a second ANSI mapping', () => {
    const contents = [
      `*.background: ${terminal.background}`, `*.foreground: ${terminal.foreground}`,
      `*.cursorColor: ${terminal.cursor}`,
      ...terminal.colors.map((color, index) => `*.color${index}: ${color}`),
    ].join('\n')
    const preview = importThemeScheme(contents, { filename: 'Xresources', legacyVariant: 'dark' })
    expect(preview.format).toBe('xresources')
    expect(preview.family.variants.dark?.ansi16Override?.selectionBackground).toBe(terminal.colors[8])
    expect(preview.family.variants.dark?.palette.base0D).toBe(terminal.colors[4])
  })

  it('rejects case-insensitive duplicate Xresources keys', () => {
    const contents = [
      `*.background: ${terminal.background}`, `*.BACKGROUND: ${terminal.background}`,
    ].join('\n')
    expectImportCode(() => importThemeScheme(contents, {
      filename: 'Xresources', legacyVariant: 'dark',
    }), 'unsupported_schema')
  })

  it('requires an explicit variant for every ANSI-only input', () => {
    const [black, red, green, yellow, blue, purple, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow,
      brightBlue, brightPurple, brightCyan, brightWhite] = terminal.colors
    expectImportCode(() => importThemeScheme(JSON.stringify({
      name: 'No mode', background: terminal.background, foreground: terminal.foreground,
      cursorColor: terminal.cursor, selectionBackground: terminal.selectionBackground,
      black, red, green, yellow, blue, purple, cyan, white,
      brightBlack, brightRed, brightGreen, brightYellow, brightBlue, brightPurple, brightCyan, brightWhite,
    }), { filename: 'no-mode.json' }), 'variant_required')
  })

  it('rejects duplicate terminal keys and incomplete or invalid tables', () => {
    expectImportCode(() => importThemeScheme([
      `background ${terminal.background}`, `background ${terminal.background}`,
    ].join('\n'), { filename: 'duplicate.conf', legacyVariant: 'dark' }), 'unsupported_schema')
    expectImportCode(() => importThemeScheme([
      `background ${terminal.background}`, `foreground ${terminal.foreground}`, `cursor ${terminal.cursor}`,
      ...terminal.colors.slice(0, 15).map((color, index) => `color${index} ${color}`),
    ].join('\n'), { filename: 'missing.conf', legacyVariant: 'dark' }), 'unsupported_schema')
    expectImportCode(() => importThemeScheme([
      `background ${terminal.background}`, `foreground ${terminal.foreground}`, `cursor ${terminal.cursor}`,
      ...terminal.colors.map((color, index) => `color${index} ${index === 4 ? 'transparent' : color}`),
    ].join('\n'), { filename: 'invalid.conf', legacyVariant: 'dark' }), 'unsupported_schema')
    try {
      importThemeScheme([
        `background ${terminal.background}`, `foreground ${terminal.foreground}`, `cursor ${terminal.cursor}`,
        ...terminal.colors.map((color, index) => `color${index} ${index === 4 ? 'transparent' : color}`),
      ].join('\n'), { filename: 'invalid.conf', legacyVariant: 'dark' })
    } catch (error) {
      expect((error as ThemeImportError).diagnostics).toContainEqual(expect.objectContaining({ path: 'color4' }))
    }
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

function namedToml(colors: readonly string[]): string[] {
  return ansiNamesForTest.map((name, index) => `${name} = "${colors[index]}"`)
}

const ansiNamesForTest = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

function expectImportCode(run: () => unknown, code: ThemeImportError['code']): void {
  try {
    run()
    throw new Error('Expected import to fail')
  } catch (error) {
    expect(error).toBeInstanceOf(ThemeImportError)
    expect((error as ThemeImportError).code).toBe(code)
  }
}
