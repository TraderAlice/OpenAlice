import { create } from 'zustand'

import {
  themesApi,
  type AppearanceMode,
  type AppearancePreferences,
  type ThemeFamily,
  type ThemeVariant,
  type ThemeVariantMode,
} from '../api/themes'

export type AppTheme = 'light' | 'dark' | 'auto'
const CYCLE: readonly AppTheme[] = ['auto', 'light', 'dark']

interface ThemeStore {
  theme: AppTheme
  families: ThemeFamily[]
  appearance: AppearancePreferences | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  initialize: () => Promise<void>
  refreshFamilies: () => Promise<void>
  saveAppearance: (appearance: AppearancePreferences) => Promise<void>
  setTheme: (theme: AppTheme) => void
  cycleTheme: () => void
  saveFamily: (family: ThemeFamily) => Promise<void>
  replaceFamily: (family: ThemeFamily) => Promise<void>
  deleteFamily: (familyId: string) => Promise<void>
}

const defaultAppearance: AppearancePreferences = {
  activeFamilyId: 'builtin-openalice',
  mode: 'system',
  terminal: { mode: 'follow' },
  marketColors: 'protected',
  marketDirection: 'green-up-red-down',
  statusColors: 'protected',
}

let initializePromise: Promise<void> | null = null

export const useThemeStore = create<ThemeStore>((set, get) => ({
  theme: 'auto',
  families: [],
  appearance: null,
  status: 'idle',
  error: null,
  initialize: async () => {
    if (get().status === 'ready') return
    if (initializePromise !== null) return initializePromise
    set({ status: 'loading', error: null })
    initializePromise = Promise.all([themesApi.list(), themesApi.appearance()])
      .then(([families, appearance]) => {
        set({
          families,
          appearance,
          theme: appearanceModeToAppTheme(appearance.mode),
          status: 'ready',
          error: null,
        })
      })
      .catch((error: unknown) => {
        set({ status: 'error', error: errorMessage(error) })
        throw error
      })
      .finally(() => { initializePromise = null })
    return initializePromise
  },
  refreshFamilies: async () => {
    const families = await themesApi.list()
    set({ families })
  },
  saveAppearance: async (appearance) => {
    const saved = await themesApi.saveAppearance(appearance)
    set({ appearance: saved, theme: appearanceModeToAppTheme(saved.mode), error: null })
  },
  setTheme: (theme) => {
    const previous = get().appearance ?? defaultAppearance
    set({ theme })
    void get().saveAppearance({ ...previous, mode: appThemeToAppearanceMode(theme) })
      .catch((error: unknown) => {
        set({ theme: appearanceModeToAppTheme(previous.mode), error: errorMessage(error) })
      })
  },
  cycleTheme: () => {
    const current = get().theme
    get().setTheme(CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length]!)
  },
  saveFamily: async (family) => {
    const saved = await themesApi.save(family)
    set({ families: upsertFamily(get().families, saved), error: null })
  },
  replaceFamily: async (family) => {
    const saved = await themesApi.replace(family)
    set({ families: upsertFamily(get().families, saved), error: null })
  },
  deleteFamily: async (familyId) => {
    await themesApi.delete(familyId)
    set({ families: get().families.filter((family) => family.id !== familyId), error: null })
  },
}))

export function readInitialTheme(): AppTheme {
  return useThemeStore.getState().theme
}

export function activeThemeVariant(
  families: readonly ThemeFamily[],
  appearance: AppearancePreferences | null,
  systemMode: ThemeVariantMode,
): ThemeVariant | undefined {
  if (appearance === null) return undefined
  const family = families.find((item) => item.id === appearance.activeFamilyId)
  if (family === undefined) return undefined
  const mode = appearance.mode === 'system' ? systemMode : appearance.mode
  return family.variants[mode]
}

export function terminalThemeVariant(
  families: readonly ThemeFamily[],
  appearance: AppearancePreferences | null,
  systemMode: ThemeVariantMode,
): ThemeVariant | undefined {
  const terminal = appearance?.terminal
  if (terminal?.mode === 'override') {
    return families.find((family) => family.id === terminal.familyId)
      ?.variants[terminal.variant]
  }
  return activeThemeVariant(families, appearance, systemMode)
}

function appearanceModeToAppTheme(mode: AppearanceMode): AppTheme {
  return mode === 'system' ? 'auto' : mode
}

function appThemeToAppearanceMode(theme: AppTheme): AppearanceMode {
  return theme === 'auto' ? 'system' : theme
}

function upsertFamily(families: readonly ThemeFamily[], family: ThemeFamily): ThemeFamily[] {
  return [...families.filter((item) => item.id !== family.id), family]
    .sort((a, b) => a.name.localeCompare(b.name))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
