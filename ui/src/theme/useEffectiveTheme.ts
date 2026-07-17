import { useSyncExternalStore } from 'react'

import { useThemeStore } from './store'

const systemThemeQuery = (): MediaQueryList | null => (
  typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null
)

function subscribeSystem(cb: () => void): () => void {
  const mq = systemThemeQuery()
  if (!mq) return () => undefined
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

/**
 * Resolve the preference (`light | dark | auto`) to a concrete `'light' | 'dark'`
 * — `auto` follows the OS. Use this for the rare surfaces that need the actual
 * value in JS rather than via CSS: notably the xterm terminal, whose palette is
 * a JS object, not a CSS variable. CSS-driven surfaces should just read the
 * `--color-*` tokens (which already resolve `data-theme` + prefers-color-scheme).
 */
export function useEffectiveTheme(): 'light' | 'dark' {
  const theme = useThemeStore((s) => s.theme)
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => systemThemeQuery()?.matches ?? true,
    () => true,
  )
  if (theme === 'light') return 'light'
  if (theme === 'dark') return 'dark'
  return systemDark ? 'dark' : 'light'
}
