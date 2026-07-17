import { z } from 'zod'

export const THEME_MAPPING_VERSION = 1 as const

export const themeVariantModeSchema = z.enum(['light', 'dark'])
export type ThemeVariantMode = z.infer<typeof themeVariantModeSchema>

export const rgbHexSchema = z.string().regex(/^#[0-9a-f]{6}$/)
export type RgbHex = z.infer<typeof rgbHexSchema>

export const base16SlotSchema = z.enum([
  'base00', 'base01', 'base02', 'base03', 'base04', 'base05', 'base06', 'base07',
  'base08', 'base09', 'base0A', 'base0B', 'base0C', 'base0D', 'base0E', 'base0F',
])
export type Base16Slot = z.infer<typeof base16SlotSchema>

export const base24SlotSchema = z.enum([
  'base10', 'base11', 'base12', 'base13', 'base14', 'base15', 'base16', 'base17',
])
export type Base24Slot = z.infer<typeof base24SlotSchema>

const base16PaletteShape = Object.fromEntries(
  base16SlotSchema.options.map((slot) => [slot, rgbHexSchema]),
) as Record<Base16Slot, typeof rgbHexSchema>

const base24PaletteShape = Object.fromEntries(
  base24SlotSchema.options.map((slot) => [slot, rgbHexSchema]),
) as Record<Base24Slot, typeof rgbHexSchema>

export const themePaletteSchema = z.object(base16PaletteShape).extend(
  Object.fromEntries(
    Object.entries(base24PaletteShape).map(([slot, schema]) => [slot, schema.optional()]),
  ) as Record<Base24Slot, z.ZodOptional<typeof rgbHexSchema>>,
).strict().superRefine((palette, ctx) => {
  const present = base24SlotSchema.options.filter((slot) => palette[slot] !== undefined)
  if (present.length !== 0 && present.length !== base24SlotSchema.options.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'Base24 extension must contain every slot from base10 through base17',
    })
  }
})
export type ThemePalette = z.infer<typeof themePaletteSchema>

const ansiColorsSchema = z.tuple([
  rgbHexSchema, rgbHexSchema, rgbHexSchema, rgbHexSchema,
  rgbHexSchema, rgbHexSchema, rgbHexSchema, rgbHexSchema,
  rgbHexSchema, rgbHexSchema, rgbHexSchema, rgbHexSchema,
  rgbHexSchema, rgbHexSchema, rgbHexSchema, rgbHexSchema,
])

export const ansi16OverrideSchema = z.object({
  foreground: rgbHexSchema,
  background: rgbHexSchema,
  cursor: rgbHexSchema,
  cursorText: rgbHexSchema,
  selectionBackground: rgbHexSchema,
  selectionForeground: rgbHexSchema,
  colors: ansiColorsSchema,
}).strict()
export type Ansi16Override = z.infer<typeof ansi16OverrideSchema>

const provenanceBase = {
  mappingVersion: z.literal(THEME_MAPPING_VERSION),
} as const

export const themeProvenanceSchema = z.union([
  z.object({
    ...provenanceBase,
    kind: z.literal('builtin'),
    sourceName: z.string().min(1),
  }).strict(),
  z.object({
    ...provenanceBase,
    kind: z.literal('imported'),
    format: z.enum(['tinted-base16', 'legacy-base16', 'tinted-base24', 'flat-base24']),
    sourceName: z.string().min(1),
    author: z.string().min(1),
    contentSha256: z.string().regex(/^[0-9a-f]{64}$/),
    importedAt: z.string().datetime(),
  }).strict(),
  z.object({
    ...provenanceBase,
    kind: z.literal('generated'),
    generator: z.literal('matugen'),
    executablePath: z.string().min(1),
    executableVersion: z.string().min(1),
    imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
    parameters: z.object({
      mode: themeVariantModeSchema,
      scheme: z.string().trim().min(1).max(128),
    }).strict(),
    generatedAt: z.string().datetime(),
  }).strict(),
  z.object({
    ...provenanceBase,
    kind: z.literal('generated'),
    generator: z.literal('hellwal'),
    executablePath: z.string().min(1),
    executableVersion: z.string().min(1),
    imageSha256: z.string().regex(/^[0-9a-f]{64}$/),
    parameters: z.object({
      mode: themeVariantModeSchema,
      darkOffset: z.number().min(0).max(1),
      brightOffset: z.number().min(0).max(1),
    }).strict(),
    generatedAt: z.string().datetime(),
  }).strict(),
])
export type ThemeProvenance = z.infer<typeof themeProvenanceSchema>

export const resolvedThemeTokensSchema = z.object({
  pageBackground: rgbHexSchema,
  secondarySurface: rgbHexSchema,
  cardSurface: rgbHexSchema,
  border: rgbHexSchema,
  mutedText: rgbHexSchema,
  bodyText: rgbHexSchema,
  strongText: rgbHexSchema,
  highestContrastText: rgbHexSchema,
  danger: rgbHexSchema,
  orange: rgbHexSchema,
  warning: rgbHexSchema,
  success: rgbHexSchema,
  info: rgbHexSchema,
  accent: rgbHexSchema,
  secondaryAccent: rgbHexSchema,
  special: rgbHexSchema,
  onAccent: rgbHexSchema,
  hoverSurface: rgbHexSchema,
  activeSurface: rgbHexSchema,
  selection: rgbHexSchema,
  focusRing: rgbHexSchema,
  subtleSurface: rgbHexSchema,
  chartGrid: rgbHexSchema,
  overlay: rgbHexSchema,
}).strict()
export type ResolvedThemeTokens = z.infer<typeof resolvedThemeTokensSchema>

export const themeVariantSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  name: z.string().trim().min(1).max(128),
  mode: themeVariantModeSchema,
  palette: themePaletteSchema,
  ansi16Override: ansi16OverrideSchema.optional(),
  provenance: themeProvenanceSchema,
  tokens: resolvedThemeTokensSchema,
  createdAt: z.string().datetime(),
}).strict()
export type ThemeVariant = z.infer<typeof themeVariantSchema>

export const themeFamilySchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^[a-z0-9][a-z0-9._-]{0,127}$/),
  name: z.string().trim().min(1).max(128),
  variants: z.object({
    light: themeVariantSchema.optional(),
    dark: themeVariantSchema.optional(),
  }).strict(),
}).strict().superRefine((family, ctx) => {
  if (family.variants.light === undefined && family.variants.dark === undefined) {
    ctx.addIssue({ code: 'custom', path: ['variants'], message: 'A family needs at least one variant' })
  }
  for (const mode of themeVariantModeSchema.options) {
    const variant = family.variants[mode]
    if (variant !== undefined && variant.mode !== mode) {
      ctx.addIssue({ code: 'custom', path: ['variants', mode, 'mode'], message: `Expected ${mode}` })
    }
  }
})
export type ThemeFamily = z.infer<typeof themeFamilySchema>

export function containsBuiltinThemeVariant(family: ThemeFamily): boolean {
  return Object.values(family.variants).some((variant) => variant?.provenance.kind === 'builtin')
}
