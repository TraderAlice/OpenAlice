import { mixOklab } from './colors.js'
import {
  ansi16OverrideSchema,
  type Ansi16Override,
  type RgbHex,
  type ThemePalette,
} from './types.js'

export interface Ansi16Source {
  name: string
  author: string | null
  foreground: RgbHex
  background: RgbHex
  cursor: RgbHex
  cursorText?: RgbHex
  selectionBackground: RgbHex
  selectionForeground?: RgbHex
  colors: readonly [
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
    RgbHex, RgbHex, RgbHex, RgbHex,
  ]
}

export interface ProjectedAnsi16Theme {
  palette: ThemePalette
  ansi16Override: Ansi16Override
}

/**
 * The single, versioned ANSI16 -> Base16 projection owned by the theme core.
 * File-format adapters must only construct Ansi16Source and call this function.
 */
export function projectAnsi16Theme(source: Ansi16Source): ProjectedAnsi16Theme {
  const [
    color0, color1, color2, color3, color4, color5, color6, color7,
    color8, color9, , , , color13, , color15,
  ] = source.colors
  const palette: ThemePalette = {
    base00: source.background,
    base01: mixOklab(source.background, color8, 1 / 3),
    base02: mixOklab(source.background, color8, 2 / 3),
    base03: color8,
    base04: mixOklab(color8, source.foreground, 1 / 2),
    base05: source.foreground,
    base06: mixOklab(source.foreground, color15, 1 / 2),
    base07: color15,
    base08: color1,
    base09: color9,
    base0A: color3,
    base0B: color2,
    base0C: color6,
    base0D: color4,
    base0E: color5,
    base0F: color13,
  }
  return {
    palette,
    ansi16Override: ansi16OverrideSchema.parse({
      foreground: source.foreground,
      background: source.background,
      cursor: source.cursor,
      cursorText: source.cursorText ?? source.background,
      selectionBackground: source.selectionBackground,
      selectionForeground: source.selectionForeground ?? source.foreground,
      colors: source.colors,
    }),
  }
}
