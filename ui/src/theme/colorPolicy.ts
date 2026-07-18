import type { AppearancePreferences, RgbHex, ThemeVariant } from '../api/themes'

export type ColorPolicyPreferences = Pick<AppearancePreferences, 'marketColors' | 'marketDirection' | 'statusColors'>

export const DEFAULT_COLOR_POLICY: ColorPolicyPreferences = {
  marketColors: 'protected',
  marketDirection: 'green-up-red-down',
  statusColors: 'protected',
}

type ModePair = Readonly<Record<'light' | 'dark', RgbHex>>

// These colors are product safety colors, not theme decoration. Each pair has
// been selected for >= 3:1 graphical contrast on the corresponding built-in
// light/dark surface and remains independent from imported theme palettes.
const protectedColors = {
  green: { light: '#137333', dark: '#81c995' },
  red: { light: '#b3261e', dark: '#f28b82' },
  warning: { light: '#8a4b00', dark: '#fdd663' },
  info: { light: '#0b57d0', dark: '#8ab4f8' },
} as const satisfies Readonly<Record<string, ModePair>>

export function projectColorPolicy(
  variant: ThemeVariant,
  preferences: ColorPolicyPreferences,
): Readonly<Record<string, string>> {
  const mode = variant.mode
  const green = preferences.marketColors === 'theme' ? variant.palette.base0B : protectedColors.green[mode]
  const red = preferences.marketColors === 'theme' ? variant.palette.base08 : protectedColors.red[mode]
  const up = preferences.marketDirection === 'green-up-red-down' ? green : red
  const down = preferences.marketDirection === 'green-up-red-down' ? red : green
  const success = preferences.statusColors === 'theme' ? variant.tokens.success : protectedColors.green[mode]
  const danger = preferences.statusColors === 'theme' ? variant.tokens.danger : protectedColors.red[mode]
  const warning = preferences.statusColors === 'theme' ? variant.tokens.warning : protectedColors.warning[mode]
  const info = preferences.statusColors === 'theme' ? variant.tokens.info : protectedColors.info[mode]

  const protectedRisk = protectedColors.red[mode]
  return {
    '--oa-market-up': up,
    '--oa-market-down': down,
    '--oa-market-positive': up,
    '--oa-market-negative': down,
    '--oa-market-buy': up,
    '--oa-market-sell': down,
    '--oa-market-volume-up': hexWithAlpha(up, 0x55),
    '--oa-market-volume-down': hexWithAlpha(down, 0x55),
    '--oa-market-volume-up-solid': up,
    '--oa-market-volume-down-solid': down,
    '--oa-chart-background': variant.tokens.cardSurface,
    '--oa-chart-grid': variant.tokens.chartGrid,
    '--oa-chart-axis-text': variant.tokens.mutedText,
    '--oa-chart-axis-border': variant.tokens.border,
    '--oa-chart-crosshair': variant.tokens.bodyText,
    '--oa-chart-selection': variant.tokens.selection,
    '--oa-status-success': success,
    '--oa-status-warning': warning,
    '--oa-status-danger': danger,
    '--oa-status-info': info,
    // Safety meanings never follow either user-selectable color source.
    '--oa-risk-destructive': protectedRisk,
    '--oa-risk-permission-denied': protectedRisk,
    '--oa-risk-trade-confirm': protectedRisk,
    '--oa-risk-broker-write-failed': protectedRisk,
    '--oa-risk-risk-blocked': protectedRisk,
    '--oa-risk-background': hexWithAlpha(protectedRisk, 0x1f),
    '--oa-risk-border': hexWithAlpha(protectedRisk, 0x8c),
  }
}

function hexWithAlpha(color: RgbHex, alpha: number): string {
  // Validated theme colors are canonical #RRGGBB at this boundary.
  return `${color}${alpha.toString(16).padStart(2, '0')}`
}
