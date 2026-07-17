import { resolveThemeTokens } from './colors.js'
import { THEME_MAPPING_VERSION, themeFamilySchema, type ThemeFamily, type ThemePalette } from './types.js'

const createdAt = '2026-07-18T00:00:00.000Z'

const lightPalette: ThemePalette = {
  base00: '#fbfaf6', base01: '#f1ede4', base02: '#e4dccb', base03: '#d8d2c4',
  base04: '#5e6573', base05: '#1c2a41', base06: '#152136', base07: '#08101d',
  base08: '#be4138', base09: '#c27028', base0A: '#c99a2e', base0B: '#2e8b6f',
  base0C: '#1b7c83', base0D: '#2f62b0', base0E: '#6b5bc2', base0F: '#8a5b2f',
}

const darkPalette: ThemePalette = {
  base00: '#0b0c0e', base01: '#0e0f12', base02: '#1a1b21', base03: '#24262c',
  base04: '#8f929b', base05: '#dfe1e6', base06: '#eef0f4', base07: '#ffffff',
  base08: '#e5484d', base09: '#e58a3c', base0A: '#c58b4e', base0B: '#23b99a',
  base0C: '#4db6c6', base0D: '#3b82f6', base0E: '#8f72ff', base0F: '#c58245',
}

export const BUILTIN_OPENALICE_FAMILY: ThemeFamily = themeFamilySchema.parse({
  schemaVersion: 1,
  id: 'builtin-openalice',
  name: 'OpenAlice',
  variants: {
    light: {
      id: 'builtin-openalice-light',
      name: 'OpenAlice Light',
      mode: 'light',
      palette: lightPalette,
      provenance: { kind: 'builtin', sourceName: 'OpenAlice Daybreak', mappingVersion: THEME_MAPPING_VERSION },
      tokens: resolveThemeTokens(lightPalette),
      createdAt,
    },
    dark: {
      id: 'builtin-openalice-dark',
      name: 'OpenAlice Dark',
      mode: 'dark',
      palette: darkPalette,
      provenance: { kind: 'builtin', sourceName: 'OpenAlice Midnight', mappingVersion: THEME_MAPPING_VERSION },
      tokens: resolveThemeTokens(darkPalette),
      createdAt,
    },
  },
})

export const BUILTIN_THEME_FAMILIES: readonly ThemeFamily[] = [BUILTIN_OPENALICE_FAMILY]
