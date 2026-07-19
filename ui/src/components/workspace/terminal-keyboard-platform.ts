export type TerminalKeyboardPlatform = 'darwin' | 'linux' | 'win32' | 'other'

/** Detect the renderer platform without depending on Electron preload APIs. */
export function detectTerminalKeyboardPlatform(
  userAgent = navigator.userAgent
): TerminalKeyboardPlatform {
  if (/Mac|iPhone|iPad/.test(userAgent)) return 'darwin'
  if (/Windows/.test(userAgent)) return 'win32'
  if (/Linux/.test(userAgent) && !/Android|CrOS/.test(userAgent)) return 'linux'
  return 'other'
}
