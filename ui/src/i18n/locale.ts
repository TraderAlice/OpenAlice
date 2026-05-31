export type AppLocale = 'en' | 'zh'

export const APP_LOCALE_KEY = 'openalice-settings-locale'

export function resolveAppLocale(): AppLocale {
  if (typeof window === 'undefined') return 'en'

  try {
    const raw = localStorage.getItem(APP_LOCALE_KEY)
    if (raw === 'zh' || raw === 'en') return raw
  } catch {
    // ignore storage access errors
  }

  const browser = (window.navigator?.language || '').toLowerCase()
  return browser.startsWith('zh') ? 'zh' : 'en'
}

export function saveAppLocale(locale: AppLocale) {
  try {
    localStorage.setItem(APP_LOCALE_KEY, locale)
  } catch {
    // ignore storage write errors
  }
}
