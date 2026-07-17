import type { ITheme } from '@xterm/xterm'

import type { RgbHex, ThemePalette, ThemeVariant, ThemeVariantMode } from '../../api/themes'

export type TerminalThemeVariant = ThemeVariantMode
export type TerminalThemeRgb = readonly [number, number, number]

export interface TerminalThemeProfile {
  readonly variant: TerminalThemeVariant
  readonly variantId: string
  readonly name: string
  readonly foreground: TerminalThemeRgb
  readonly background: TerminalThemeRgb
  readonly palette: readonly TerminalThemeRgb[]
  readonly extendedAnsi: readonly TerminalThemeRgb[]
  readonly cursorColor: TerminalThemeRgb
  readonly cursorText: TerminalThemeRgb
  readonly selectionBackground: TerminalThemeRgb
  readonly selectionForeground: TerminalThemeRgb
  readonly xtermTheme: ITheme
}

export type TerminalThemePreference = 'follow' | 'light' | 'dark'

export function resolveTerminalThemeVariant(
  preference: TerminalThemePreference,
  appTheme: TerminalThemeVariant,
): TerminalThemeVariant {
  return preference === 'follow' ? appTheme : preference
}

export function terminalThemeProfileForVariant(variant: ThemeVariant): TerminalThemeProfile {
  const ansi = variant.ansi16Override ?? basePaletteAnsi(variant.palette)
  const foreground = hexToRgb(variant.ansi16Override?.foreground ?? variant.palette.base05)
  const background = hexToRgb(variant.ansi16Override?.background ?? variant.palette.base00)
  const cursorColor = hexToRgb(variant.ansi16Override?.cursor ?? variant.palette.base0D)
  const cursorText = hexToRgb(variant.ansi16Override?.cursorText ?? variant.palette.base00)
  const selectionBackground = hexToRgb(
    variant.ansi16Override?.selectionBackground ?? variant.tokens.selection,
  )
  const selectionForeground = hexToRgb(
    variant.ansi16Override?.selectionForeground ?? variant.palette.base05,
  )
  const palette = ansi.colors.map(hexToRgb)
  const extendedAnsi = [
    variant.palette.base09,
    variant.palette.base0F,
    variant.palette.base01,
    variant.palette.base02,
    variant.palette.base04,
    variant.palette.base06,
  ].map(hexToRgb)
  const xtermTheme = xtermThemeFromColors({
    foreground: ansi.foreground,
    background: ansi.background,
    cursor: ansi.cursor,
    cursorText: ansi.cursorText,
    selectionBackground: ansi.selectionBackground,
    selectionForeground: ansi.selectionForeground,
    colors: ansi.colors,
    extendedAnsi: [
      variant.palette.base09,
      variant.palette.base0F,
      variant.palette.base01,
      variant.palette.base02,
      variant.palette.base04,
      variant.palette.base06,
    ],
  })
  return {
    variant: variant.mode,
    variantId: variant.id,
    name: variant.name,
    foreground,
    background,
    palette,
    extendedAnsi,
    cursorColor,
    cursorText,
    selectionBackground,
    selectionForeground,
    xtermTheme,
  }
}

export function xtermThemeForVariant(variant: ThemeVariant): ITheme {
  return terminalThemeProfileForVariant(variant).xtermTheme
}

export interface TerminalClientThemeDTO {
  readonly fg: number
  readonly bg: number
  readonly palette: readonly number[]
  readonly cursorColor: number
  readonly cursorText: number
  readonly selectionBackground: number
  readonly selectionForeground: number
}

export function terminalClientThemeDTO(profile: TerminalThemeProfile): TerminalClientThemeDTO {
  return {
    fg: rgbToInt(profile.foreground),
    bg: rgbToInt(profile.background),
    palette: profile.palette.map(rgbToInt),
    cursorColor: rgbToInt(profile.cursorColor),
    cursorText: rgbToInt(profile.cursorText),
    selectionBackground: rgbToInt(profile.selectionBackground),
    selectionForeground: rgbToInt(profile.selectionForeground),
  }
}

function basePaletteAnsi(palette: ThemePalette): {
  foreground: RgbHex
  background: RgbHex
  cursor: RgbHex
  cursorText: RgbHex
  selectionBackground: RgbHex
  selectionForeground: RgbHex
  colors: readonly [
    RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex, RgbHex,
  ]
} {
  return {
    foreground: palette.base05,
    background: palette.base00,
    cursor: palette.base0D,
    cursorText: palette.base00,
    selectionBackground: palette.base02,
    selectionForeground: palette.base05,
    colors: [
      palette.base00, palette.base08, palette.base0B, palette.base0A,
      palette.base0D, palette.base0E, palette.base0C, palette.base05,
      palette.base03,
      palette.base12 ?? palette.base08,
      palette.base14 ?? palette.base0B,
      palette.base13 ?? palette.base0A,
      palette.base16 ?? palette.base0D,
      palette.base17 ?? palette.base0E,
      palette.base15 ?? palette.base0C,
      palette.base07,
    ],
  }
}

function xtermThemeFromColors(input: {
  foreground: RgbHex
  background: RgbHex
  cursor: RgbHex
  cursorText: RgbHex
  selectionBackground: RgbHex
  selectionForeground: RgbHex
  colors: readonly RgbHex[]
  extendedAnsi: readonly RgbHex[]
}): ITheme {
  const palette = input.colors
  return {
    background: input.background,
    foreground: input.foreground,
    cursor: input.cursor,
    cursorAccent: input.cursorText,
    selectionBackground: input.selectionBackground,
    selectionForeground: input.selectionForeground,
    black: palette[0], red: palette[1], green: palette[2], yellow: palette[3],
    blue: palette[4], magenta: palette[5], cyan: palette[6], white: palette[7],
    brightBlack: palette[8], brightRed: palette[9], brightGreen: palette[10],
    brightYellow: palette[11], brightBlue: palette[12], brightMagenta: palette[13],
    brightCyan: palette[14], brightWhite: palette[15],
    extendedAnsi: [...input.extendedAnsi],
  }
}

function hexToRgb(hex: RgbHex): TerminalThemeRgb {
  return [
    Number.parseInt(hex.slice(1, 3), 16),
    Number.parseInt(hex.slice(3, 5), 16),
    Number.parseInt(hex.slice(5, 7), 16),
  ]
}

function rgbToInt(rgb: TerminalThemeRgb): number {
  return (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]
}
