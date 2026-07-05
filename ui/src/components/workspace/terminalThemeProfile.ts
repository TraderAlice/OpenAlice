import type { ITheme } from '@xterm/xterm'

export type TerminalThemeVariant = 'light' | 'dark'
export type TerminalThemeRgb = readonly [number, number, number]

export interface TerminalThemeProfile {
  readonly variant: TerminalThemeVariant
  readonly name: string
  readonly foreground: TerminalThemeRgb
  readonly background: TerminalThemeRgb
  readonly palette: readonly TerminalThemeRgb[]
  readonly cursorColor: TerminalThemeRgb
  readonly cursorText: TerminalThemeRgb
  readonly selectionBackground: TerminalThemeRgb
  readonly selectionBackgroundAlpha?: number
  readonly selectionForeground: TerminalThemeRgb
  /**
   * xterm uses this not just for paint. Its built-in OSC 4/10/11/12 handlers can
   * report colors from the active theme service back to the PTY, which is the web
   * equivalent of Muxy applying a client theme config to a terminal surface.
   */
  readonly xtermTheme: ITheme
}

type TerminalThemeProfileInput = Omit<TerminalThemeProfile, 'xtermTheme'>

const lightProfile = defineTerminalThemeProfile({
  variant: 'light',
  name: 'OpenAlice Light',
  foreground: [28, 42, 65],
  background: [250, 248, 241],
  palette: [
    [28, 42, 65],
    [207, 34, 46],
    [17, 99, 41],
    [122, 77, 5],
    [9, 105, 218],
    [130, 80, 223],
    [27, 124, 131],
    [110, 119, 129],
    [87, 96, 106],
    [164, 14, 38],
    [26, 127, 55],
    [99, 60, 1],
    [33, 139, 255],
    [164, 117, 249],
    [49, 146, 170],
    [36, 41, 47],
  ],
  cursorColor: [47, 98, 176],
  cursorText: [250, 248, 241],
  selectionBackground: [47, 98, 176],
  selectionBackgroundAlpha: 0.22,
  selectionForeground: [250, 248, 241],
})

const darkProfile = defineTerminalThemeProfile({
  variant: 'dark',
  name: 'OpenAlice Dark',
  foreground: [230, 237, 243],
  background: [11, 13, 16],
  palette: [
    [72, 79, 88],
    [255, 123, 114],
    [126, 231, 135],
    [210, 153, 34],
    [121, 192, 255],
    [210, 168, 255],
    [165, 214, 255],
    [230, 237, 243],
    [110, 118, 129],
    [255, 161, 152],
    [86, 211, 100],
    [227, 179, 65],
    [165, 214, 255],
    [210, 168, 255],
    [182, 227, 255],
    [240, 246, 252],
  ],
  cursorColor: [126, 231, 135],
  cursorText: [11, 13, 16],
  selectionBackground: [38, 79, 120],
  selectionForeground: [240, 246, 252],
})

export function xtermThemeForVariant(variant: TerminalThemeVariant): ITheme {
  return terminalThemeProfileForVariant(variant).xtermTheme
}

export function terminalThemeProfileForVariant(variant: TerminalThemeVariant): TerminalThemeProfile {
  return variant === 'light' ? lightProfile : darkProfile
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

function defineTerminalThemeProfile(input: TerminalThemeProfileInput): TerminalThemeProfile {
  return {
    ...input,
    xtermTheme: xtermThemeFromProfile(input),
  }
}

function xtermThemeFromProfile(profile: TerminalThemeProfileInput): ITheme {
  const palette = profile.palette
  return {
    background: rgbToHex(profile.background),
    foreground: rgbToHex(profile.foreground),
    cursor: rgbToHex(profile.cursorColor),
    cursorAccent: rgbToHex(profile.cursorText),
    selectionBackground: profile.selectionBackgroundAlpha === undefined
      ? rgbToHex(profile.selectionBackground)
      : rgbToRgba(profile.selectionBackground, profile.selectionBackgroundAlpha),
    selectionForeground: rgbToHex(profile.selectionForeground),
    black: rgbToHex(palette[0]!),
    red: rgbToHex(palette[1]!),
    green: rgbToHex(palette[2]!),
    yellow: rgbToHex(palette[3]!),
    blue: rgbToHex(palette[4]!),
    magenta: rgbToHex(palette[5]!),
    cyan: rgbToHex(palette[6]!),
    white: rgbToHex(palette[7]!),
    brightBlack: rgbToHex(palette[8]!),
    brightRed: rgbToHex(palette[9]!),
    brightGreen: rgbToHex(palette[10]!),
    brightYellow: rgbToHex(palette[11]!),
    brightBlue: rgbToHex(palette[12]!),
    brightMagenta: rgbToHex(palette[13]!),
    brightCyan: rgbToHex(palette[14]!),
    brightWhite: rgbToHex(palette[15]!),
  }
}

function rgbToInt(rgb: TerminalThemeRgb): number {
  return (rgb[0] << 16) + (rgb[1] << 8) + rgb[2]
}

function rgbToHex(rgb: TerminalThemeRgb): string {
  return `#${rgbToInt(rgb).toString(16).padStart(6, '0')}`
}

function rgbToRgba(rgb: TerminalThemeRgb, alpha: number): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`
}
