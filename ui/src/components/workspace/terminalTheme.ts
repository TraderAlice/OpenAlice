import { useMemo } from 'react'

import { terminalThemeVariant, useThemeStore } from '../../theme/store'
import { useEffectiveTheme } from '../../theme/useEffectiveTheme'
import {
  resolveTerminalThemeVariant,
  terminalThemeProfileForVariant,
  type TerminalThemeProfile,
  type TerminalThemeVariant,
} from './terminalThemeProfile'

export {
  applyTerminalTheme,
  resolveTerminalThemeVariant,
  terminalClientThemeDTO,
  terminalThemeProfileForVariant,
  xtermThemeForVariant,
  type TerminalClientThemeDTO,
  type TerminalThemeProfile,
  type TerminalThemeRgb,
  type TerminalStatusColors,
  type TerminalThemeVariant,
} from './terminalThemeProfile'

export type TerminalThemePreference = import('./terminalThemeProfile').TerminalThemePreference
const CYCLE: readonly TerminalThemePreference[] = ['follow', 'dark', 'light']

interface TerminalThemeControlStore {
  preference: TerminalThemePreference
  setPreference: (preference: TerminalThemePreference) => void
  cyclePreference: () => void
}

export function useTerminalThemeStore<T>(selector: (store: TerminalThemeControlStore) => T): T {
  const appearance = useThemeStore((state) => state.appearance)
  const families = useThemeStore((state) => state.families)
  const saveAppearance = useThemeStore((state) => state.saveAppearance)
  const preference: TerminalThemePreference = appearance?.terminal.mode === 'override'
    ? appearance.terminal.variant
    : 'follow'
  const setPreference = (next: TerminalThemePreference) => {
    if (appearance === null) return
    if (next === 'follow') {
      void saveAppearance({ ...appearance, terminal: { mode: 'follow' } })
      return
    }
    const family = families.find((item) => item.id === appearance.activeFamilyId)
    if (family?.variants[next] === undefined) return
    void saveAppearance({
      ...appearance,
      terminal: { mode: 'override', familyId: family.id, variant: next },
    })
  }
  return selector({
    preference,
    setPreference,
    cyclePreference: () => setPreference(CYCLE[(CYCLE.indexOf(preference) + 1) % CYCLE.length]!),
  })
}

export function useResolvedTerminalTheme(): {
  preference: TerminalThemePreference
  appTheme: TerminalThemeVariant
  variant: TerminalThemeVariant
  profile: TerminalThemeProfile
} {
  const appTheme = useEffectiveTheme()
  const families = useThemeStore((state) => state.families)
  const appearance = useThemeStore((state) => state.appearance)
  const selected = terminalThemeVariant(families, appearance, appTheme)
  if (selected === undefined) {
    throw new Error('Active terminal theme variant is unavailable; appearance state was not resolved')
  }
  const preference: TerminalThemePreference = appearance?.terminal.mode === 'override'
    ? appearance.terminal.variant
    : 'follow'
  const profile = useMemo(() => terminalThemeProfileForVariant(selected), [selected])
  return { preference, appTheme, variant: selected.mode, profile }
}

export function useResolvedTerminalThemeVariant(): TerminalThemeVariant {
  return useResolvedTerminalTheme().variant
}
