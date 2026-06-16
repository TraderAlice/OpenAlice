import type { ITheme } from '@xterm/xterm';

/**
 * Light xterm palette (GitHub-light-ish, warmed to sit on Daybreak's cream).
 * ANSI `white` maps to a mid-grey and `brightWhite` to near-black, the way
 * every light terminal theme does, so CLI output that prints as bright-white
 * on a dark terminal becomes dark + legible here instead of vanishing.
 * Picked by the active theme in Terminal.tsx (`auto` resolves via the OS).
 */
export const lightTheme: ITheme = {
  background: '#faf8f1',
  foreground: '#1c2a41',
  cursor: '#2f62b0',
  cursorAccent: '#faf8f1',
  selectionBackground: 'rgba(47, 98, 176, 0.22)',
  black: '#1c2a41',
  red: '#cf222e',
  green: '#116329',
  yellow: '#7a4d05',
  blue: '#0969da',
  magenta: '#8250df',
  cyan: '#1b7c83',
  white: '#6e7781',
  brightBlack: '#57606a',
  brightRed: '#a40e26',
  brightGreen: '#1a7f37',
  brightYellow: '#633c01',
  brightBlue: '#218bff',
  brightMagenta: '#a475f9',
  brightCyan: '#3192aa',
  brightWhite: '#24292f',
};

export const darkTheme: ITheme = {
  background: '#0b0d10',
  foreground: '#e6edf3',
  cursor: '#7ee787',
  cursorAccent: '#0b0d10',
  selectionBackground: '#264f78',
  black: '#484f58',
  red: '#ff7b72',
  green: '#7ee787',
  yellow: '#d29922',
  blue: '#79c0ff',
  magenta: '#d2a8ff',
  cyan: '#a5d6ff',
  white: '#e6edf3',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#a5d6ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#b6e3ff',
  brightWhite: '#f0f6fc',
};
