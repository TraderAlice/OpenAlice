import type { ResolvedThemeTokens, ThemePalette, ThemeVariant } from '../api/themes'
import { projectSemanticConsumerVariables } from './semanticConsumers'
import { DEFAULT_COLOR_POLICY, projectColorPolicy, type ColorPolicyPreferences } from './colorPolicy'

export const THEME_MAPPING_VERSION = 1 as const

type PaletteKey = keyof Required<ThemePalette>
type TokenKey = keyof ResolvedThemeTokens

const paletteKeys = [
  'base00', 'base01', 'base02', 'base03', 'base04', 'base05', 'base06', 'base07',
  'base08', 'base09', 'base0A', 'base0B', 'base0C', 'base0D', 'base0E', 'base0F',
  'base10', 'base11', 'base12', 'base13', 'base14', 'base15', 'base16', 'base17',
] as const satisfies readonly PaletteKey[]

export const resolvedTokenKeys = [
  'pageBackground', 'secondarySurface', 'cardSurface', 'border', 'mutedText', 'bodyText',
  'strongText', 'highestContrastText', 'danger', 'orange', 'warning', 'success', 'info',
  'accent', 'secondaryAccent', 'special', 'onAccent', 'hoverSurface', 'activeSurface',
  'selection', 'focusRing', 'subtleSurface', 'chartGrid', 'overlay',
] as const satisfies readonly TokenKey[]

const publicAliases = {
  '--color-bg': 'pageBackground',
  '--color-bg-secondary': 'secondarySurface',
  '--color-bg-tertiary': 'cardSurface',
  '--color-border': 'border',
  '--color-text': 'bodyText',
  '--color-text-muted': 'mutedText',
  '--color-accent': 'accent',
  '--color-user-bubble': 'accent',
  '--color-assistant-bubble': 'cardSurface',
  '--color-notification-bg': 'subtleSurface',
  '--color-notification-border': 'warning',
  '--color-green': 'success',
  '--color-red': 'danger',
  '--color-purple': 'secondaryAccent',
} as const satisfies Readonly<Record<`--${string}`, TokenKey>>

export interface ThemeProjection {
  all: Readonly<Record<string, string>>
  firstPaint: Readonly<Record<string, string>>
  fingerprint: string
}

export function fingerprintVariableNames(names: readonly string[]): string {
  return fingerprintText([...names].sort().join(';'))
}

/** The only runtime authority that translates a validated variant into CSS. */
export function projectThemeVariant(
  variant: ThemeVariant,
  colorPolicy: ColorPolicyPreferences = DEFAULT_COLOR_POLICY,
): ThemeProjection {
  const tokenVariables = Object.fromEntries(resolvedTokenKeys.map((key) => [
    `--oa-token-${toKebabCase(key)}`,
    variant.tokens[key],
  ]))
  const aliases = Object.fromEntries(Object.entries(publicAliases).map(([name, key]) => [
    name,
    variant.tokens[key],
  ]))
  const derivedValues = {
    '--color-accent-dim': `color-mix(in srgb, ${variant.tokens.accent} 16%, transparent)`,
    '--color-purple-dim': `color-mix(in srgb, ${variant.tokens.secondaryAccent} 16%, transparent)`,
    '--color-overlay': `color-mix(in srgb, ${variant.tokens.overlay} 55%, transparent)`,
    '--color-overlay-strong': `color-mix(in srgb, ${variant.tokens.activeSurface} 72%, transparent)`,
    '--app-bg-wash': `radial-gradient(circle at 50% 26%, color-mix(in srgb, ${variant.tokens.accent} 6%, transparent), transparent 38rem)`,
  }
  const derived = {
    ...derivedValues,
    '--oa-runtime-accent-dim': derivedValues['--color-accent-dim'],
    '--oa-runtime-purple-dim': derivedValues['--color-purple-dim'],
    '--oa-runtime-overlay': derivedValues['--color-overlay'],
    '--oa-runtime-overlay-strong': derivedValues['--color-overlay-strong'],
  }
  const semanticConsumers = projectSemanticConsumerVariables(variant.palette)
  const policyVariables = projectColorPolicy(variant, colorPolicy)
  // Empty optional Base24 slots actively clear values left by the previously
  // selected family; no prior variant is allowed to remain a second authority.
  const paletteVariables = Object.fromEntries(paletteKeys.map((key) => [
    `--oa-${key.toLowerCase()}`,
    variant.palette[key] ?? '',
  ]))
  const consumerProjection = { ...tokenVariables, ...aliases, ...derived, ...semanticConsumers, ...policyVariables }
  const all = { ...paletteVariables, ...consumerProjection }
  // The cache is a resolved consumer projection, not a second persisted theme
  // palette. Raw Base24 slots are applied after the appearance API resolves;
  // every first-frame consumer is represented by a concrete semantic value.
  return {
    all,
    firstPaint: consumerProjection,
    fingerprint: fingerprintVariables(consumerProjection),
  }
}

export function fingerprintVariables(variables: Readonly<Record<string, string>>): string {
  const serialized = Object.entries(variables).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([name, value]) => `${name}:${value}`).join(';')
  return fingerprintText(serialized)
}

function fingerprintText(serialized: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < serialized.length; index += 1) {
    hash ^= serialized.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32-${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function toKebabCase(value: string): string {
  return value.replace(/[A-Z]/g, (character) => `-${character.toLowerCase()}`)
}
