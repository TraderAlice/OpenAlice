import type { Page } from '../App'
import type { ViewSpec } from '../tabs/types'

export const NANO_HIDDEN_ACTIVITY_PAGES = [
  'market',
  'portfolio',
] as const satisfies readonly Page[]

export const NANO_HIDDEN_SETTINGS_CATEGORIES = [
  'trading',
  'market-data',
  'news-collector',
] as const

export type NanoHiddenSettingsCategory = (typeof NANO_HIDDEN_SETTINGS_CATEGORIES)[number]

export function isNanoProduct(product?: string | null): boolean {
  return product === 'nano'
}

export function isNanoHiddenActivityPage(page: Page): boolean {
  return (NANO_HIDDEN_ACTIVITY_PAGES as readonly Page[]).includes(page)
}

export function isNanoHiddenSettingsCategory(
  category: string,
): category is NanoHiddenSettingsCategory {
  return (NANO_HIDDEN_SETTINGS_CATEGORIES as readonly string[]).includes(category)
}

export function isNanoHiddenViewSpec(spec: ViewSpec): boolean {
  switch (spec.kind) {
    case 'market-list':
    case 'market-rotation':
    case 'market-board':
    case 'market-detail':
    case 'news':
    case 'trading-as-git':
    case 'portfolio':
    case 'uta-detail':
      return true
    case 'settings':
      return isNanoHiddenSettingsCategory(spec.params.category)
    default:
      return false
  }
}
