import { create } from 'zustand'
import { persist } from 'zustand/middleware'

import { useEffectiveTheme } from '../../theme/useEffectiveTheme'
import {
  terminalThemeProfileForVariant,
  type TerminalThemeProfile,
  type TerminalThemeVariant,
} from './terminalThemeProfile'
export {
  terminalClientThemeDTO,
  terminalThemeProfileForVariant,
  xtermThemeForVariant,
  type TerminalClientThemeDTO,
  type TerminalThemeProfile,
  type TerminalThemeRgb,
  type TerminalThemeVariant,
} from './terminalThemeProfile'

export type TerminalThemePreference = 'follow' | 'light' | 'dark'

const CYCLE: readonly TerminalThemePreference[] = ['follow', 'dark', 'light']

interface TerminalThemeStore {
  preference: TerminalThemePreference
  setPreference: (preference: TerminalThemePreference) => void
  cyclePreference: () => void
}

/**
 * Terminal theme is intentionally separate from the app chrome theme, but its
 * resting state follows the app. Users can pin dark/light when a specific TUI
 * behaves better there; a launcher-created light app should not silently spawn
 * a dark terminal by default.
 */
export const useTerminalThemeStore = create<TerminalThemeStore>()(
  persist(
    (set, get) => ({
      preference: 'follow',
      setPreference: (preference) => set({ preference }),
      cyclePreference: () => {
        const i = CYCLE.indexOf(get().preference)
        set({ preference: CYCLE[(i + 1) % CYCLE.length]! })
      },
    }),
    {
      name: 'openalice.terminalTheme.v1',
      // v1 shipped with `dark` as the default. Bump to discard that accidental
      // persisted default so light-mode users return to "follow app".
      version: 2,
    },
  ),
)

export function resolveTerminalThemeVariant(
  preference: TerminalThemePreference,
  appTheme: TerminalThemeVariant,
): TerminalThemeVariant {
  if (preference === 'follow') return appTheme
  return preference
}

export function useResolvedTerminalTheme(): {
  preference: TerminalThemePreference
  appTheme: TerminalThemeVariant
  variant: TerminalThemeVariant
  profile: TerminalThemeProfile
} {
  const appTheme = useEffectiveTheme()
  const preference = useTerminalThemeStore((s) => s.preference)
  const variant = resolveTerminalThemeVariant(preference, appTheme)
  const profile = terminalThemeProfileForVariant(variant)
  return { preference, appTheme, variant, profile }
}

export function useResolvedTerminalThemeVariant(): TerminalThemeVariant {
  return useResolvedTerminalTheme().variant
}
