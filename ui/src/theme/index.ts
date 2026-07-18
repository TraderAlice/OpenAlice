import type { AppearanceMode, ThemeVariant, ThemeVariantMode } from '../api/themes'
import { createFirstPaintCache, FIRST_PAINT_THEME_CACHE_KEY } from './firstPaint'
import { projectThemeVariant, THEME_MAPPING_VERSION } from './projection'
import { activeThemeVariant, useThemeStore } from './store'

export { FIRST_PAINT_THEME_CACHE_KEY } from './firstPaint'
export { fingerprintVariables, projectThemeVariant } from './projection'

const media = window.matchMedia('(prefers-color-scheme: dark)')

export async function initializeTheme(): Promise<void> {
  const bootIdentity = readBootIdentity()
  try {
    await useThemeStore.getState().initialize()
    applyCurrentTheme(true)
    validateBootIdentity(bootIdentity)
  } catch (error) {
    clearThemeProjection()
    throw error
  }
}


interface BootThemeIdentity {
  familyId: string
  variantId: string
  fingerprint: string
}

function readBootIdentity(): BootThemeIdentity | null {
  const root = document.documentElement
  if (root.dataset.themeFirstPaint !== 'cache') return null
  const { themeFamily, themeVariant, themeFingerprint } = root.dataset
  return themeFamily && themeVariant && themeFingerprint
    ? { familyId: themeFamily, variantId: themeVariant, fingerprint: themeFingerprint }
    : null
}

function validateBootIdentity(boot: BootThemeIdentity | null): void {
  if (boot === null) return
  const root = document.documentElement
  if (root.dataset.themeFamily === boot.familyId
    && root.dataset.themeVariant === boot.variantId
    && root.dataset.themeFingerprint === boot.fingerprint) return
  root.dataset.themeFirstPaint = 'stale'
  console.warn('[theme:first-paint] Cached projection did not match authoritative file-backed appearance')
}

export function applyThemeVariant(
  familyId: string,
  appearanceMode: AppearanceMode,
  variant: ThemeVariant,
): void {
  if (variant.provenance.mappingVersion !== THEME_MAPPING_VERSION) {
    throw new Error(`Unsupported theme mapping version ${variant.provenance.mappingVersion}`)
  }
  const projection = projectThemeVariant(variant)
  // Cache persistence is best-effort: storage policy must not prevent the
  // authoritative file-backed theme from rendering in the current process.
  let cachePersisted = true
  try {
    localStorage.setItem(FIRST_PAINT_THEME_CACHE_KEY, JSON.stringify(createFirstPaintCache({
      appearanceMode,
      resolvedMode: variant.mode,
      familyId,
      variantId: variant.id,
      variables: projection.firstPaint,
    })))
  } catch (error) {
    cachePersisted = false
    console.warn('[theme:first-paint] Cache persistence unavailable', error)
    removeFirstPaintCache()
  }
  const root = document.documentElement
  root.dataset.theme = variant.mode
  root.dataset.themeAppearance = appearanceMode
  root.dataset.themeFamily = familyId
  root.dataset.themeVariant = variant.id
  root.dataset.themeFingerprint = projection.fingerprint
  if (!cachePersisted) root.dataset.themeFirstPaint = 'unavailable'
  root.style.colorScheme = variant.mode
  applyVariables(projection.all)
}

function applyCurrentTheme(strict = false): void {
  const state = useThemeStore.getState()
  const systemMode: ThemeVariantMode = media.matches ? 'dark' : 'light'
  const variant = activeThemeVariant(state.families, state.appearance, systemMode)
  if (variant !== undefined && state.appearance !== null) {
    applyThemeVariant(state.appearance.activeFamilyId, state.appearance.mode, variant)
    return
  }
  if (state.appearance !== null) {
    clearThemeProjection()
    const error = new Error(`Active theme ${state.appearance.activeFamilyId} has no resolved ${systemMode} variant`)
    console.error('[theme] Refusing to use a stale or fallback theme', error)
    if (strict) throw error
  }
}

function applyVariables(variables: Readonly<Record<string, string>>): void {
  const style = document.documentElement.style
  for (const [name, value] of Object.entries(variables)) style.setProperty(name, value)
}

function removeFirstPaintCache(): void {
  try {
    localStorage.removeItem(FIRST_PAINT_THEME_CACHE_KEY)
  } catch (error) {
    console.warn('[theme:first-paint] Cache eviction unavailable', error)
  }
}

export function clearThemeProjection(): void {
  const style = document.documentElement.style
  const dynamicNames: string[] = []
  for (let index = 0; index < style.length; index += 1) {
    const name = style.item(index)
    if (name.startsWith('--oa-') || name.startsWith('--color-') || name === '--app-bg-wash') {
      dynamicNames.push(name)
    }
  }
  for (const name of dynamicNames) style.removeProperty(name)
  removeFirstPaintCache()
  const root = document.documentElement
  delete root.dataset.theme
  delete root.dataset.themeAppearance
  delete root.dataset.themeFamily
  delete root.dataset.themeVariant
  delete root.dataset.themeFingerprint
  delete root.dataset.themeFirstPaint
  root.style.removeProperty('color-scheme')
}

useThemeStore.subscribe(() => applyCurrentTheme())
media.addEventListener('change', () => {
  if (useThemeStore.getState().appearance?.mode === 'system') applyCurrentTheme()
})
