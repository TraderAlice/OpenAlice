import { describe, expect, it } from 'vitest'

import type { AppearancePreferences, ThemeFamily, ThemeVariant } from '../../api/themes'
import {
  createThemeManagerAppearanceState,
  familySupportsAppearanceMode,
  themeManagerAppearanceIsDirty,
  themeManagerAppearanceReducer,
} from './themeManagerState'

const appearance: AppearancePreferences = {
  activeFamilyId: 'complete',
  mode: 'system',
  terminal: { mode: 'follow' },
  marketColors: 'protected',
  marketDirection: 'green-up-red-down',
  statusColors: 'protected',
}

const light = { id: 'light', mode: 'light' } as ThemeVariant
const dark = { id: 'dark', mode: 'dark' } as ThemeVariant
const families: readonly ThemeFamily[] = [
  { schemaVersion: 1, id: 'complete', name: 'Complete', variants: { light, dark } },
  { schemaVersion: 1, id: 'light-only', name: 'Light only', variants: { light } },
  { schemaVersion: 1, id: 'dark-only', name: 'Dark only', variants: { dark } },
]

describe('theme manager appearance reducer', () => {
  it('tracks a complete draft and protects dirty edits from authoritative updates', () => {
    let state = createThemeManagerAppearanceState(appearance)
    expect(themeManagerAppearanceIsDirty(state)).toBe(false)

    state = themeManagerAppearanceReducer(state, { type: 'market-colors', value: 'theme' })
    const external = { ...appearance, statusColors: 'theme' as const }
    state = themeManagerAppearanceReducer(state, { type: 'authoritative-changed', appearance: external })

    expect(state.authoritative).toBe(external)
    expect(state.draft.marketColors).toBe('theme')
    expect(state.draft.statusColors).toBe('protected')
    expect(themeManagerAppearanceIsDirty(state)).toBe(true)
    expect(themeManagerAppearanceReducer(state, { type: 'reset' }).draft).toBe(external)
  })

  it('adopts authoritative updates while clean and converges after save', () => {
    const initial = createThemeManagerAppearanceState(appearance)
    const external = { ...appearance, marketDirection: 'red-up-green-down' as const }
    const updated = themeManagerAppearanceReducer(initial, { type: 'authoritative-changed', appearance: external })
    expect(updated).toEqual({ authoritative: external, draft: external })

    const dirty = themeManagerAppearanceReducer(updated, { type: 'status-colors', value: 'theme' })
    const saved = themeManagerAppearanceReducer(dirty, { type: 'saved', appearance: dirty.draft })
    expect(themeManagerAppearanceIsDirty(saved)).toBe(false)
    expect(saved.authoritative.statusColors).toBe('theme')
  })

  it('keeps app family/mode valid without silently borrowing a missing variant', () => {
    let state = createThemeManagerAppearanceState(appearance)
    state = themeManagerAppearanceReducer(state, { type: 'select-family', familyId: 'light-only', families })
    expect(state.draft).toMatchObject({ activeFamilyId: 'light-only', mode: 'light' })
    expect(themeManagerAppearanceReducer(state, { type: 'select-mode', mode: 'system', families })).toBe(state)
    expect(themeManagerAppearanceReducer(state, { type: 'select-mode', mode: 'dark', families })).toBe(state)
    expect(familySupportsAppearanceMode(families[0]!, 'system')).toBe(true)
    expect(familySupportsAppearanceMode(families[1]!, 'system')).toBe(false)
  })

  it('models terminal follow and an independent family/variant override', () => {
    let state = createThemeManagerAppearanceState(appearance)
    state = themeManagerAppearanceReducer(state, {
      type: 'terminal-override-family', familyId: 'dark-only', families,
    })
    expect(state.draft.terminal).toEqual({ mode: 'override', familyId: 'dark-only', variant: 'dark' })
    expect(themeManagerAppearanceReducer(state, {
      type: 'terminal-override-variant', variant: 'light', families,
    })).toBe(state)

    state = themeManagerAppearanceReducer(state, {
      type: 'terminal-override-family', familyId: 'complete', families,
    })
    state = themeManagerAppearanceReducer(state, {
      type: 'terminal-override-variant', variant: 'light', families,
    })
    expect(state.draft.terminal).toEqual({ mode: 'override', familyId: 'complete', variant: 'light' })
    expect(themeManagerAppearanceReducer(state, { type: 'terminal-follow' }).draft.terminal).toEqual({ mode: 'follow' })
  })

  it('updates every market and status policy as independent draft fields', () => {
    let state = createThemeManagerAppearanceState(appearance)
    state = themeManagerAppearanceReducer(state, { type: 'market-colors', value: 'theme' })
    state = themeManagerAppearanceReducer(state, { type: 'market-direction', value: 'red-up-green-down' })
    state = themeManagerAppearanceReducer(state, { type: 'status-colors', value: 'theme' })
    expect(state.draft).toMatchObject({
      marketColors: 'theme', marketDirection: 'red-up-green-down', statusColors: 'theme',
    })
  })
})
