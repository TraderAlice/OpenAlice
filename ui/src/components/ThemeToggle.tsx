/**
 * The color-theme toggle that lives in the ActivityBar footer. One icon
 * button cycles auto → light → dark → auto. The icon reflects the concrete
 * effective palette (sun / moon); auto adds a tiny badge instead of using an
 * abstract monitor icon.
 *
 * State is the theme store (ui/src/theme/store); the side-effect module
 * applies `<html data-theme>`, CSS does the rest. No prop drilling.
 */

import { Moon, Sun } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useThemeStore, type AppTheme } from '../theme/store'
import { useEffectiveTheme } from '../theme/useEffectiveTheme'

/** What the NEXT click switches to (auto → light → dark → auto). */
const NEXT: Record<AppTheme, AppTheme> = {
  auto: 'light',
  light: 'dark',
  dark: 'auto',
}

export function ThemeToggle() {
  const { t } = useTranslation()
  const theme = useThemeStore((s) => s.theme)
  const cycle = useThemeStore((s) => s.cycleTheme)
  const effectiveTheme = useEffectiveTheme()
  const Icon = effectiveTheme === 'dark' ? Moon : Sun

  return (
    <button
      type="button"
      onClick={cycle}
      title={t('theme.switchTo', { mode: t(`theme.mode.${NEXT[theme]}`) })}
      aria-label={t('theme.switchTo', { mode: t(`theme.mode.${NEXT[theme]}`) })}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-overlay hover:text-text"
    >
      <Icon size={17} strokeWidth={1.75} aria-hidden />
      {theme === 'auto' && (
        <span
          className="absolute right-0 top-0 rounded-[3px] border border-border bg-bg-tertiary px-[2px] py-px text-[7px] font-semibold leading-none text-text-muted shadow-sm"
          aria-hidden
        >
          Auto
        </span>
      )}
    </button>
  )
}
