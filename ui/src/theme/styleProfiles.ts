import type { ThemePaletteId } from './palettes'

export type UiStyleProfileId = 'default' | 'win98' | 'broker-classic' | 'studio' | 'outline'
export type UiStylePaletteMode = 'saved' | 'recommended'

export interface UiStyleProfileDefinition {
  readonly id: UiStyleProfileId
  readonly labelKey: `theme.uiStyle.${UiStyleProfileId}`
  readonly descriptionKey: `theme.uiStyleDescription.${UiStyleProfileId}`
  readonly recommendedPalettePair?: Readonly<{
    day: ThemePaletteId
    night: ThemePaletteId
  }>
}

export const DEFAULT_UI_STYLE_PROFILE: UiStyleProfileId = 'default'

export const UI_STYLE_PROFILES = [
  {
    id: 'default',
    labelKey: 'theme.uiStyle.default',
    descriptionKey: 'theme.uiStyleDescription.default',
  },
  {
    id: 'win98',
    labelKey: 'theme.uiStyle.win98',
    descriptionKey: 'theme.uiStyleDescription.win98',
    recommendedPalettePair: {
      day: 'windows-classic',
      night: 'windows-classic',
    },
  },
  {
    id: 'broker-classic',
    labelKey: 'theme.uiStyle.broker-classic',
    descriptionKey: 'theme.uiStyleDescription.broker-classic',
    recommendedPalettePair: { day: 'porcelain', night: 'midnight' },
  },
  {
    id: 'studio',
    labelKey: 'theme.uiStyle.studio',
    descriptionKey: 'theme.uiStyleDescription.studio',
    recommendedPalettePair: { day: 'paper', night: 'graphite' },
  },
  {
    id: 'outline',
    labelKey: 'theme.uiStyle.outline',
    descriptionKey: 'theme.uiStyleDescription.outline',
    recommendedPalettePair: { day: 'porcelain', night: 'iris' },
  },
] as const satisfies readonly UiStyleProfileDefinition[]

export function resolveStylePalettePair(profile: UiStyleProfileId, mode: UiStylePaletteMode) {
  const definition: UiStyleProfileDefinition | undefined = UI_STYLE_PROFILES.find(({ id }) => id === profile)
  return mode === 'recommended' ? definition?.recommendedPalettePair : undefined
}

export function isUiStyleProfileId(value: unknown): value is UiStyleProfileId {
  return UI_STYLE_PROFILES.some(({ id }) => id === value)
}

export function isUiStylePaletteMode(value: unknown): value is UiStylePaletteMode {
  return value === 'saved' || value === 'recommended'
}
