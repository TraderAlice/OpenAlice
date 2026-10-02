/**
 * i18n bootstrap — side-effect module. `import './i18n'` once in main.tsx,
 * BEFORE the first render, so react-i18next's `t()` is ready synchronously
 * (resources are statically bundled — no http backend, no Vite plugin).
 *
 * Wiring is one-directional: the locale store (./store) is the source of
 * truth; here we (a) seed i18next + the formatters with the persisted locale
 * at boot, and (b) subscribe so every later switch re-applies everywhere:
 *   store.setLocale(l) → i18next.changeLanguage + intl.setAppLocale + <html lang>
 */

import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { en } from './locales/en'
import { zh } from './locales/zh'
import { ja } from './locales/ja'
import { zhHant } from './locales/zh-Hant'
import { type AppLocale, setAppLocale } from '../lib/intl'
import { useLocaleStore, readInitialLocale } from './store'

export const defaultNS = 'translation'

export const resources = {
  en: { translation: en },
  zh: { translation: zh },
  ja: { translation: ja },
  'zh-Hant': { translation: zhHant },
}

function publishNativeLocale(locale: AppLocale): void {
  void window.openAlice?.setNativeMenuLocale?.(locale).catch(error => {
    console.error('[i18n] native menu locale update failed', error)
  })
}

function applyLocale(locale: AppLocale): void {
  publishNativeLocale(locale)
  setAppLocale(locale) // formatters (lib/intl, lib/format) follow
  document.documentElement.lang = locale // drives :lang(ja)/:lang(zh-Hant) font swap in index.css
  void i18n.changeLanguage(locale)
}

const initial = readInitialLocale()

void i18n.use(initReactI18next).init({
  resources,
  lng: initial,
  fallbackLng: 'en',
  defaultNS,
  interpolation: { escapeValue: false }, // React already escapes
  returnNull: false,
  react: { useSuspense: false },
})

// Seed the non-i18next consumers for the initial locale (init's lng covers
// i18next itself; these two are ours).
setAppLocale(initial)
document.documentElement.lang = initial
publishNativeLocale(initial)

// Re-apply on every switch. Plain subscribe fires on any state change; guard
// on the locale field so unrelated store writes don't thrash changeLanguage.
useLocaleStore.subscribe((state, prev) => {
  if (state.locale !== prev.locale) applyLocale(state.locale)
})

export { i18n }
