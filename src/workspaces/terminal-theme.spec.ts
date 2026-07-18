import { describe, expect, it } from 'vitest';

import {
  isTerminalThemeVariant,
  parseTerminalThemeVariant,
  TERMINAL_CAPABILITY_ENV,
  terminalThemeEnv,
} from './terminal-theme.js';

describe('terminal theme env hints', () => {
  it('accepts only concrete light/dark variants', () => {
    expect(isTerminalThemeVariant('light')).toBe(true);
    expect(isTerminalThemeVariant('dark')).toBe(true);
    expect(parseTerminalThemeVariant('follow')).toBeUndefined();
    expect(parseTerminalThemeVariant(null)).toBeUndefined();
  });

  it('maps variants to TUI-friendly environment hints', () => {
    expect(terminalThemeEnv('dark')).toEqual({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      OPENALICE_TERMINAL_THEME: 'dark',
      COLORFGBG: '15;0',
    });
    expect(terminalThemeEnv('light')).toEqual({
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      OPENALICE_TERMINAL_THEME: 'light',
      COLORFGBG: '0;15',
    });
    expect(terminalThemeEnv(undefined)).toEqual({});
  });

  it('uses the same capability projection for every resolved variant', () => {
    for (const variant of ['light', 'dark'] as const) {
      expect(terminalThemeEnv(variant)).toMatchObject(TERMINAL_CAPABILITY_ENV);
    }
  });
});
