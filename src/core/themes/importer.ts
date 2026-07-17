import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'
import { parse as parsePlist } from 'plist'
import { parse as parseToml } from 'smol-toml'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { projectAnsi16Theme, type Ansi16Source } from './ansi16.js'
import { normalizeRgbHex, resolveThemeTokens, ThemeContrastError } from './colors.js'
import {
  THEME_MAPPING_VERSION,
  base16SlotSchema,
  base24SlotSchema,
  themeFamilySchema,
  themeVariantModeSchema,
  type Ansi16Override,
  type Base16Slot,
  type Base24Slot,
  type RgbHex,
  type ThemeFamily,
  type ThemePalette,
  type ThemeVariantMode,
} from './types.js'

const sourceColorSchema = z.string().transform((value, ctx) => {
  try {
    return normalizeRgbHex(value)
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : String(error) })
    return z.NEVER
  }
})

const base16SourceShape = Object.fromEntries(
  base16SlotSchema.options.map((slot) => [slot, sourceColorSchema]),
) as Record<Base16Slot, typeof sourceColorSchema>

const base24SourceShape = Object.fromEntries(
  [...base16SlotSchema.options, ...base24SlotSchema.options].map((slot) => [slot, sourceColorSchema]),
) as Record<Base16Slot | Base24Slot, typeof sourceColorSchema>

const tintedBase16Schema = z.object({
  system: z.literal('base16'),
  name: z.string().trim().min(1).max(128),
  author: z.string().trim().min(1).max(256),
  variant: themeVariantModeSchema,
  palette: z.object(base16SourceShape).strict(),
}).strict()

const legacyBase16Schema = z.object({
  scheme: z.string().trim().min(1).max(128),
  author: z.string().trim().min(1).max(256),
  ...base16SourceShape,
}).strict()

const tintedBase24Schema = z.object({
  system: z.literal('base24'),
  name: z.string().trim().min(1).max(128),
  author: z.string().trim().min(1).max(256),
  variant: themeVariantModeSchema,
  palette: z.object(base24SourceShape).strict(),
}).strict()

const flatBase24Schema = z.object({
  system: z.literal('base24'),
  name: z.string().trim().min(1).max(128),
  author: z.string().trim().min(1).max(256),
  variant: themeVariantModeSchema,
  ...base24SourceShape,
}).strict()

const ansiNames = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
] as const

const windowsTerminalSchema = z.object({
  name: z.string().trim().min(1).max(128),
  background: sourceColorSchema,
  foreground: sourceColorSchema,
  cursorColor: sourceColorSchema,
  selectionBackground: sourceColorSchema.optional(),
  black: sourceColorSchema,
  red: sourceColorSchema,
  green: sourceColorSchema,
  yellow: sourceColorSchema,
  blue: sourceColorSchema,
  purple: sourceColorSchema,
  cyan: sourceColorSchema,
  white: sourceColorSchema,
  brightBlack: sourceColorSchema,
  brightRed: sourceColorSchema,
  brightGreen: sourceColorSchema,
  brightYellow: sourceColorSchema,
  brightBlue: sourceColorSchema,
  brightPurple: sourceColorSchema,
  brightCyan: sourceColorSchema,
  brightWhite: sourceColorSchema,
}).strict()

const namedAnsi8Schema = z.object(Object.fromEntries(
  ansiNames.map((name) => [name, sourceColorSchema]),
) as Record<(typeof ansiNames)[number], typeof sourceColorSchema>).strict()

const alacrittySchema = z.object({
  colors: z.object({
    primary: z.object({ background: sourceColorSchema, foreground: sourceColorSchema }).strict(),
    cursor: z.object({ text: sourceColorSchema, cursor: sourceColorSchema }).strict(),
    selection: z.object({ text: sourceColorSchema, background: sourceColorSchema }).strict(),
    normal: namedAnsi8Schema,
    bright: namedAnsi8Schema,
  }).strict(),
}).strict()

const itermColorSchema = z.object({
  'Red Component': z.number().min(0).max(1),
  'Green Component': z.number().min(0).max(1),
  'Blue Component': z.number().min(0).max(1),
  'Alpha Component': z.number().min(0).max(1).optional(),
  'Color Space': z.string().min(1).optional(),
}).strict()

const itermShape: Record<string, typeof itermColorSchema> = {
  'Background Color': itermColorSchema,
  'Foreground Color': itermColorSchema,
  'Cursor Color': itermColorSchema,
  'Cursor Text Color': itermColorSchema,
  'Selection Color': itermColorSchema,
  'Selected Text Color': itermColorSchema,
}
for (let index = 0; index < 16; index += 1) itermShape[`Ansi ${index} Color`] = itermColorSchema
const itermSchema = z.object(itermShape).strict()

type SchemeFormat =
  | 'tinted-base16'
  | 'legacy-base16'
  | 'tinted-base24'
  | 'flat-base24'
  | 'iterm2'
  | 'windows-terminal'
  | 'alacritty'
  | 'kitty-ghostty'
  | 'xresources'

interface ParsedCandidate {
  format: SchemeFormat
  name: string
  author: string | null
  mode?: ThemeVariantMode
  palette: ThemePalette
  ansi16Override?: Ansi16Override
}

export type ThemeImportErrorCode =
  | 'invalid_document'
  | 'unsupported_schema'
  | 'ambiguous_schema'
  | 'legacy_variant_required'
  | 'variant_required'
  | 'contrast_failed'

export interface ThemeImportDiagnostic {
  path: string
  message: string
}

export class ThemeImportError extends Error {
  constructor(
    readonly code: ThemeImportErrorCode,
    readonly diagnostics: readonly ThemeImportDiagnostic[],
  ) {
    super(diagnostics.map((item) => `${item.path || '<root>'}: ${item.message}`).join('; '))
    this.name = 'ThemeImportError'
  }
}

export interface ThemeImportOptions {
  filename?: string
  legacyVariant?: ThemeVariantMode
  now?: Date
}

export interface ThemeImportPreview {
  family: ThemeFamily
  format: SchemeFormat
}

export function importThemeScheme(
  contents: string,
  options: ThemeImportOptions = {},
): ThemeImportPreview {
  if (Buffer.byteLength(contents, 'utf8') > 1024 * 1024) {
    throw new ThemeImportError('invalid_document', [{ path: '', message: 'Theme file exceeds 1 MiB' }])
  }
  const candidates = parseCandidates(contents, options.filename)
  if (candidates.length === 0) {
    throw new ThemeImportError('unsupported_schema', bestDiagnostics(contents, options.filename))
  }
  if (candidates.length > 1) {
    throw new ThemeImportError('ambiguous_schema', [{
      path: '',
      message: `Input matches multiple schemas: ${candidates.map((candidate) => candidate.format).join(', ')}`,
    }])
  }

  const candidate = candidates[0]!
  const mode = candidate.mode ?? options.legacyVariant
  if (mode === undefined) {
    const legacy = candidate.format === 'legacy-base16'
    throw new ThemeImportError(legacy ? 'legacy_variant_required' : 'variant_required', [{
      path: 'variant',
      message: `${legacy ? 'Legacy flat Base16' : 'ANSI16 theme'} has no variant; choose light or dark explicitly`,
    }])
  }

  const contentSha256 = createHash('sha256').update(contents).digest('hex')
  const familyIdentity = `${candidate.author ?? ''}\u0000${candidate.name}`
  const familyId = `imported-${slug(candidate.name)}-${createHash('sha256').update(familyIdentity).digest('hex').slice(0, 10)}`
  const createdAt = (options.now ?? new Date()).toISOString()
  try {
    const family = themeFamilySchema.parse({
      schemaVersion: 1,
      id: familyId,
      name: candidate.name,
      variants: {
        [mode]: {
          id: `${familyId}-${mode}`,
          name: `${candidate.name} ${mode === 'light' ? 'Light' : 'Dark'}`,
          mode,
          palette: candidate.palette,
          ...(candidate.ansi16Override === undefined ? {} : { ansi16Override: candidate.ansi16Override }),
          provenance: {
            kind: 'imported',
            format: candidate.format,
            sourceName: options.filename ?? candidate.name,
            author: candidate.author,
            contentSha256,
            importedAt: createdAt,
            mappingVersion: THEME_MAPPING_VERSION,
          },
          tokens: resolveThemeTokens(candidate.palette),
          createdAt,
        },
      },
    })
    return { family, format: candidate.format }
  } catch (error) {
    if (error instanceof ThemeContrastError) {
      throw new ThemeImportError('contrast_failed', error.failures.map((failure) => ({
        path: `tokens.${failure.foreground}/${failure.background}`,
        message: `Contrast ${failure.actual.toFixed(2)} is below ${failure.required}`,
      })))
    }
    throw error
  }
}

function parseCandidates(contents: string, filename?: string): ParsedCandidate[] {
  const structured = parseStructuredDocuments(contents, filename)
  const candidates = structured.flatMap((document) => parseStructuredCandidates(document, filename))
  const iterm = parseItermCandidate(contents, filename)
  if (iterm !== undefined) candidates.push(iterm)
  const text = parseTerminalTextCandidate(contents, filename)
  if (text !== undefined) candidates.push(text)
  return uniqueCandidates(candidates)
}

interface StructuredDocument {
  syntax: 'json' | 'yaml' | 'toml'
  value: unknown
}

function parseStructuredDocuments(contents: string, filename?: string): StructuredDocument[] {
  const extension = extname(filename ?? '').toLowerCase()
  const values: StructuredDocument[] = []
  const errors: unknown[] = []
  const parsers: Array<{ syntax: StructuredDocument['syntax']; parse: () => unknown }> = []
  if (extension === '.json' || contents.trimStart().startsWith('{')) {
    parsers.push({ syntax: 'json', parse: () => JSON.parse(contents) as unknown })
  }
  if (extension === '.toml') parsers.push({ syntax: 'toml', parse: () => parseToml(contents) as unknown })
  const firstKey = /^\s*(system|scheme|colors)\s*:/m.test(contents)
  if (['.yaml', '.yml'].includes(extension) || firstKey) {
    parsers.push({
      syntax: 'yaml',
      parse: () => parseYaml(contents, { maxAliasCount: 0, prettyErrors: false }) as unknown,
    })
  }
  for (const parser of parsers) {
    try {
      const value = parser.parse()
      if (!values.some((existing) => existing.syntax === parser.syntax
        && JSON.stringify(existing.value) === JSON.stringify(value))) {
        values.push({ syntax: parser.syntax, value })
      }
    } catch (error) {
      errors.push(error)
    }
  }
  if (values.length === 0 && errors.length > 0
    && ['.json', '.yaml', '.yml', '.toml'].includes(extension)) {
    throw new ThemeImportError('invalid_document', [{
      path: '',
      message: errors[0] instanceof Error ? errors[0].message : String(errors[0]),
    }])
  }
  return values
}

function parseStructuredCandidates(document: StructuredDocument, filename?: string): ParsedCandidate[] {
  const raw = document.value
  const result: ParsedCandidate[] = []
  const supportsBase = document.syntax === 'json' || document.syntax === 'yaml'
  const tinted16 = supportsBase ? tintedBase16Schema.safeParse(raw) : undefined
  if (tinted16?.success) result.push({
    format: 'tinted-base16', name: tinted16.data.name, author: tinted16.data.author,
    mode: tinted16.data.variant, palette: tinted16.data.palette,
  })
  const legacy16 = supportsBase ? legacyBase16Schema.safeParse(raw) : undefined
  if (legacy16?.success) {
    const { scheme, author, ...palette } = legacy16.data
    result.push({ format: 'legacy-base16', name: scheme, author, palette })
  }
  const tinted24 = supportsBase ? tintedBase24Schema.safeParse(raw) : undefined
  if (tinted24?.success) result.push({
    format: 'tinted-base24', name: tinted24.data.name, author: tinted24.data.author,
    mode: tinted24.data.variant, palette: tinted24.data.palette,
  })
  const flat24 = supportsBase ? flatBase24Schema.safeParse(raw) : undefined
  if (flat24?.success) {
    const { system: _system, name, author, variant, ...palette } = flat24.data
    result.push({ format: 'flat-base24', name, author, mode: variant, palette })
  }
  const windows = document.syntax === 'json' ? windowsTerminalSchema.safeParse(raw) : undefined
  if (windows?.success) result.push(fromWindowsTerminal(windows.data))
  const alacritty = document.syntax === 'yaml' || document.syntax === 'toml'
    ? alacrittySchema.safeParse(raw)
    : undefined
  if (alacritty?.success) result.push(fromAlacritty(alacritty.data, filename))
  return result
}

function fromWindowsTerminal(data: z.infer<typeof windowsTerminalSchema>): ParsedCandidate {
  const source: Ansi16Source = {
    name: data.name,
    author: null,
    foreground: data.foreground,
    background: data.background,
    cursor: data.cursorColor,
    selectionBackground: data.selectionBackground ?? data.brightBlack,
    colors: [
      data.black, data.red, data.green, data.yellow, data.blue, data.purple, data.cyan, data.white,
      data.brightBlack, data.brightRed, data.brightGreen, data.brightYellow,
      data.brightBlue, data.brightPurple, data.brightCyan, data.brightWhite,
    ],
  }
  return fromAnsiSource('windows-terminal', source)
}

function fromAlacritty(data: z.infer<typeof alacrittySchema>, filename?: string): ParsedCandidate {
  const { primary, cursor, selection, normal, bright } = data.colors
  const source: Ansi16Source = {
    name: fileDisplayName(filename, 'Alacritty theme'),
    author: null,
    foreground: primary.foreground,
    background: primary.background,
    cursor: cursor.cursor,
    cursorText: cursor.text,
    selectionBackground: selection.background,
    selectionForeground: selection.text,
    colors: ansi16Tuple(
      normal.black, normal.red, normal.green, normal.yellow,
      normal.blue, normal.magenta, normal.cyan, normal.white,
      bright.black, bright.red, bright.green, bright.yellow,
      bright.blue, bright.magenta, bright.cyan, bright.white,
    ),
  }
  return fromAnsiSource('alacritty', source)
}

function parseItermCandidate(contents: string, filename?: string): ParsedCandidate | undefined {
  const extension = extname(filename ?? '').toLowerCase()
  if (!['.itermcolors', '.plist'].includes(extension)
    && !contents.includes('<plist')
    && !contents.trimStart().startsWith('bplist')) return undefined
  let raw: unknown
  try {
    raw = parsePlist(contents)
  } catch (error) {
    throw new ThemeImportError('invalid_document', [{
      path: '', message: error instanceof Error ? error.message : String(error),
    }])
  }
  const parsed = itermSchema.safeParse(raw)
  if (!parsed.success) {
    throw new ThemeImportError('unsupported_schema', parsed.error.issues.slice(0, 12).map((issue) => ({
      path: issue.path.join('.'), message: issue.message,
    })))
  }
  const color = (key: string) => itermColor(parsed.data[key]!)
  const colors = ansi16Tuple(
    color('Ansi 0 Color'), color('Ansi 1 Color'), color('Ansi 2 Color'), color('Ansi 3 Color'),
    color('Ansi 4 Color'), color('Ansi 5 Color'), color('Ansi 6 Color'), color('Ansi 7 Color'),
    color('Ansi 8 Color'), color('Ansi 9 Color'), color('Ansi 10 Color'), color('Ansi 11 Color'),
    color('Ansi 12 Color'), color('Ansi 13 Color'), color('Ansi 14 Color'), color('Ansi 15 Color'),
  )
  return fromAnsiSource('iterm2', {
    name: fileDisplayName(filename, 'iTerm2 theme'),
    author: null,
    foreground: color('Foreground Color'),
    background: color('Background Color'),
    cursor: color('Cursor Color'),
    cursorText: color('Cursor Text Color'),
    selectionBackground: color('Selection Color'),
    selectionForeground: color('Selected Text Color'),
    colors,
  })
}

function itermColor(value: z.infer<typeof itermColorSchema>): RgbHex {
  const channel = (component: number) => Math.round(component * 255).toString(16).padStart(2, '0')
  return normalizeRgbHex(`#${channel(value['Red Component'])}${channel(value['Green Component'])}${channel(value['Blue Component'])}`)
}

function parseTerminalTextCandidate(contents: string, filename?: string): ParsedCandidate | undefined {
  const lines = contents.split(/\r?\n/)
  const kitty = new Map<string, string>()
  const xresources = new Map<string, string>()
  for (const [lineIndex, rawLine] of lines.entries()) {
    const line = rawLine.trim()
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue
    const xMatch = /^(?:\*|[A-Za-z0-9_.-]+\*)\.?(background|foreground|cursorColor|selectionBackground|selectionForeground|color(?:[0-9]|1[0-5]))\s*:\s*(\S+)$/i.exec(line)
    if (xMatch !== null) {
      const key = normalizeTerminalTextKey(xMatch[1]!) ?? xMatch[1]!.toLowerCase()
      addUnique(xresources, key, xMatch[2]!, lineIndex)
      continue
    }
    const ghosttyPalette = /^palette\s*=\s*(\d{1,2})\s*=\s*(\S+)$/.exec(line)
    if (ghosttyPalette !== null) {
      addUnique(kitty, `color${ghosttyPalette[1]}`, ghosttyPalette[2]!, lineIndex)
      continue
    }
    const keyValue = /^([A-Za-z][A-Za-z0-9_-]*)\s*(?:=|\s)\s*(\S+)$/.exec(line)
    if (keyValue !== null) {
      const key = normalizeTerminalTextKey(keyValue[1]!)
      if (key !== undefined) {
        addUnique(kitty, key, keyValue[2]!, lineIndex)
        continue
      }
    }
    if (kitty.size > 0 || xresources.size > 0) {
      throw new ThemeImportError('unsupported_schema', [{
        path: `line ${lineIndex + 1}`, message: 'Unknown or malformed terminal theme field',
      }])
    }
    return undefined
  }
  if (xresources.size > 0 && kitty.size > 0) {
    throw new ThemeImportError('ambiguous_schema', [{ path: '', message: 'Input mixes Xresources and Kitty/Ghostty keys' }])
  }
  if (xresources.size > 0) return terminalMapCandidate('xresources', xresources, filename)
  if (kitty.size > 0) return terminalMapCandidate('kitty-ghostty', kitty, filename)
  return undefined
}

function normalizeTerminalTextKey(key: string): string | undefined {
  const normalized = key.toLowerCase().replaceAll('-', '_')
  const aliases: Record<string, string> = {
    background: 'background', foreground: 'foreground', cursor: 'cursor', cursor_color: 'cursor',
    cursorcolor: 'cursor',
    cursor_text_color: 'cursorText', selection_background: 'selectionBackground',
    selectionbackground: 'selectionBackground', selection_foreground: 'selectionForeground',
    selectionforeground: 'selectionForeground',
  }
  if (aliases[normalized] !== undefined) return aliases[normalized]
  const color = /^color([0-9]|1[0-5])$/.exec(normalized)
  return color === null ? undefined : `color${color[1]}`
}

function terminalMapCandidate(
  format: 'kitty-ghostty' | 'xresources',
  values: Map<string, string>,
  filename?: string,
): ParsedCandidate | undefined {
  const normalized = new Map<string, RgbHex>()
  for (const [key, value] of values) {
    try {
      normalized.set(normalizeTerminalTextKey(key) ?? key, normalizeRgbHex(value))
    } catch (error) {
      throw new ThemeImportError('unsupported_schema', [{
        path: key, message: error instanceof Error ? error.message : String(error),
      }])
    }
  }
  const required = ['background', 'foreground', 'cursor', ...Array.from({ length: 16 }, (_, index) => `color${index}`)]
  const missing = required.filter((key) => !normalized.has(key))
  if (missing.length > 0) {
    throw new ThemeImportError('unsupported_schema', missing.map((key) => ({
      path: key, message: 'Required terminal color is missing',
    })))
  }
  const color = (index: number) => normalized.get(`color${index}`)!
  const colors = ansi16Tuple(
    color(0), color(1), color(2), color(3), color(4), color(5), color(6), color(7),
    color(8), color(9), color(10), color(11), color(12), color(13), color(14), color(15),
  )
  const selectionBackground = normalized.get('selectionBackground') ?? colors[8]
  const source: Ansi16Source = {
    name: fileDisplayName(filename, format === 'xresources' ? 'Xresources theme' : 'Terminal theme'),
    author: null,
    foreground: normalized.get('foreground')!,
    background: normalized.get('background')!,
    cursor: normalized.get('cursor')!,
    ...(normalized.get('cursorText') === undefined ? {} : { cursorText: normalized.get('cursorText')! }),
    selectionBackground,
    ...(normalized.get('selectionForeground') === undefined
      ? {}
      : { selectionForeground: normalized.get('selectionForeground')! }),
    colors,
  }
  return fromAnsiSource(format, source)
}

function addUnique(values: Map<string, string>, key: string, value: string, lineIndex: number): void {
  if (values.has(key)) {
    throw new ThemeImportError('unsupported_schema', [{
      path: `line ${lineIndex + 1}`,
      message: `Duplicate terminal color key ${key}`,
    }])
  }
  values.set(key, value)
}

function fromAnsiSource(format: Extract<SchemeFormat, 'iterm2' | 'windows-terminal' | 'alacritty' | 'kitty-ghostty' | 'xresources'>, source: Ansi16Source): ParsedCandidate {
  const projected = projectAnsi16Theme(source)
  return { format, name: source.name, author: source.author, ...projected }
}

function ansi16Tuple(
  ...colors: [
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
  ]
): Ansi16Source['colors'] {
  return colors
}

function bestDiagnostics(contents: string, filename?: string): ThemeImportDiagnostic[] {
  const structured = parseStructuredDocuments(contents, filename)
  const schemas = [
    tintedBase16Schema, legacyBase16Schema, tintedBase24Schema, flatBase24Schema,
    windowsTerminalSchema, alacrittySchema,
  ]
  const results = structured.flatMap((document) => schemas.map((schema) => schema.safeParse(document.value)))
    .filter((result) => !result.success)
    .sort((a, b) => a.error.issues.length - b.error.issues.length)
  return results[0]?.error.issues.slice(0, 12).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  })) ?? [{ path: '', message: 'Unsupported theme document or missing required terminal color slots' }]
}

function uniqueCandidates(candidates: ParsedCandidate[]): ParsedCandidate[] {
  const result: ParsedCandidate[] = []
  for (const candidate of candidates) {
    if (!result.some((existing) => existing.format === candidate.format
      && JSON.stringify(existing) === JSON.stringify(candidate))) result.push(candidate)
  }
  return result
}

function fileDisplayName(filename: string | undefined, fallback: string): string {
  if (filename === undefined) return fallback
  const extension = extname(filename)
  return basename(filename, extension).trim() || fallback
}

function slug(value: string): string {
  const result = value.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return result || 'theme'
}
