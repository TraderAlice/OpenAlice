import type {
  Ansi16Override,
  ImportedThemeFormat,
  ResolvedThemeTokens,
  ThemeFamily,
  ThemeGeneratorDetectionSnapshot,
  ThemeGeneratorId,
  ThemePalette,
  ThemeVariantMode,
} from '../../api/themes'

const palette: ThemePalette = {
  base00: '#101216', base01: '#181b20', base02: '#252a32', base03: '#343b46',
  base04: '#8993a4', base05: '#d7dce5', base06: '#edf0f5', base07: '#ffffff',
  base08: '#ef6b73', base09: '#e89b58', base0A: '#dfc66d', base0B: '#75c991',
  base0C: '#6ecaca', base0D: '#75a7f0', base0E: '#b39df3', base0F: '#d18cba',
}

const lightPalette: ThemePalette = {
  ...palette,
  base00: '#f8f9fb', base01: '#eef1f5', base02: '#dfe4eb', base03: '#cbd2dc',
  base04: '#596579', base05: '#293448', base06: '#172136', base07: '#08101d',
}

const tokens = (p: ThemePalette): ResolvedThemeTokens => ({
  pageBackground: p.base00, secondarySurface: p.base01, cardSurface: p.base02,
  border: p.base03, mutedText: p.base04, bodyText: p.base05, strongText: p.base06,
  highestContrastText: p.base07, danger: p.base08, orange: p.base09, warning: p.base0A,
  success: p.base0B, info: p.base0C, accent: p.base0D, secondaryAccent: p.base0E,
  special: p.base0F, onAccent: p.base00, hoverSurface: p.base02, activeSurface: p.base03,
  selection: p.base02, focusRing: p.base0D, subtleSurface: p.base01,
  chartGrid: p.base03, overlay: p.base01,
})

const ansi16: Ansi16Override = {
  foreground: palette.base05, background: palette.base00, cursor: palette.base05,
  cursorText: palette.base00, selectionBackground: palette.base02,
  selectionForeground: palette.base06,
  colors: [palette.base00, palette.base08, palette.base0B, palette.base0A,
    palette.base0D, palette.base0E, palette.base0C, palette.base05,
    palette.base03, '#ff8790', '#91e6aa', '#f8df86', '#91bdff', '#cdb7ff', '#8be5e5', palette.base07],
}

export function demoThemeFamily(
  format: ImportedThemeFormat,
  name: string,
  modes: readonly ThemeVariantMode[] = ['dark'],
): ThemeFamily {
  const slug = `demo-${format}-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`
  const family: ThemeFamily = { schemaVersion: 1, id: slug, name, variants: {} }
  for (const mode of modes) {
    const p = mode === 'light' ? lightPalette : palette
    family.variants[mode] = {
      id: `${slug}-${mode}`, name: `${name} ${mode === 'light' ? 'Light' : 'Dark'}`, mode,
      palette: p,
      ...(format === 'iterm2' || format === 'windows-terminal' || format === 'alacritty'
        || format === 'kitty-ghostty' || format === 'xresources' ? { ansi16Override: ansi16 } : {}),
      provenance: {
        kind: 'imported', format, sourceName: name, author: 'OpenAlice demo',
        contentSha256: format.padEnd(64, '0').slice(0, 64).replace(/[^0-9a-f]/g, 'a'),
        importedAt: '2026-07-18T00:00:00.000Z', mappingVersion: 1,
      },
      tokens: tokens(p), createdAt: '2026-07-18T00:00:00.000Z',
    }
  }
  return family
}

export const demoGeneratorDetectionIds = {
  matugen: '11111111-1111-4111-8111-111111111111',
  hellwal: '22222222-2222-4222-8222-222222222222',
} as const

export function demoGeneratedThemeFamily(
  generator: ThemeGeneratorId,
  name: string,
  modes: readonly ThemeVariantMode[],
  parameters: Readonly<Record<string, string | number>>,
): ThemeFamily {
  const family = demoThemeFamily('tinted-base16', name, modes)
  family.id = `demo-generated-${generator}-${modes.join('-')}`
  for (const mode of modes) {
    const variant = family.variants[mode]!
    variant.id = `${family.id}-${mode}`
    variant.provenance = {
      kind: 'generated', generator,
      executablePath: generator === 'matugen' ? '/demo/bin/matugen' : '/demo/bin/hellwal',
      executableVersion: generator === 'matugen' ? 'matugen 4.1.0' : '1.0.7',
      imageSha256: 'd'.repeat(64), parameters: { ...parameters, mode },
      generatedAt: '2026-07-18T00:00:00.000Z', mappingVersion: 1,
    }
  }
  return family
}

export const demoGeneratorSnapshots = {
  available: {
    refreshedAt: '2026-07-18T00:00:00.000Z',
    generators: {
      matugen: {
        kind: 'available', generator: 'matugen', detectionId: demoGeneratorDetectionIds.matugen,
        executablePath: '/demo/bin/matugen', version: 'matugen 4.1.0', binarySha256: 'a'.repeat(64),
        capabilities: { kind: 'matugen', dryRunJson: true, modes: ['light', 'dark'], schemes: ['tonal-spot', 'vibrant'] },
      },
      hellwal: {
        kind: 'available', generator: 'hellwal', detectionId: demoGeneratorDetectionIds.hellwal,
        executablePath: '/demo/bin/hellwal', version: '1.0.7', binarySha256: 'b'.repeat(64),
        capabilities: { kind: 'hellwal', json: true, noCache: true, skipTermColors: true, modes: ['light', 'dark'], offsets: ['dark', 'bright'] },
      },
    },
  },
  unavailable: {
    refreshedAt: '2026-07-18T00:00:00.000Z',
    generators: {
      matugen: { kind: 'unavailable', generator: 'matugen', reason: 'not-on-path' },
      hellwal: { kind: 'unavailable', generator: 'hellwal', reason: 'not-on-path' },
    },
  },
  unsupported: {
    refreshedAt: '2026-07-18T00:00:00.000Z',
    generators: {
      matugen: { kind: 'unsupported', generator: 'matugen', executablePath: '/demo/bin/matugen', reason: 'missing required image capability' },
      hellwal: { kind: 'unsupported', generator: 'hellwal', executablePath: '/demo/bin/hellwal', reason: 'missing --no-cache' },
    },
  },
} as const satisfies Readonly<Record<string, ThemeGeneratorDetectionSnapshot>>

export interface DemoThemeImportFixture {
  filename: string
  contents: string
  format?: ImportedThemeFormat
  invalid?: true
}

const base16Source = {
  base00: '101216', base01: '181b20', base02: '252a32', base03: '343b46',
  base04: '8993a4', base05: 'd7dce5', base06: 'edf0f5', base07: 'ffffff',
  base08: 'ef6b73', base09: 'e89b58', base0A: 'dfc66d', base0B: '75c991',
  base0C: '6ecaca', base0D: '75a7f0', base0E: 'b39df3', base0F: 'd18cba',
} as const

const base24Source = {
  ...base16Source,
  base10: '111318', base11: '0a0b0e', base12: 'ff8790', base13: 'f8df86',
  base14: '91e6aa', base15: '8be5e5', base16: '91bdff', base17: 'cdb7ff',
} as const

const terminalColors = ansi16.colors
const namedAnsi = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'] as const

function yamlPalette(source: Record<string, string>, indent = ''): string {
  return Object.entries(source).map(([slot, color]) => `${indent}${slot}: "#${color}"`).join('\n')
}

function plistColor(color: string): string {
  const component = (offset: number) => Number.parseInt(color.slice(offset, offset + 2), 16) / 255
  return `<dict><key>Red Component</key><real>${component(1)}</real><key>Green Component</key><real>${component(3)}</real><key>Blue Component</key><real>${component(5)}</real><key>Color Space</key><string>sRGB</string></dict>`
}

const itermEntries = [
  ['Background Color', ansi16.background], ['Foreground Color', ansi16.foreground],
  ['Cursor Color', ansi16.cursor], ['Cursor Text Color', ansi16.cursorText],
  ['Selection Color', ansi16.selectionBackground], ['Selected Text Color', ansi16.selectionForeground],
  ...terminalColors.map((color, index) => [`Ansi ${index} Color`, color] as const),
].map(([key, color]) => `<key>${key}</key>${plistColor(color)}`).join('')

const alacrittyYaml = [
  'colors:',
  `  primary: { background: "${ansi16.background}", foreground: "${ansi16.foreground}" }`,
  `  cursor: { text: "${ansi16.cursorText}", cursor: "${ansi16.cursor}" }`,
  `  selection: { text: "${ansi16.selectionForeground}", background: "${ansi16.selectionBackground}" }`,
  `  normal: { ${namedAnsi.map((name, index) => `${name}: "${terminalColors[index]}"`).join(', ')} }`,
  `  bright: { ${namedAnsi.map((name, index) => `${name}: "${terminalColors[index + 8]}"`).join(', ')} }`,
].join('\n')

const alacrittyToml = [
  '[colors.primary]', `background = "${ansi16.background}"`, `foreground = "${ansi16.foreground}"`,
  '[colors.cursor]', `text = "${ansi16.cursorText}"`, `cursor = "${ansi16.cursor}"`,
  '[colors.selection]', `text = "${ansi16.selectionForeground}"`, `background = "${ansi16.selectionBackground}"`,
  '[colors.normal]', ...namedAnsi.map((name, index) => `${name} = "${terminalColors[index]}"`),
  '[colors.bright]', ...namedAnsi.map((name, index) => `${name} = "${terminalColors[index + 8]}"`),
].join('\n')

const kitty = [
  `background ${ansi16.background}`, `foreground ${ansi16.foreground}`,
  `cursor ${ansi16.cursor}`, `cursor_text_color ${ansi16.cursorText}`,
  `selection_background ${ansi16.selectionBackground}`, `selection_foreground ${ansi16.selectionForeground}`,
  ...terminalColors.map((color, index) => `color${index} ${color}`),
].join('\n')

const ghostty = [
  `background = ${ansi16.background}`, `foreground = ${ansi16.foreground}`,
  `cursor-color = ${ansi16.cursor}`, `selection-background = ${ansi16.selectionBackground}`,
  `selection-foreground = ${ansi16.selectionForeground}`,
  ...terminalColors.map((color, index) => `palette = ${index}=${color}`),
].join('\n')

export const demoThemeImportFixtures: readonly DemoThemeImportFixture[] = [
  { filename: 'demo-base16.yaml', format: 'tinted-base16', contents: `system: base16\nname: Demo Base16\nauthor: OpenAlice demo\nvariant: dark\npalette:\n${yamlPalette(base16Source, '  ')}` },
  { filename: 'demo-legacy-base16.yaml', format: 'legacy-base16', contents: `scheme: Demo Legacy Base16\nauthor: OpenAlice demo\n${yamlPalette(base16Source)}` },
  { filename: 'demo-base24.json', format: 'tinted-base24', contents: JSON.stringify({ system: 'base24', name: 'Demo Base24', author: 'OpenAlice demo', variant: 'dark', palette: base24Source }, null, 2) },
  { filename: 'demo-flat-base24.json', format: 'flat-base24', contents: JSON.stringify({ system: 'base24', name: 'Demo Flat Base24', author: 'OpenAlice demo', variant: 'dark', ...base24Source }, null, 2) },
  { filename: 'demo.itermcolors', format: 'iterm2', contents: `<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict>${itermEntries}</dict></plist>` },
  { filename: 'demo-windows-terminal.json', format: 'windows-terminal', contents: JSON.stringify({ name: 'Demo Windows Terminal', background: ansi16.background, foreground: ansi16.foreground, cursorColor: ansi16.cursor, selectionBackground: ansi16.selectionBackground, ...Object.fromEntries(namedAnsi.map((name, index) => [name === 'magenta' ? 'purple' : name, terminalColors[index]])), ...Object.fromEntries(namedAnsi.map((name, index) => [`bright${(name === 'magenta' ? 'purple' : name).replace(/^./, (letter) => letter.toUpperCase())}`, terminalColors[index + 8]])) }, null, 2) },
  { filename: 'demo-alacritty.yml', format: 'alacritty', contents: alacrittyYaml },
  { filename: 'demo-alacritty.toml', format: 'alacritty', contents: alacrittyToml },
  { filename: 'demo-kitty.conf', format: 'kitty-ghostty', contents: kitty },
  { filename: 'demo-ghostty.theme', format: 'kitty-ghostty', contents: ghostty },
  { filename: 'demo.Xresources', format: 'xresources', contents: [`*.background: ${ansi16.background}`, `*.foreground: ${ansi16.foreground}`, `*.cursorColor: ${ansi16.cursor}`, ...terminalColors.map((color, index) => `*.color${index}: ${color}`)].join('\n') },
  { filename: 'invalid-theme.yaml', invalid: true, contents: 'base00: definitely-not-a-color' },
]
