// @xterm/headless checks for `window` while selecting its runtime path. The
// Electron main process can run with ELECTRON_RUN_AS_NODE, where it is absent.
// This must execute before the @xterm/headless module is evaluated.
if (typeof globalThis.window === 'undefined') {
  ;(globalThis as Record<string, unknown>)['window'] = globalThis
}
