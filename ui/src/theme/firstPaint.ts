import type { AppearanceMode, ThemeVariantMode } from '../api/themes'
import { fingerprintVariableNames, fingerprintVariables, THEME_MAPPING_VERSION } from './projection'

export const FIRST_PAINT_THEME_CACHE_KEY = 'openalice.theme.first-paint.v1'
export const FIRST_PAINT_CACHE_SCHEMA_VERSION = 1 as const

export interface FirstPaintThemeCache {
  schemaVersion: typeof FIRST_PAINT_CACHE_SCHEMA_VERSION
  mappingVersion: typeof THEME_MAPPING_VERSION
  appearanceMode: AppearanceMode
  resolvedMode: ThemeVariantMode
  familyId: string
  variantId: string
  tokenFingerprint: string
  projectionShapeFingerprint: string
  variables: Readonly<Record<string, string>>
}

export function createFirstPaintCache(input: Omit<FirstPaintThemeCache, 'schemaVersion' | 'mappingVersion' | 'tokenFingerprint' | 'projectionShapeFingerprint'>): FirstPaintThemeCache {
  return {
    schemaVersion: FIRST_PAINT_CACHE_SCHEMA_VERSION,
    mappingVersion: THEME_MAPPING_VERSION,
    ...input,
    tokenFingerprint: fingerprintVariables(input.variables),
    projectionShapeFingerprint: fingerprintVariableNames(Object.keys(input.variables)),
  }
}
