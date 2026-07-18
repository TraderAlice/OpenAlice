import { z } from 'zod'

import { projectAnsi16Theme } from '../ansi16.js'
import { normalizeRgbHex, resolveThemeTokens } from '../colors.js'
import {
  type Ansi16Override,
  type ResolvedThemeTokens,
  type RgbHex,
  type ThemePalette,
  type ThemeVariantMode,
} from '../types.js'

export interface GeneratedThemeMapping {
  palette: ThemePalette
  tokens: ResolvedThemeTokens
  ansi16Override?: Ansi16Override
}

export type ThemeGeneratorOutputErrorCode =
  | 'invalid-json'
  | 'invalid-output'
  | 'invalid-projection'

export class ThemeGeneratorOutputError extends Error {
  constructor(
    readonly code: ThemeGeneratorOutputErrorCode,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message, { cause })
    this.name = 'ThemeGeneratorOutputError'
  }
}

const externalColorSchema = z.string()
  .regex(/^#?[0-9a-fA-F]{6}$/, 'Expected a six-digit opaque RGB color')
  .transform(normalizeRgbHex)

const matugenToneSchema = z.object({ color: externalColorSchema }).passthrough()
const matugenPaletteSchema = z.record(z.string(), matugenToneSchema)
const matugenOutputSchema = z.object({
  colors: z.record(z.string(), z.unknown()),
  palettes: z.object({
    error: matugenPaletteSchema,
    neutral: matugenPaletteSchema,
    neutral_variant: matugenPaletteSchema,
    primary: matugenPaletteSchema,
    secondary: matugenPaletteSchema,
    tertiary: matugenPaletteSchema,
  }).passthrough(),
}).passthrough()

type MatugenPaletteName = 'error' | 'neutral' | 'neutral_variant' | 'primary' | 'secondary' | 'tertiary'
type MatugenTone = readonly [palette: MatugenPaletteName, tone: string]

const MATUGEN_NEUTRALS: Record<ThemeVariantMode, readonly MatugenTone[]> = {
  light: [
    ['neutral', '98'], ['neutral', '95'], ['neutral', '90'], ['neutral_variant', '60'],
    ['neutral_variant', '40'], ['neutral', '20'], ['neutral', '10'], ['neutral', '0'],
  ],
  dark: [
    ['neutral', '10'], ['neutral', '15'], ['neutral', '20'], ['neutral_variant', '60'],
    ['neutral_variant', '70'], ['neutral', '90'], ['neutral', '95'], ['neutral', '100'],
  ],
}

const MATUGEN_ACCENTS: Record<ThemeVariantMode, readonly MatugenTone[]> = {
  light: [
    ['error', '40'], ['tertiary', '30'], ['secondary', '30'], ['primary', '30'],
    ['secondary', '40'], ['primary', '40'], ['tertiary', '40'], ['error', '30'],
  ],
  dark: [
    ['error', '80'], ['tertiary', '70'], ['secondary', '70'], ['primary', '70'],
    ['secondary', '80'], ['primary', '80'], ['tertiary', '80'], ['error', '70'],
  ],
}

const hellwalOutputSchema = z.object({
  special: z.object({
    background: externalColorSchema,
    foreground: externalColorSchema,
    cursor: externalColorSchema,
  }).passthrough(),
  colors: z.object({
    color0: externalColorSchema, color1: externalColorSchema,
    color2: externalColorSchema, color3: externalColorSchema,
    color4: externalColorSchema, color5: externalColorSchema,
    color6: externalColorSchema, color7: externalColorSchema,
    color8: externalColorSchema, color9: externalColorSchema,
    color10: externalColorSchema, color11: externalColorSchema,
    color12: externalColorSchema, color13: externalColorSchema,
    color14: externalColorSchema, color15: externalColorSchema,
  }).passthrough(),
}).passthrough()

export function parseMatugenOutput(raw: string, mode: ThemeVariantMode): GeneratedThemeMapping {
  const output = parseOutputJson(raw, 'Matugen', matugenOutputSchema)
  const slots = [...MATUGEN_NEUTRALS[mode], ...MATUGEN_ACCENTS[mode]]
  const colors = slots.map(([palette, tone]) => {
    const value = output.palettes[palette][tone]
    if (value === undefined) {
      throw new ThemeGeneratorOutputError(
        'invalid-output',
        `Matugen output is missing palettes.${palette}.${tone}.color`,
      )
    }
    return value.color
  })
  const palette: ThemePalette = {
    base00: colors[0]!, base01: colors[1]!, base02: colors[2]!, base03: colors[3]!,
    base04: colors[4]!, base05: colors[5]!, base06: colors[6]!, base07: colors[7]!,
    base08: colors[8]!, base09: colors[9]!, base0A: colors[10]!, base0B: colors[11]!,
    base0C: colors[12]!, base0D: colors[13]!, base0E: colors[14]!, base0F: colors[15]!,
  }
  return resolveMapping({ palette })
}

export function parseHellwalOutput(raw: string): GeneratedThemeMapping {
  const output = parseOutputJson(raw, 'Hellwal', hellwalOutputSchema)
  const colors: readonly [
    RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex,
  ] = [
    output.colors.color0, output.colors.color1, output.colors.color2, output.colors.color3,
    output.colors.color4, output.colors.color5, output.colors.color6, output.colors.color7,
    output.colors.color8, output.colors.color9, output.colors.color10, output.colors.color11,
    output.colors.color12, output.colors.color13, output.colors.color14, output.colors.color15,
  ]
  const projected = projectAnsi16Theme({
    name: 'Hellwal generated theme',
    author: null,
    background: output.special.background,
    foreground: output.special.foreground,
    cursor: output.special.cursor,
    selectionBackground: colors[8],
    colors,
  })
  return resolveMapping(projected)
}

function parseOutputJson<T>(raw: string, generator: string, schema: z.ZodType<T>): T {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw) as unknown
  } catch (cause) {
    throw new ThemeGeneratorOutputError('invalid-json', `${generator} output is not valid JSON`, cause)
  }
  const result = schema.safeParse(parsed)
  if (!result.success) {
    throw new ThemeGeneratorOutputError(
      'invalid-output',
      `${generator} output does not match its JSON contract: ${z.prettifyError(result.error)}`,
      result.error,
    )
  }
  return result.data
}

function resolveMapping(input: Pick<GeneratedThemeMapping, 'palette' | 'ansi16Override'>): GeneratedThemeMapping {
  try {
    return { ...input, tokens: resolveThemeTokens(input.palette) }
  } catch (cause) {
    throw new ThemeGeneratorOutputError(
      'invalid-projection',
      `Generated theme cannot be projected into accessible semantic tokens: ${errorMessage(cause)}`,
      cause,
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
