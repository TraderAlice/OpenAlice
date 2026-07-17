import { createHash } from 'node:crypto'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod'

import { normalizeRgbHex, resolveThemeTokens, ThemeContrastError } from './colors.js'
import {
  THEME_MAPPING_VERSION,
  base16SlotSchema,
  base24SlotSchema,
  themeFamilySchema,
  themeVariantModeSchema,
  type Base16Slot,
  type Base24Slot,
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

type SupportedInput =
  | { format: 'tinted-base16'; data: z.infer<typeof tintedBase16Schema> }
  | { format: 'legacy-base16'; data: z.infer<typeof legacyBase16Schema> }
  | { format: 'tinted-base24'; data: z.infer<typeof tintedBase24Schema> }
  | { format: 'flat-base24'; data: z.infer<typeof flatBase24Schema> }

export type ThemeImportErrorCode =
  | 'invalid_document'
  | 'unsupported_schema'
  | 'ambiguous_schema'
  | 'legacy_variant_required'
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
  format: SupportedInput['format']
}

export function importThemeScheme(
  contents: string,
  options: ThemeImportOptions = {},
): ThemeImportPreview {
  const raw = parseDocument(contents, options.filename)
  const candidates = parseCandidates(raw)
  if (candidates.length === 0) {
    throw new ThemeImportError('unsupported_schema', bestDiagnostics(raw))
  }
  if (candidates.length > 1) {
    throw new ThemeImportError('ambiguous_schema', [{
      path: '',
      message: `Input matches multiple schemas: ${candidates.map((candidate) => candidate.format).join(', ')}`,
    }])
  }

  const candidate = candidates[0]!
  if (candidate.format === 'legacy-base16' && options.legacyVariant === undefined) {
    throw new ThemeImportError('legacy_variant_required', [{
      path: 'variant',
      message: 'Legacy flat Base16 has no variant; choose light or dark explicitly',
    }])
  }

  const descriptor = describeCandidate(candidate, options.legacyVariant)
  const contentSha256 = createHash('sha256').update(contents).digest('hex')
  const familyIdentity = `${descriptor.author}\u0000${descriptor.name}`
  const familyId = `imported-${slug(descriptor.name)}-${createHash('sha256').update(familyIdentity).digest('hex').slice(0, 10)}`
  const createdAt = (options.now ?? new Date()).toISOString()
  try {
    const family = themeFamilySchema.parse({
      schemaVersion: 1,
      id: familyId,
      name: descriptor.name,
      variants: {
        [descriptor.mode]: {
          id: `${familyId}-${descriptor.mode}`,
          name: `${descriptor.name} ${descriptor.mode === 'light' ? 'Light' : 'Dark'}`,
          mode: descriptor.mode,
          palette: descriptor.palette,
          provenance: {
            kind: 'imported',
            format: candidate.format,
            sourceName: options.filename ?? descriptor.name,
            author: descriptor.author,
            contentSha256,
            importedAt: createdAt,
            mappingVersion: THEME_MAPPING_VERSION,
          },
          tokens: resolveThemeTokens(descriptor.palette),
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

function parseDocument(contents: string, filename?: string): unknown {
  if (Buffer.byteLength(contents, 'utf8') > 1024 * 1024) {
    throw new ThemeImportError('invalid_document', [{ path: '', message: 'Theme file exceeds 1 MiB' }])
  }
  try {
    if (filename?.toLowerCase().endsWith('.json')) return JSON.parse(contents) as unknown
    return parseYaml(contents, { maxAliasCount: 0, prettyErrors: false }) as unknown
  } catch (error) {
    throw new ThemeImportError('invalid_document', [{
      path: '',
      message: error instanceof Error ? error.message : String(error),
    }])
  }
}

function parseCandidates(raw: unknown): SupportedInput[] {
  const schemas = [
    ['tinted-base16', tintedBase16Schema],
    ['legacy-base16', legacyBase16Schema],
    ['tinted-base24', tintedBase24Schema],
    ['flat-base24', flatBase24Schema],
  ] as const
  return schemas.flatMap(([format, schema]) => {
    const result = schema.safeParse(raw)
    return result.success ? [{ format, data: result.data } as SupportedInput] : []
  })
}

function bestDiagnostics(raw: unknown): ThemeImportDiagnostic[] {
  const results = [tintedBase16Schema, legacyBase16Schema, tintedBase24Schema, flatBase24Schema]
    .map((schema) => schema.safeParse(raw))
    .filter((result) => !result.success)
    .sort((a, b) => a.error.issues.length - b.error.issues.length)
  return results[0]?.error.issues.slice(0, 12).map((issue) => ({
    path: issue.path.join('.'),
    message: issue.message,
  })) ?? [{ path: '', message: 'Unsupported theme document' }]
}

function describeCandidate(candidate: SupportedInput, legacyVariant?: ThemeVariantMode): {
  name: string
  author: string
  mode: ThemeVariantMode
  palette: ThemePalette
} {
  switch (candidate.format) {
    case 'tinted-base16':
    case 'tinted-base24':
      return {
        name: candidate.data.name,
        author: candidate.data.author,
        mode: candidate.data.variant,
        palette: candidate.data.palette,
      }
    case 'legacy-base16': {
      if (legacyVariant === undefined) throw new Error('legacy variant checked before description')
      const { scheme, author, ...palette } = candidate.data
      return { name: scheme, author, mode: legacyVariant, palette }
    }
    case 'flat-base24': {
      const { system: _system, name, author, variant, ...palette } = candidate.data
      return { name, author, mode: variant, palette }
    }
  }
}

function slug(value: string): string {
  const result = value.toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64)
  return result || 'theme'
}
