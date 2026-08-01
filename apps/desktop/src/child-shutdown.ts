import type { ChildProcess } from 'node:child_process'

export type StoppableChild = Pick<ChildProcess, 'exitCode' | 'signalCode' | 'once' | 'off'>

export interface StopChildOptions {
  graceMs: number
  sendSignal: (signal: NodeJS.Signals) => void
  onForce?: () => void
}

export function childIsRunning(child: Pick<ChildProcess, 'exitCode' | 'signalCode'>): boolean {
  return child.exitCode === null && child.signalCode === null
}

function waitForExitWithin(exited: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs)
    void exited.then(() => {
      clearTimeout(timer)
      resolve(true)
    })
  })
}

/**
 * Stop one managed child gracefully, then force it if it is still running.
 *
 * `ChildProcess.killed` is deliberately not consulted: Node sets it as soon as
 * a signal is sent, even when the process ignores that signal and stays alive.
 */
export async function stopChild(child: StoppableChild, options: StopChildOptions): Promise<void> {
  if (!childIsRunning(child)) return

  const onExit = (): void => resolveExit()
  let resolveExit!: () => void
  const exited = new Promise<void>((resolve) => {
    resolveExit = resolve
    child.once('exit', onExit)
  })

  // Close the small race where the process exits between the first state
  // check and listener registration.
  if (!childIsRunning(child)) {
    child.off('exit', onExit)
    return
  }

  options.sendSignal('SIGTERM')
  const exitedGracefully = await waitForExitWithin(exited, options.graceMs)
  if (exitedGracefully || !childIsRunning(child)) return

  options.onForce?.()
  options.sendSignal('SIGKILL')
  await exited
}
