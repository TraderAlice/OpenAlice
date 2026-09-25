import { expect, it, vi } from 'vitest'
import { runHeadlessProbe } from './probe.js'
import type { PtyBackend, PtyExitEvent } from './pty-types.js'
import type { Logger } from './logger.js'
import { SessionTerminationError } from './session-process-stop.js'
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger
it.each([false, true])('probe cancellation waits for tree exit or reports failed termination (%s)', async fails => {
  const controller = new AbortController()
  let exit!: (event: PtyExitEvent) => void
  const terminateTree = vi.fn(async () => { if (fails) throw new Error('survivor'); exit({ exitCode: 0 }) })
  const pty: PtyBackend = { name: 'node-pty', supportsFlowControl: true, spawn: () => ({
    pid: 1, onData: () => ({ dispose() {} }), onExit: callback => { exit = callback; return { dispose() {} } },
    write() {}, resize() {}, kill() {}, terminateTree,
  }) }
  const result = runHeadlessProbe({ command: [process.execPath], cwd: process.cwd(), env: {}, transcriptDir: null,
    transcriptFileRe: null, prompt: 'probe', timeoutMs: 10000, logger, pty, abortSignal: controller.signal,
    onSpawned: () => controller.abort('user-interrupted'),
  })
  if (fails) await expect(result).rejects.toBeInstanceOf(SessionTerminationError)
  else expect(await result).toMatchObject({ interruptionReason: 'user-interrupted', killed: false })
  expect(terminateTree).toHaveBeenCalledOnce()
})
