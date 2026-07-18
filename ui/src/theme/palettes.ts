export type LightPaletteId = 'paper' | 'porcelain'
export type DarkPaletteId = 'graphite' | 'midnight'
export type ThemePaletteId = LightPaletteId | DarkPaletteId
export type ThemePaletteMode = 'light' | 'dark'
export type ThemeColorMode = ThemePaletteMode | 'auto'

export interface ThemePaletteDefinition<T extends ThemePaletteId = ThemePaletteId> {
  readonly id: T
  readonly mode: ThemePaletteMode
  readonly labelKey: `theme.palette.${T}`
  readonly descriptionKey: `theme.paletteDescription.${T}`
}

export const DEFAULT_LIGHT_PALETTE: LightPaletteId = 'paper'
export const DEFAULT_DARK_PALETTE: DarkPaletteId = 'graphite'

export const LIGHT_PALETTES = [
  { id: 'paper', mode: 'light', labelKey: 'theme.palette.paper', descriptionKey: 'theme.paletteDescription.paper' },
  { id: 'porcelain', mode: 'light', labelKey: 'theme.palette.porcelain', descriptionKey: 'theme.paletteDescription.porcelain' },
] as const satisfies readonly ThemePaletteDefinition<LightPaletteId>[]

export const DARK_PALETTES = [
  { id: 'graphite', mode: 'dark', labelKey: 'theme.palette.graphite', descriptionKey: 'theme.paletteDescription.graphite' },
  { id: 'midnight', mode: 'dark', labelKey: 'theme.palette.midnight', descriptionKey: 'theme.paletteDescription.midnight' },
] as const satisfies readonly ThemePaletteDefinition<DarkPaletteId>[]

export const THEME_PALETTES: readonly ThemePaletteDefinition[] = [
  ...LIGHT_PALETTES,
  ...DARK_PALETTES,
]

export function isLightPaletteId(value: unknown): value is LightPaletteId {
  return value === 'paper' || value === 'porcelain'
}

export function isDarkPaletteId(value: unknown): value is DarkPaletteId {
  return value === 'graphite' || value === 'midnight'
}

export function isThemeColorMode(value: unknown): value is ThemeColorMode {
  return value === 'auto' || value === 'light' || value === 'dark'
}

export function resolveEffectivePalette(
  theme: ThemeColorMode,
  systemDark: boolean,
  lightPalette: LightPaletteId,
  darkPalette: DarkPaletteId,
): ThemePaletteId {
  const mode = theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme
  return mode === 'dark' ? darkPalette : lightPalette
}
