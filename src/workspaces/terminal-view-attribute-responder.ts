/**
 * Hidden-terminal OSC 4/10/11/12 and DSR ?996n responder.
 * Adapted from stablyai/orca (MIT, Lovecast Inc.).
 */
import type { Terminal } from '@xterm/headless';

import {
  formatXColorRgbSpec,
  parseXColorSpec,
  TERMINAL_VIEW_ANSI_COLOR_COUNT,
  type TerminalViewAttributes,
  type TerminalViewRgb,
} from './terminal-view-attributes.js';

type ViewAttributeParser = Pick<Terminal['parser'], 'registerOscHandler' | 'registerCsiHandler'>;

export interface TerminalViewAttributeResponderDeps {
  readonly parser: ViewAttributeParser;
  readonly getBaseAttributes: () => TerminalViewAttributes | null;
  readonly emitReply: (reply: string) => void;
}

export interface TerminalViewAttributeResponder {
  clearColorOverrides(): void;
}

type SpecialColorSlot = 'foreground' | 'background' | 'cursor';
const SPECIAL_COLOR_SLOTS: SpecialColorSlot[] = ['foreground', 'background', 'cursor'];
const SPECIAL_COLOR_IDENTS: Record<SpecialColorSlot, string> = {
  foreground: '10',
  background: '11',
  cursor: '12',
};

function relativeLuminance([r, g, b]: TerminalViewRgb): number {
  const linear = (channel: number): number => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return linear(r) * 0.2126 + linear(g) * 0.7152 + linear(b) * 0.0722;
}

export function installTerminalViewAttributeResponder(
  deps: TerminalViewAttributeResponderDeps,
): TerminalViewAttributeResponder {
  const ansiOverrides = new Map<number, TerminalViewRgb>();
  const specialOverrides = new Map<SpecialColorSlot, TerminalViewRgb>();

  const reportColor = (ident: string, rgb: TerminalViewRgb): void => {
    deps.emitReply(`\x1b]${ident};${formatXColorRgbSpec(rgb)}\x1b\\`);
  };

  const handleSpecialColor = (data: string, offset: number): boolean => {
    const values = data.split(';');
    for (let i = 0; i < values.length && offset < SPECIAL_COLOR_SLOTS.length; i += 1, offset += 1) {
      const slot = SPECIAL_COLOR_SLOTS[offset]!;
      const value = values[i]!;
      if (value === '?') {
        const base = deps.getBaseAttributes();
        if (base) reportColor(SPECIAL_COLOR_IDENTS[slot], specialOverrides.get(slot) ?? base[slot]);
      } else {
        const rgb = parseXColorSpec(value);
        if (rgb) specialOverrides.set(slot, rgb);
      }
    }
    return true;
  };

  deps.parser.registerOscHandler(4, (data) => {
    const values = data.split(';');
    while (values.length > 1) {
      const rawIndex = values.shift()!;
      const spec = values.shift()!;
      if (!/^\d+$/.test(rawIndex)) continue;
      const index = Number.parseInt(rawIndex, 10);
      if (index < 0 || index >= TERMINAL_VIEW_ANSI_COLOR_COUNT) continue;
      if (spec === '?') {
        const base = deps.getBaseAttributes();
        if (base) reportColor(`4;${index}`, ansiOverrides.get(index) ?? base.ansi[index]!);
      } else {
        const rgb = parseXColorSpec(spec);
        if (rgb) ansiOverrides.set(index, rgb);
      }
    }
    return true;
  });
  deps.parser.registerOscHandler(10, (data) => handleSpecialColor(data, 0));
  deps.parser.registerOscHandler(11, (data) => handleSpecialColor(data, 1));
  deps.parser.registerOscHandler(12, (data) => handleSpecialColor(data, 2));
  deps.parser.registerOscHandler(104, (data) => {
    if (!data) ansiOverrides.clear();
    else for (const value of data.split(';')) if (/^\d+$/.test(value)) ansiOverrides.delete(Number.parseInt(value, 10));
    return true;
  });
  deps.parser.registerOscHandler(110, () => { specialOverrides.delete('foreground'); return true; });
  deps.parser.registerOscHandler(111, () => { specialOverrides.delete('background'); return true; });
  deps.parser.registerOscHandler(112, () => { specialOverrides.delete('cursor'); return true; });

  deps.parser.registerCsiHandler({ prefix: '?', final: 'n' }, (params) => {
    if (params[0] !== 996) return false;
    const base = deps.getBaseAttributes();
    if (base) {
      const background = specialOverrides.get('background') ?? base.background;
      const foreground = specialOverrides.get('foreground') ?? base.foreground;
      const dark = relativeLuminance(background) < relativeLuminance(foreground);
      deps.emitReply(`\x1b[?997;${dark ? 1 : 2}n`);
    }
    return true;
  });

  return {
    clearColorOverrides: () => {
      ansiOverrides.clear();
      specialOverrides.clear();
    },
  };
}
