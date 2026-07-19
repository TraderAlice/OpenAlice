/**
 * Renderer → headless-terminal appearance contract.
 *
 * Adapted from stablyai/orca's terminal view-attribute bridge (MIT, Lovecast
 * Inc.). The server must answer hidden terminal color queries from the actual
 * renderer palette or stay silent; fabricating a headless default creates a
 * second, incorrect color authority.
 */

export type TerminalViewRgb = [number, number, number];

export const TERMINAL_VIEW_ANSI_COLOR_COUNT = 256;

export type TerminalViewCursorStyle = 'bar' | 'block' | 'underline';

export interface TerminalViewAttributes {
  readonly foreground: TerminalViewRgb;
  readonly background: TerminalViewRgb;
  readonly cursor: TerminalViewRgb;
  readonly ansi: TerminalViewRgb[];
  readonly colorSchemeMode: 'dark' | 'light';
  readonly cursorStyle: TerminalViewCursorStyle;
  readonly cursorBlink: boolean;
}

/** Contour/Kitty DEC mode 2031 notification for an already-subscribed TUI. */
export function terminalColorSchemeUpdateSequence(mode: 'dark' | 'light'): string {
  return mode === 'dark' ? '\x1b[?997;1n' : '\x1b[?997;2n';
}

const X_RGB_SPEC_RE =
  /^([\da-f])\/([\da-f])\/([\da-f])$|^([\da-f]{2})\/([\da-f]{2})\/([\da-f]{2})$|^([\da-f]{3})\/([\da-f]{3})\/([\da-f]{3})$|^([\da-f]{4})\/([\da-f]{4})\/([\da-f]{4})$/;
const X_HASH_SPEC_RE = /^[\da-f]+$/;

/** Mirror xterm's XParseColor grammar for OSC 4/10/11/12 SET payloads. */
export function parseXColorSpec(spec: string): TerminalViewRgb | null {
  if (!spec) return null;
  let low = spec.toLowerCase();
  if (low.startsWith('rgb:')) {
    low = low.slice(4);
    const match = X_RGB_SPEC_RE.exec(low);
    if (!match) return null;
    const base = match[1] ? 15 : match[4] ? 255 : match[7] ? 4095 : 65535;
    return [
      Math.round((Number.parseInt(match[1] || match[4] || match[7] || match[10]!, 16) / base) * 255),
      Math.round((Number.parseInt(match[2] || match[5] || match[8] || match[11]!, 16) / base) * 255),
      Math.round((Number.parseInt(match[3] || match[6] || match[9] || match[12]!, 16) / base) * 255),
    ];
  }
  if (!low.startsWith('#')) return null;
  low = low.slice(1);
  if (!X_HASH_SPEC_RE.test(low) || ![3, 6, 9, 12].includes(low.length)) return null;
  const advance = low.length / 3;
  const result: TerminalViewRgb = [0, 0, 0];
  for (let i = 0; i < 3; i += 1) {
    const channel = Number.parseInt(low.slice(advance * i, advance * i + advance), 16);
    result[i] = advance === 1 ? channel << 4 : advance === 2 ? channel : advance === 3 ? channel >> 4 : channel >> 8;
  }
  return result;
}

function padChannelTo16Bit(value: number): string {
  return value.toString(16).padStart(2, '0').repeat(2);
}

/** Exact 16-bit channel format used by visible xterm OSC color replies. */
export function formatXColorRgbSpec(rgb: TerminalViewRgb): string {
  return `rgb:${padChannelTo16Bit(rgb[0])}/${padChannelTo16Bit(rgb[1])}/${padChannelTo16Bit(rgb[2])}`;
}

function rgbEqual(a: TerminalViewRgb, b: TerminalViewRgb): boolean {
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
}

export function terminalViewAttributesEqual(a: TerminalViewAttributes, b: TerminalViewAttributes): boolean {
  if (a === b) return true;
  if (
    !rgbEqual(a.foreground, b.foreground)
    || !rgbEqual(a.background, b.background)
    || !rgbEqual(a.cursor, b.cursor)
    || a.colorSchemeMode !== b.colorSchemeMode
    || a.cursorStyle !== b.cursorStyle
    || a.cursorBlink !== b.cursorBlink
    || a.ansi.length !== b.ansi.length
  ) return false;
  return a.ansi.every((color, index) => rgbEqual(color, b.ansi[index]!));
}

function isRgbChannel(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 255;
}

function validateRgbTriple(value: unknown): TerminalViewRgb | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  const [r, g, b] = value;
  return isRgbChannel(r) && isRgbChannel(g) && isRgbChannel(b) ? [r, g, b] : null;
}

/** Reject malformed palettes at the HTTP boundary; wrong replies are worse than silence. */
export function validateTerminalViewAttributes(payload: unknown): TerminalViewAttributes | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const candidate = payload as Record<string, unknown>;
  const foreground = validateRgbTriple(candidate['foreground']);
  const background = validateRgbTriple(candidate['background']);
  const cursor = validateRgbTriple(candidate['cursor']);
  if (!foreground || !background || !cursor) return null;
  if (!Array.isArray(candidate['ansi']) || candidate['ansi'].length !== TERMINAL_VIEW_ANSI_COLOR_COUNT) return null;
  const ansi: TerminalViewRgb[] = [];
  for (const entry of candidate['ansi']) {
    const color = validateRgbTriple(entry);
    if (!color) return null;
    ansi.push(color);
  }
  const colorSchemeMode = candidate['colorSchemeMode'];
  const cursorStyle = candidate['cursorStyle'];
  if (colorSchemeMode !== 'dark' && colorSchemeMode !== 'light') return null;
  if (cursorStyle !== 'bar' && cursorStyle !== 'block' && cursorStyle !== 'underline') return null;
  if (typeof candidate['cursorBlink'] !== 'boolean') return null;
  return {
    foreground,
    background,
    cursor,
    ansi,
    colorSchemeMode,
    cursorStyle,
    cursorBlink: candidate['cursorBlink'],
  };
}
