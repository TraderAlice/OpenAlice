/**
 * The app-global terminal appearance and renderer → headless view bridge.
 *
 * The query-relevant composition follows stablyai/orca's implementation
 * (MIT, Lovecast Inc.). OpenAlice's source theme is its semantic CSS card, so
 * the product and terminal share one color vocabulary instead of two stores.
 */
import { useMemo } from 'react'

import type { ITheme } from '@xterm/xterm'

import { useEffectiveTheme } from '../../theme/useEffectiveTheme'
import type { TerminalViewAttributes, TerminalViewRgb } from './protocol'

export type TerminalColorSchemeMode = 'dark' | 'light'

export interface TerminalAppearance {
  readonly mode: TerminalColorSchemeMode
  readonly theme: ITheme
  readonly viewAttributes: TerminalViewAttributes
}

type ParsedCssColor = { rgb: TerminalViewRgb; alpha: number }

const DEFAULT_FOREGROUND: ParsedCssColor = { rgb: [0xff, 0xff, 0xff], alpha: 0xff }
const DEFAULT_BACKGROUND: ParsedCssColor = { rgb: [0x00, 0x00, 0x00], alpha: 0xff }
const DEFAULT_CURSOR: ParsedCssColor = { rgb: [0xff, 0xff, 0xff], alpha: 0xff }
// xterm's protocol defaults, expressed as channels so product color literals
// remain exclusively in palette.css.
const DEFAULT_ANSI_16: readonly TerminalViewRgb[] = [
  [46, 52, 54], [204, 0, 0], [78, 154, 6], [196, 160, 0],
  [52, 101, 164], [117, 80, 123], [6, 152, 154], [211, 215, 207],
  [85, 87, 83], [239, 41, 41], [138, 226, 52], [252, 233, 79],
  [114, 159, 207], [173, 127, 168], [52, 226, 226], [238, 238, 236],
]
const THEME_ANSI_KEYS = [
  'black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white',
  'brightBlack', 'brightRed', 'brightGreen', 'brightYellow',
  'brightBlue', 'brightMagenta', 'brightCyan', 'brightWhite',
] as const satisfies readonly (keyof ITheme)[]

const TOKEN_BY_THEME_KEY = {
  background: 'terminal-background',
  foreground: 'terminal-foreground',
  cursor: 'terminal-cursor',
  cursorAccent: 'terminal-cursor-accent',
  selectionBackground: 'terminal-selection-background',
  selectionForeground: 'terminal-selection-foreground',
  black: 'terminal-black',
  red: 'terminal-red',
  green: 'terminal-green',
  yellow: 'terminal-yellow',
  blue: 'terminal-blue',
  magenta: 'terminal-magenta',
  cyan: 'terminal-cyan',
  white: 'terminal-white',
  brightBlack: 'terminal-bright-black',
  brightRed: 'terminal-bright-red',
  brightGreen: 'terminal-bright-green',
  brightYellow: 'terminal-bright-yellow',
  brightBlue: 'terminal-bright-blue',
  brightMagenta: 'terminal-bright-magenta',
  brightCyan: 'terminal-bright-cyan',
  brightWhite: 'terminal-bright-white',
} as const satisfies Partial<Record<keyof ITheme, string>>

function buildDefaultAnsiPalette(): TerminalViewRgb[] {
  const palette = DEFAULT_ANSI_16.map((rgb) => [...rgb] as TerminalViewRgb)
  const values = [0x00, 0x5f, 0x87, 0xaf, 0xd7, 0xff]
  for (let i = 0; i < 216; i += 1) {
    palette.push([values[((i / 36) % 6) | 0]!, values[((i / 6) % 6) | 0]!, values[i % 6]!])
  }
  for (let i = 0; i < 24; i += 1) {
    const channel = 8 + i * 10
    palette.push([channel, channel, channel])
  }
  return palette
}

const DEFAULT_ANSI_PALETTE = buildDefaultAnsiPalette()

export function parseCssColor(css: string): ParsedCssColor | null {
  if (/^#[\da-f]{3,8}$/i.test(css)) {
    const expand = (start: number): number => Number.parseInt(css.slice(start, start + 1).repeat(2), 16)
    if (css.length === 4 || css.length === 5) {
      return {
        rgb: [expand(1), expand(2), expand(3)],
        alpha: css.length === 5 ? expand(4) : 0xff,
      }
    }
    if (css.length === 7 || css.length === 9) {
      return {
        rgb: [
          Number.parseInt(css.slice(1, 3), 16),
          Number.parseInt(css.slice(3, 5), 16),
          Number.parseInt(css.slice(5, 7), 16),
        ],
        alpha: css.length === 9 ? Number.parseInt(css.slice(7, 9), 16) : 0xff,
      }
    }
  }
  const rgba = css.match(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(,\s*(0|1|\d?\.(\d+))\s*)?\)/)
  if (!rgba) return null
  return {
    rgb: [Number.parseInt(rgba[1]!, 10), Number.parseInt(rgba[2]!, 10), Number.parseInt(rgba[3]!, 10)],
    alpha: Math.round((rgba[5] === undefined ? 1 : Number.parseFloat(rgba[5])) * 0xff),
  }
}

function parseThemeColor(css: string | undefined, fallback: ParsedCssColor): ParsedCssColor {
  return css === undefined ? fallback : (parseCssColor(css) ?? fallback)
}

function blendOverBackground(background: TerminalViewRgb, color: ParsedCssColor): TerminalViewRgb {
  if (color.alpha === 0xff) return color.rgb
  const alpha = color.alpha / 0xff
  return [
    background[0] + Math.round((color.rgb[0] - background[0]) * alpha),
    background[1] + Math.round((color.rgb[1] - background[1]) * alpha),
    background[2] + Math.round((color.rgb[2] - background[2]) * alpha),
  ]
}

export function composeTerminalViewAttributes(
  theme: ITheme,
  mode: TerminalColorSchemeMode,
): TerminalViewAttributes {
  const foreground = parseThemeColor(theme.foreground, DEFAULT_FOREGROUND)
  const background = parseThemeColor(theme.background, DEFAULT_BACKGROUND)
  const cursor = parseThemeColor(theme.cursor, DEFAULT_CURSOR)
  const ansi = THEME_ANSI_KEYS.map((key, index) => {
    const value = theme[key]
    return parseThemeColor(typeof value === 'string' ? value : undefined, {
      rgb: DEFAULT_ANSI_PALETTE[index]!, alpha: 0xff,
    }).rgb
  })
  for (let i = 16; i < DEFAULT_ANSI_PALETTE.length; i += 1) {
    ansi.push(parseThemeColor(theme.extendedAnsi?.[i - 16], {
      rgb: DEFAULT_ANSI_PALETTE[i]!, alpha: 0xff,
    }).rgb)
  }
  return {
    foreground: foreground.rgb,
    background: background.rgb,
    cursor: blendOverBackground(background.rgb, cursor),
    ansi,
    colorSchemeMode: mode,
    cursorStyle: 'block',
    cursorBlink: true,
  }
}

function readToken(style: CSSStyleDeclaration, token: string): string {
  const value = style.getPropertyValue(`--${token}`).trim()
  if (!value) throw new Error(`Missing terminal color token: --${token}`)
  return value
}

export function resolveTerminalAppearance(
  mode: TerminalColorSchemeMode,
  style: CSSStyleDeclaration = getComputedStyle(document.documentElement),
): TerminalAppearance {
  const theme: ITheme = {}
  for (const [key, token] of Object.entries(TOKEN_BY_THEME_KEY)) {
    theme[key as keyof ITheme] = readToken(style, token) as never
  }
  return { mode, theme, viewAttributes: composeTerminalViewAttributes(theme, mode) }
}

export function useTerminalAppearance(): TerminalAppearance {
  const mode = useEffectiveTheme()
  return useMemo(() => resolveTerminalAppearance(mode), [mode])
}

export function terminalThemesEqual(a: ITheme | undefined, b: ITheme): boolean {
  if (!a) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (key !== 'extendedAnsi' && a[key as keyof ITheme] !== b[key as keyof ITheme]) return false
  }
  const extA = a.extendedAnsi
  const extB = b.extendedAnsi
  if (!extA || !extB) return extA === extB
  return extA.length === extB.length && extA.every((value, index) => value === extB[index])
}

export function colorSchemeUpdateSequence(mode: TerminalColorSchemeMode): string {
  return mode === 'dark' ? '\x1b[?997;1n' : '\x1b[?997;2n'
}

let lastScheduledSnapshot: string | null = null
let lastScheduledTask: Promise<void> | null = null
let publicationQueue: Promise<void> = Promise.resolve()

/** Publish renderer truth before a PTY needs hidden/startup color replies. */
export function publishTerminalViewAttributes(attributes: TerminalViewAttributes): Promise<boolean> {
  const serialized = JSON.stringify(attributes)
  if (serialized === lastScheduledSnapshot && lastScheduledTask) {
    // A spawn racing app-start publication must wait for that exact push;
    // deduplication may skip a second request, but it cannot skip readiness.
    return lastScheduledTask.then(() => false)
  }
  lastScheduledSnapshot = serialized
  const task = publicationQueue.then(async () => {
    const response = await fetch('/api/workspaces/terminal-view-attributes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: serialized,
    })
    if (!response.ok) throw new Error(`Failed to publish terminal appearance: HTTP ${response.status}`)
  })
  lastScheduledTask = task
  publicationQueue = task.catch(() => {
    if (lastScheduledSnapshot === serialized) {
      lastScheduledSnapshot = null
      lastScheduledTask = null
    }
  })
  return task.then(() => true)
}
