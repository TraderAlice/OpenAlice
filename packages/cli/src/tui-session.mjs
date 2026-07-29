import { AnsiTerminalRenderer } from './tui-renderer.mjs'

export function createTerminalSession(options) {
  const input = options.input ?? process.stdin
  const output = options.output ?? process.stdout
  const signalSource = options.signalSource ?? process
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') {
    const error = new Error('OpenAlice TUI requires an interactive terminal.')
    error.code = 'ENOTTY'
    error.exitCode = 2
    throw error
  }

  const renderer = options.renderer ?? new AnsiTerminalRenderer(output)
  const previousRawMode = input.isRaw === true
  const inputWasFlowing = input.readableFlowing === true
  let settled = false
  let resolveExit
  let rejectExit
  const exitPromise = new Promise((resolvePromise, rejectPromise) => {
    resolveExit = resolvePromise
    rejectExit = rejectPromise
  })

  const cleanup = () => {
    input.off('data', onData)
    output.off('resize', onResize)
    signalSource.off('SIGINT', onSigint)
    signalSource.off('SIGTERM', onSigterm)
    let cleanupError = null
    try {
      input.setRawMode(previousRawMode)
    } catch (error) {
      cleanupError = error
    }
    if (!inputWasFlowing) input.pause()
    try {
      renderer.close()
    } catch (error) {
      cleanupError ??= error
    }
    return cleanupError
  }

  const finish = (reason, error = null) => {
    if (settled) return
    settled = true
    const cleanupError = cleanup()
    if (error || cleanupError) rejectExit(error ?? cleanupError)
    else resolveExit({ reason })
  }

  const redraw = () => {
    if (settled) return
    try {
      renderer.render(options.render({
        columns: output.columns ?? 80,
        rows: output.rows ?? 24,
        color: options.color ?? shouldUseColor(output),
      }))
    } catch (error) {
      finish('renderer-error', error)
    }
  }

  const onData = (data) => {
    if (settled) return
    try {
      options.onInput?.(data, { redraw, finish: (reason = 'detach') => finish(reason) })
    } catch (error) {
      finish('input-error', error)
    }
  }
  const onResize = () => {
    renderer.invalidate()
    redraw()
  }
  const onSigint = () => finish('SIGINT')
  const onSigterm = () => finish('SIGTERM')

  try {
    renderer.enter()
    input.setRawMode(true)
    input.resume()
    input.on('data', onData)
    output.on('resize', onResize)
    signalSource.on('SIGINT', onSigint)
    signalSource.on('SIGTERM', onSigterm)
    redraw()
  } catch (error) {
    finish('startup-error', error)
  }

  return {
    redraw,
    finish: (reason = 'detach') => finish(reason),
    waitForExit: () => exitPromise,
  }
}

export function shouldUseColor(output = process.stdout, environment = process.env) {
  return output.isTTY === true
    && !Object.hasOwn(environment, 'NO_COLOR')
    && environment.TERM !== 'dumb'
}
