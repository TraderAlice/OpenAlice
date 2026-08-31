export interface DesktopExitOptions {
  readonly appExit: (exitCode: number) => void
  readonly processExit: (exitCode: number) => never
  readonly fallbackMs?: number
  readonly schedule?: (callback: () => void, delayMs: number) => Pick<ReturnType<typeof setTimeout>, 'unref'>
}

/**
 * Finish Electron shutdown after every managed child and runtime lock is gone.
 *
 * `app.exit()` is the preferred Electron path, but it has occasionally left
 * the outer process alive after the last BrowserWindow closes in packaged
 * upgrade smoke. A short, unref'ed process fallback makes the Guardian's final
 * lifecycle boundary deterministic without shortening child shutdown grace.
 */
export function exitDesktopProcess(exitCode: number, options: DesktopExitOptions): void {
  const schedule = options.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs))
  const fallback = schedule(
    () => options.processExit(exitCode),
    options.fallbackMs ?? 1_000,
  )
  fallback.unref()
  options.appExit(exitCode)
}
