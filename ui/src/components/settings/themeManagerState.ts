import type {
  AppearanceMode,
  AppearancePreferences,
  ThemeFamily,
  ThemeVariantMode,
} from '../../api/themes'

export interface ThemeManagerAppearanceState {
  readonly authoritative: AppearancePreferences
  readonly draft: AppearancePreferences
}

export type ThemeManagerAppearanceAction =
  | { readonly type: 'authoritative-changed'; readonly appearance: AppearancePreferences }
  | { readonly type: 'saved'; readonly appearance: AppearancePreferences }
  | { readonly type: 'reset' }
  | { readonly type: 'select-family'; readonly familyId: string; readonly families: readonly ThemeFamily[] }
  | { readonly type: 'select-mode'; readonly mode: AppearanceMode; readonly families: readonly ThemeFamily[] }
  | { readonly type: 'terminal-follow' }
  | { readonly type: 'terminal-override-family'; readonly familyId: string; readonly families: readonly ThemeFamily[] }
  | { readonly type: 'terminal-override-variant'; readonly variant: ThemeVariantMode; readonly families: readonly ThemeFamily[] }
  | { readonly type: 'market-colors'; readonly value: AppearancePreferences['marketColors'] }
  | { readonly type: 'market-direction'; readonly value: AppearancePreferences['marketDirection'] }
  | { readonly type: 'status-colors'; readonly value: AppearancePreferences['statusColors'] }

export function createThemeManagerAppearanceState(
  appearance: AppearancePreferences,
): ThemeManagerAppearanceState {
  return { authoritative: appearance, draft: appearance }
}

export function themeManagerAppearanceIsDirty(state: ThemeManagerAppearanceState): boolean {
  return !appearanceEqual(state.authoritative, state.draft)
}

export function themeManagerAppearanceReducer(
  state: ThemeManagerAppearanceState,
  action: ThemeManagerAppearanceAction,
): ThemeManagerAppearanceState {
  switch (action.type) {
    case 'authoritative-changed':
      return themeManagerAppearanceIsDirty(state)
        ? { ...state, authoritative: action.appearance }
        : { authoritative: action.appearance, draft: action.appearance }
    case 'saved':
      return { authoritative: action.appearance, draft: action.appearance }
    case 'reset':
      return { ...state, draft: state.authoritative }
    case 'select-family': {
      const family = action.families.find((candidate) => candidate.id === action.familyId)
      if (family === undefined) return state
      return {
        ...state,
        draft: {
          ...state.draft,
          activeFamilyId: family.id,
          mode: validAppearanceMode(family, state.draft.mode),
        },
      }
    }
    case 'select-mode': {
      const family = action.families.find((candidate) => candidate.id === state.draft.activeFamilyId)
      if (family === undefined || !familySupportsAppearanceMode(family, action.mode)) return state
      return { ...state, draft: { ...state.draft, mode: action.mode } }
    }
    case 'terminal-follow':
      return { ...state, draft: { ...state.draft, terminal: { mode: 'follow' } } }
    case 'terminal-override-family': {
      const family = action.families.find((candidate) => candidate.id === action.familyId)
      if (family === undefined) return state
      const currentVariant = state.draft.terminal.mode === 'override'
        ? state.draft.terminal.variant
        : preferredVariant(family)
      const variant = family.variants[currentVariant] === undefined ? preferredVariant(family) : currentVariant
      return {
        ...state,
        draft: { ...state.draft, terminal: { mode: 'override', familyId: family.id, variant } },
      }
    }
    case 'terminal-override-variant': {
      const terminal = state.draft.terminal
      if (terminal.mode !== 'override') return state
      const family = action.families.find((candidate) => candidate.id === terminal.familyId)
      if (family?.variants[action.variant] === undefined) return state
      return {
        ...state,
        draft: { ...state.draft, terminal: { ...terminal, variant: action.variant } },
      }
    }
    case 'market-colors':
      return { ...state, draft: { ...state.draft, marketColors: action.value } }
    case 'market-direction':
      return { ...state, draft: { ...state.draft, marketDirection: action.value } }
    case 'status-colors':
      return { ...state, draft: { ...state.draft, statusColors: action.value } }
    default:
      return assertNever(action)
  }
}

export function familySupportsAppearanceMode(family: ThemeFamily, mode: AppearanceMode): boolean {
  return mode === 'system'
    ? family.variants.light !== undefined && family.variants.dark !== undefined
    : family.variants[mode] !== undefined
}

function validAppearanceMode(family: ThemeFamily, requested: AppearanceMode): AppearanceMode {
  return familySupportsAppearanceMode(family, requested) ? requested : preferredVariant(family)
}

function preferredVariant(family: ThemeFamily): ThemeVariantMode {
  if (family.variants.dark !== undefined) return 'dark'
  if (family.variants.light !== undefined) return 'light'
  throw new Error(`Theme family ${family.id} has no variants`)
}

function appearanceEqual(left: AppearancePreferences, right: AppearancePreferences): boolean {
  return left.activeFamilyId === right.activeFamilyId
    && left.mode === right.mode
    && left.marketColors === right.marketColors
    && left.marketDirection === right.marketDirection
    && left.statusColors === right.statusColors
    && left.terminal.mode === right.terminal.mode
    && (left.terminal.mode === 'follow'
      || (right.terminal.mode === 'override'
        && left.terminal.familyId === right.terminal.familyId
        && left.terminal.variant === right.terminal.variant))
}

function assertNever(value: never): never {
  throw new Error(`Unhandled appearance action: ${JSON.stringify(value)}`)
}
