import type { ResolvedThemeTokens, ThemeVariant, ThemeVariantMode } from '../api/themes'
import { activeThemeVariant, useThemeStore } from './store'

export const FIRST_PAINT_THEME_CACHE_KEY = 'openalice.theme.first-paint.v1'

interface FirstPaintThemeCache {
  schemaVersion: 1
  mappingVersion: 1
  familyId: string
  variantId: string
  mode: ThemeVariantMode
  tokens: ResolvedThemeTokens
}

const media = window.matchMedia('(prefers-color-scheme: dark)')
const tokenKeys: ReadonlyArray<keyof ResolvedThemeTokens> = [
  'pageBackground', 'secondarySurface', 'cardSurface', 'border', 'mutedText', 'bodyText',
  'strongText', 'highestContrastText', 'danger', 'orange', 'warning', 'success', 'info',
  'accent', 'secondaryAccent', 'special', 'onAccent', 'hoverSurface', 'activeSurface',
  'selection', 'focusRing', 'subtleSurface', 'chartGrid', 'overlay',
]

export async function initializeTheme(): Promise<void> {
  await useThemeStore.getState().initialize()
  applyCurrentTheme()
}

export function applyThemeVariant(familyId: string, variant: ThemeVariant): void {
  const root = document.documentElement
  root.dataset.theme = variant.mode
  root.dataset.themeFamily = familyId
  root.dataset.themeVariant = variant.id
  root.style.colorScheme = variant.mode
  applyTokens(variant.tokens)
  const cache: FirstPaintThemeCache = {
    schemaVersion: 1,
    mappingVersion: variant.provenance.mappingVersion,
    familyId,
    variantId: variant.id,
    mode: variant.mode,
    tokens: variant.tokens,
  }
  localStorage.setItem(FIRST_PAINT_THEME_CACHE_KEY, JSON.stringify(cache))
}

function applyCurrentTheme(): void {
  const state = useThemeStore.getState()
  const systemMode: ThemeVariantMode = media.matches ? 'dark' : 'light'
  const variant = activeThemeVariant(state.families, state.appearance, systemMode)
  if (variant !== undefined && state.appearance !== null) {
    applyThemeVariant(state.appearance.activeFamilyId, variant)
  }
}

function applyFirstPaintCache(): void {
  try {
    const raw = localStorage.getItem(FIRST_PAINT_THEME_CACHE_KEY)
    if (raw === null) return
    const cache = JSON.parse(raw) as Partial<FirstPaintThemeCache>
    if (cache.schemaVersion !== 1 || cache.mappingVersion !== 1
      || typeof cache.familyId !== 'string' || typeof cache.variantId !== 'string'
      || (cache.mode !== 'light' && cache.mode !== 'dark') || !isTokens(cache.tokens)) {
      localStorage.removeItem(FIRST_PAINT_THEME_CACHE_KEY)
      return
    }
    const root = document.documentElement
    root.dataset.theme = cache.mode
    root.dataset.themeFamily = cache.familyId
    root.dataset.themeVariant = cache.variantId
    root.style.colorScheme = cache.mode
    applyTokens(cache.tokens)
  } catch {
    localStorage.removeItem(FIRST_PAINT_THEME_CACHE_KEY)
  }
}

function applyTokens(tokens: ResolvedThemeTokens): void {
  const style = document.documentElement.style
  const values: Record<string, string> = {
    '--color-bg': tokens.pageBackground,
    '--color-bg-secondary': tokens.secondarySurface,
    '--color-bg-tertiary': tokens.cardSurface,
    '--color-border': tokens.border,
    '--color-text': tokens.bodyText,
    '--color-text-muted': tokens.mutedText,
    '--color-accent': tokens.accent,
    '--color-accent-dim': `color-mix(in srgb, ${tokens.accent} 16%, transparent)`,
    '--color-user-bubble': tokens.accent,
    '--color-assistant-bubble': tokens.cardSurface,
    '--color-notification-bg': tokens.subtleSurface,
    '--color-notification-border': tokens.warning,
    '--color-green': tokens.success,
    '--color-red': tokens.danger,
    '--color-purple': tokens.secondaryAccent,
    '--color-purple-dim': `color-mix(in srgb, ${tokens.secondaryAccent} 16%, transparent)`,
    '--color-overlay': `color-mix(in srgb, ${tokens.overlay} 55%, transparent)`,
    '--color-overlay-strong': `color-mix(in srgb, ${tokens.activeSurface} 72%, transparent)`,
    '--app-bg-wash': `radial-gradient(circle at 50% 26%, color-mix(in srgb, ${tokens.accent} 6%, transparent), transparent 38rem)`,
  }
  for (const [name, value] of Object.entries(values)) style.setProperty(name, value)
}

function isTokens(value: unknown): value is ResolvedThemeTokens {
  if (typeof value !== 'object' || value === null) return false
  const record = value as Record<string, unknown>
  return Object.keys(record).length === tokenKeys.length && tokenKeys.every((key) => (
    typeof record[key] === 'string' && /^#[0-9a-f]{6}$/.test(record[key] as string)
  ))
}

applyFirstPaintCache()
useThemeStore.subscribe(applyCurrentTheme)
media.addEventListener('change', applyCurrentTheme)
