export const TERMINAL_THEME_VARIANTS = ['light', 'dark'] as const;

export type TerminalThemeVariant = typeof TERMINAL_THEME_VARIANTS[number];

export function isTerminalThemeVariant(value: unknown): value is TerminalThemeVariant {
  return value === 'light' || value === 'dark';
}

export function parseTerminalThemeVariant(value: unknown): TerminalThemeVariant | undefined {
  return isTerminalThemeVariant(value) ? value : undefined;
}

export function terminalThemeEnv(theme: TerminalThemeVariant | undefined): Record<string, string> {
  if (!theme) return {};
  return {
    OPENALICE_TERMINAL_THEME: theme,
    // COLORFGBG is fg;bg in ANSI color indexes. It is old, but several TUIs
    // still use it as a cheap light/dark terminal hint at process startup.
    COLORFGBG: theme === 'dark' ? '15;0' : '0;15',
  };
}
