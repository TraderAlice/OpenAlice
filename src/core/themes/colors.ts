import type { ResolvedThemeTokens, RgbHex, ThemePalette } from './types.js'

interface Rgb {
  r: number
  g: number
  b: number
}

interface Oklab {
  l: number
  a: number
  b: number
}

export interface ThemeContrastFailure {
  foreground: keyof ResolvedThemeTokens
  background: keyof ResolvedThemeTokens
  actual: number
  required: number
}

export class ThemeContrastError extends Error {
  constructor(readonly failures: readonly ThemeContrastFailure[]) {
    super(`Theme contrast validation failed: ${failures.map((failure) => (
      `${failure.foreground}/${failure.background}=${failure.actual.toFixed(2)}<${failure.required}`
    )).join(', ')}`)
    this.name = 'ThemeContrastError'
  }
}

export function normalizeRgbHex(input: string): RgbHex {
  const normalized = input.startsWith('#') ? input : `#${input}`
  if (!/^#[0-9a-fA-F]{6}$/.test(normalized)) {
    throw new Error(`Expected a six-digit opaque RGB color, received ${JSON.stringify(input)}`)
  }
  return normalized.toLowerCase() as RgbHex
}

export function contrastRatio(a: RgbHex, b: RgbHex): number {
  const la = relativeLuminance(hexToRgb(a))
  const lb = relativeLuminance(hexToRgb(b))
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

export function mixOklab(a: RgbHex, b: RgbHex, amountOfB: number): RgbHex {
  if (!Number.isFinite(amountOfB) || amountOfB < 0 || amountOfB > 1) {
    throw new Error('OKLab mix amount must be between 0 and 1')
  }
  const aa = rgbToOklab(hexToRgb(a))
  const bb = rgbToOklab(hexToRgb(b))
  return rgbToHex(oklabToRgb({
    l: aa.l + (bb.l - aa.l) * amountOfB,
    a: aa.a + (bb.a - aa.a) * amountOfB,
    b: aa.b + (bb.b - aa.b) * amountOfB,
  }))
}

export function resolveThemeTokens(palette: ThemePalette): ResolvedThemeTokens {
  const onAccentCandidates = [palette.base00, palette.base07] as const
  const onAccent = [...onAccentCandidates].sort((a, b) => (
    contrastRatio(b, palette.base0D) - contrastRatio(a, palette.base0D)
  ))[0]!

  const tokens: ResolvedThemeTokens = {
    pageBackground: palette.base00,
    secondarySurface: palette.base01,
    cardSurface: palette.base02,
    border: palette.base03,
    mutedText: palette.base04,
    bodyText: palette.base05,
    strongText: palette.base06,
    highestContrastText: palette.base07,
    danger: palette.base08,
    orange: palette.base09,
    warning: palette.base0A,
    success: palette.base0B,
    info: palette.base0C,
    accent: palette.base0D,
    secondaryAccent: palette.base0E,
    special: palette.base0F,
    onAccent,
    hoverSurface: mixOklab(palette.base01, palette.base05, 0.08),
    activeSurface: mixOklab(palette.base01, palette.base0D, 0.16),
    selection: mixOklab(palette.base00, palette.base0D, 0.28),
    focusRing: palette.base0D,
    subtleSurface: mixOklab(palette.base00, palette.base05, 0.045),
    chartGrid: mixOklab(palette.base01, palette.base04, 0.32),
    overlay: mixOklab(palette.base00, palette.base07, 0.08),
  }
  validateThemeContrast(tokens)
  return tokens
}

export function validateThemeContrast(tokens: ResolvedThemeTokens): void {
  const checks: ReadonlyArray<{
    foreground: keyof ResolvedThemeTokens
    background: keyof ResolvedThemeTokens
    required: number
  }> = [
    { foreground: 'bodyText', background: 'pageBackground', required: 4.5 },
    { foreground: 'mutedText', background: 'pageBackground', required: 4.5 },
    { foreground: 'onAccent', background: 'accent', required: 4.5 },
    { foreground: 'focusRing', background: 'pageBackground', required: 3 },
    { foreground: 'focusRing', background: 'cardSurface', required: 3 },
  ]
  const failures = checks.flatMap((check) => {
    const actual = contrastRatio(tokens[check.foreground], tokens[check.background])
    return actual + Number.EPSILON < check.required ? [{ ...check, actual }] : []
  })
  if (failures.length > 0) throw new ThemeContrastError(failures)
}

function hexToRgb(hex: RgbHex): Rgb {
  return {
    r: Number.parseInt(hex.slice(1, 3), 16) / 255,
    g: Number.parseInt(hex.slice(3, 5), 16) / 255,
    b: Number.parseInt(hex.slice(5, 7), 16) / 255,
  }
}

function rgbToHex(rgb: Rgb): RgbHex {
  const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255)
    .toString(16).padStart(2, '0')
  return `#${channel(rgb.r)}${channel(rgb.g)}${channel(rgb.b)}` as RgbHex
}

function srgbToLinear(value: number): number {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function linearToSrgb(value: number): number {
  return value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055
}

function relativeLuminance(rgb: Rgb): number {
  return 0.2126 * srgbToLinear(rgb.r)
    + 0.7152 * srgbToLinear(rgb.g)
    + 0.0722 * srgbToLinear(rgb.b)
}

function rgbToOklab(rgb: Rgb): Oklab {
  const r = srgbToLinear(rgb.r)
  const g = srgbToLinear(rgb.g)
  const b = srgbToLinear(rgb.b)
  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
  const lRoot = Math.cbrt(l)
  const mRoot = Math.cbrt(m)
  const sRoot = Math.cbrt(s)
  return {
    l: 0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    a: 1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    b: 0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  }
}

function oklabToRgb(oklab: Oklab): Rgb {
  const lRoot = oklab.l + 0.3963377774 * oklab.a + 0.2158037573 * oklab.b
  const mRoot = oklab.l - 0.1055613458 * oklab.a - 0.0638541728 * oklab.b
  const sRoot = oklab.l - 0.0894841775 * oklab.a - 1.291485548 * oklab.b
  const l = lRoot ** 3
  const m = mRoot ** 3
  const s = sRoot ** 3
  return {
    r: linearToSrgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: linearToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: linearToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}
