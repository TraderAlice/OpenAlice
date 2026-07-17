import { fetchJson, headers } from './client'

export type ThemeVariantMode = 'light' | 'dark'
export type AppearanceMode = 'system' | ThemeVariantMode
export type RgbHex = `#${string}`

export interface ThemePalette {
  base00: RgbHex
  base01: RgbHex
  base02: RgbHex
  base03: RgbHex
  base04: RgbHex
  base05: RgbHex
  base06: RgbHex
  base07: RgbHex
  base08: RgbHex
  base09: RgbHex
  base0A: RgbHex
  base0B: RgbHex
  base0C: RgbHex
  base0D: RgbHex
  base0E: RgbHex
  base0F: RgbHex
  base10?: RgbHex
  base11?: RgbHex
  base12?: RgbHex
  base13?: RgbHex
  base14?: RgbHex
  base15?: RgbHex
  base16?: RgbHex
  base17?: RgbHex
}

export interface ResolvedThemeTokens {
  pageBackground: RgbHex
  secondarySurface: RgbHex
  cardSurface: RgbHex
  border: RgbHex
  mutedText: RgbHex
  bodyText: RgbHex
  strongText: RgbHex
  highestContrastText: RgbHex
  danger: RgbHex
  orange: RgbHex
  warning: RgbHex
  success: RgbHex
  info: RgbHex
  accent: RgbHex
  secondaryAccent: RgbHex
  special: RgbHex
  onAccent: RgbHex
  hoverSurface: RgbHex
  activeSurface: RgbHex
  selection: RgbHex
  focusRing: RgbHex
  subtleSurface: RgbHex
  chartGrid: RgbHex
  overlay: RgbHex
}

export interface Ansi16Override {
  foreground: RgbHex
  background: RgbHex
  cursor: RgbHex
  cursorText: RgbHex
  selectionBackground: RgbHex
  selectionForeground: RgbHex
  colors: readonly [
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
  ]
}

export type ImportedThemeFormat =
  | 'tinted-base16'
  | 'legacy-base16'
  | 'tinted-base24'
  | 'flat-base24'
  | 'iterm2'
  | 'windows-terminal'
  | 'alacritty'
  | 'kitty-ghostty'
  | 'xresources'

export type ThemeProvenance =
  | { kind: 'builtin'; sourceName: string; mappingVersion: 1 }
  | {
      kind: 'imported'
      format: ImportedThemeFormat
      sourceName: string
      author: string | null
      contentSha256: string
      importedAt: string
      mappingVersion: 1
    }
  | {
      kind: 'generated'
      generator: 'matugen' | 'hellwal'
      executablePath: string
      executableVersion: string
      imageSha256: string
      parameters: Readonly<Record<string, string | number>>
      generatedAt: string
      mappingVersion: 1
    }

export interface ThemeVariant {
  id: string
  name: string
  mode: ThemeVariantMode
  palette: ThemePalette
  ansi16Override?: Ansi16Override
  provenance: ThemeProvenance
  tokens: ResolvedThemeTokens
  createdAt: string
}

export interface ThemeFamily {
  schemaVersion: 1
  id: string
  name: string
  variants: { light?: ThemeVariant; dark?: ThemeVariant }
}

export interface AppearancePreferences {
  activeFamilyId: string
  mode: AppearanceMode
  terminal:
    | { mode: 'follow' }
    | { mode: 'override'; familyId: string; variant: ThemeVariantMode }
  marketColors: 'protected' | 'theme'
  marketDirection: 'green-up-red-down' | 'red-up-green-down'
  statusColors: 'protected' | 'theme'
}

export interface ThemeImportPreview {
  family: ThemeFamily
  format: ImportedThemeFormat
}

export interface ThemeImportDiagnostic {
  path: string
  message: string
}

export class ThemeApiError extends Error {
  constructor(
    readonly status: number,
    readonly payload: { error?: string; diagnostics?: ThemeImportDiagnostic[]; familyId?: string },
  ) {
    super(payload.error ?? `Theme request failed (${status})`)
    this.name = 'ThemeApiError'
  }
}

async function themeJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  if (response.status === 401) {
    window.dispatchEvent(new CustomEvent('app:unauthorized'))
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText })) as ThemeApiError['payload']
    throw new ThemeApiError(response.status, payload)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const themesApi = {
  async list(): Promise<ThemeFamily[]> {
    return (await fetchJson<{ families: ThemeFamily[] }>('/api/themes')).families
  },
  read(familyId: string): Promise<ThemeFamily> {
    return fetchJson(`/api/themes/${encodeURIComponent(familyId)}`)
  },
  appearance(): Promise<AppearancePreferences> {
    return fetchJson('/api/themes/appearance')
  },
  saveAppearance(appearance: AppearancePreferences): Promise<AppearancePreferences> {
    return themeJson('/api/themes/appearance', {
      method: 'PUT', headers, body: JSON.stringify(appearance),
    })
  },
  preview(contents: string, filename: string, legacyVariant?: ThemeVariantMode): Promise<ThemeImportPreview> {
    return themeJson('/api/themes/imports/preview', {
      method: 'POST', headers, body: JSON.stringify({ contents, filename, legacyVariant }),
    })
  },
  save(family: ThemeFamily): Promise<ThemeFamily> {
    return themeJson('/api/themes', { method: 'POST', headers, body: JSON.stringify(family) })
  },
  replace(family: ThemeFamily): Promise<ThemeFamily> {
    return themeJson(`/api/themes/${encodeURIComponent(family.id)}`, {
      method: 'PUT', headers, body: JSON.stringify(family),
    })
  },
  delete(familyId: string): Promise<void> {
    return themeJson(`/api/themes/${encodeURIComponent(familyId)}`, { method: 'DELETE' })
  },
}
