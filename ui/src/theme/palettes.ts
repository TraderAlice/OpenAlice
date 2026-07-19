export type ThemePaletteId =
  | 'paper'
  | 'porcelain'
  | 'linen'
  | 'graphite'
  | 'midnight'
  | 'moss'
  | 'iris'
export type ThemePaletteAppearance = 'light' | 'dark'
export type ThemePreferenceMode = 'auto' | 'day' | 'night'
export type ThemePreferenceSlot = Exclude<ThemePreferenceMode, 'auto'>

export interface ThemePaletteDefinition {
  readonly id: ThemePaletteId
  /** Intrinsic appearance used by native controls and terminal color reporting. */
  readonly appearance: ThemePaletteAppearance
  readonly labelKey: `theme.palette.${ThemePaletteId}`
  readonly descriptionKey: `theme.paletteDescription.${ThemePaletteId}`
}

export const DEFAULT_DAY_PALETTE: ThemePaletteId = 'paper'
export const DEFAULT_NIGHT_PALETTE: ThemePaletteId = 'graphite'

/**
 * One universal palette library. `appearance` describes a card; it does not
 * restrict which preference slot can select it.
 */
export const THEME_PALETTES = [
  { id: 'paper', appearance: 'light', labelKey: 'theme.palette.paper', descriptionKey: 'theme.paletteDescription.paper' },
  { id: 'porcelain', appearance: 'light', labelKey: 'theme.palette.porcelain', descriptionKey: 'theme.paletteDescription.porcelain' },
  { id: 'linen', appearance: 'light', labelKey: 'theme.palette.linen', descriptionKey: 'theme.paletteDescription.linen' },
  { id: 'graphite', appearance: 'dark', labelKey: 'theme.palette.graphite', descriptionKey: 'theme.paletteDescription.graphite' },
  { id: 'midnight', appearance: 'dark', labelKey: 'theme.palette.midnight', descriptionKey: 'theme.paletteDescription.midnight' },
  { id: 'moss', appearance: 'dark', labelKey: 'theme.palette.moss', descriptionKey: 'theme.paletteDescription.moss' },
  { id: 'iris', appearance: 'dark', labelKey: 'theme.palette.iris', descriptionKey: 'theme.paletteDescription.iris' },
] as const satisfies readonly ThemePaletteDefinition[]

export function isThemePaletteId(value: unknown): value is ThemePaletteId {
  return THEME_PALETTES.some(({ id }) => id === value)
}

export function isThemePreferenceMode(value: unknown): value is ThemePreferenceMode {
  return value === 'auto' || value === 'day' || value === 'night'
}

/** Accept the v1 `light` / `dark` preference values without keeping them live. */
export function normalizeThemePreferenceMode(value: unknown): ThemePreferenceMode | null {
  if (isThemePreferenceMode(value)) return value
  if (value === 'light') return 'day'
  if (value === 'dark') return 'night'
  return null
}

export function paletteAppearance(palette: ThemePaletteId): ThemePaletteAppearance {
  return THEME_PALETTES.find(({ id }) => id === palette)!.appearance
}

export function resolveEffectiveSlot(
  preference: ThemePreferenceMode,
  systemDark: boolean,
): ThemePreferenceSlot {
  if (preference === 'auto') return systemDark ? 'night' : 'day'
  return preference
}

export function resolveEffectivePalette(
  preference: ThemePreferenceMode,
  systemDark: boolean,
  dayPalette: ThemePaletteId,
  nightPalette: ThemePaletteId,
): ThemePaletteId {
  return resolveEffectiveSlot(preference, systemDark) === 'night' ? nightPalette : dayPalette
}
