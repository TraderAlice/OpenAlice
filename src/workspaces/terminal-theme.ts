export const TERMINAL_THEME_VARIANTS = ['light', 'dark'] as const;

export type TerminalThemeVariant = typeof TERMINAL_THEME_VARIANTS[number];

/**
 * Terminal capability declarations owned by the Workspace renderer.
 *
 * These values describe the xterm.js/PTY boundary rather than the terminal
 * application that happened to launch OpenAlice.  Keep them in the same
 * projection as the resolved colour variant so every built-in profile and
 * imported/generated profile reaches child processes through one path.
 */
export const TERMINAL_CAPABILITY_ENV = {
  TERM: 'xterm-256color',
  COLORTERM: 'truecolor',
} as const;

export interface ResolvedTerminalThemeEnv {
  readonly TERM: 'xterm-256color';
  readonly COLORTERM: 'truecolor';
  readonly OPENALICE_TERMINAL_THEME: TerminalThemeVariant;
  readonly COLORFGBG: '0;15' | '15;0';
}

export function isTerminalThemeVariant(value: unknown): value is TerminalThemeVariant {
  return value === 'light' || value === 'dark';
}

export function parseTerminalThemeVariant(value: unknown): TerminalThemeVariant | undefined {
  return isTerminalThemeVariant(value) ? value : undefined;
}

export function terminalThemeEnv(theme: TerminalThemeVariant): ResolvedTerminalThemeEnv;
export function terminalThemeEnv(theme: undefined): Record<string, never>;
export function terminalThemeEnv(
  theme: TerminalThemeVariant | undefined,
): ResolvedTerminalThemeEnv | Record<string, never>;
export function terminalThemeEnv(
  theme: TerminalThemeVariant | undefined,
): ResolvedTerminalThemeEnv | Record<string, never> {
  if (!theme) return {};
  return {
    ...TERMINAL_CAPABILITY_ENV,
    OPENALICE_TERMINAL_THEME: theme,
    // COLORFGBG is fg;bg in ANSI color indexes. It is old, but several TUIs
    // still use it as a cheap light/dark terminal hint at process startup.
    COLORFGBG: theme === 'dark' ? '15;0' : '0;15',
  };
}
