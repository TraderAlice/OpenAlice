export type UiStyleProfileId = 'default' | 'win98' | 'broker-classic'

export interface UiStyleProfileDefinition {
  readonly id: UiStyleProfileId
  readonly labelKey: `theme.uiStyle.${UiStyleProfileId}`
  readonly descriptionKey: `theme.uiStyleDescription.${UiStyleProfileId}`
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
  },
  {
    id: 'broker-classic',
    labelKey: 'theme.uiStyle.broker-classic',
    descriptionKey: 'theme.uiStyleDescription.broker-classic',
  },
] as const satisfies readonly UiStyleProfileDefinition[]

export function isUiStyleProfileId(value: unknown): value is UiStyleProfileId {
  return UI_STYLE_PROFILES.some(({ id }) => id === value)
}
