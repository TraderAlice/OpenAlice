import { join } from 'node:path'

import { loadPtyBackend } from '../src/workspaces/pty-runtime.js'
import type { PtyProcess } from '../src/workspaces/pty-types.js'

const backend = loadPtyBackend()
if (backend.name !== 'bun-native') {
  throw new Error(`compiled PTY smoke selected ${backend.name}, expected bun-native`)
}

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
)
const one = spawnInteractive('ONE')
const two = spawnInteractive('TWO')
let flowControl: Awaited<ReturnType<typeof probeFlowControl>> | undefined

if (one.term.pid === two.term.pid) {
  throw new Error(`PTY sessions reused pid ${one.term.pid}`)
}

try {
  await Promise.all([
    waitForOutput(one, 'OA_ONE_READY'),
    waitForOutput(two, 'OA_TWO_READY'),
  ])

  one.term.resize(91, 31)
  two.term.resize(103, 37)
  one.term.write('alpha\n')
  two.term.write('beta\n')
  await Promise.all([
    waitForOutput(one, 'OA_ONE_INPUT:alpha'),
    waitForOutput(two, 'OA_TWO_INPUT:beta'),
  ])

  one.term.kill()
  await one.exited

  two.term.write('still-alive\n')
  await waitForOutput(two, 'OA_TWO_INPUT:still-alive')
  flowControl = await probeFlowControl()
} finally {
  try {
    one.term.kill()
  } catch {
    // already stopped
  }
  try {
    two.term.kill()
  } catch {
    // already stopped
  }
  await Promise.allSettled([one.exited, two.exited])
}

console.log(JSON.stringify({
  status: 'pass',
  backend: backend.name,
  supportsFlowControl: backend.supportsFlowControl,
  pids: [one.term.pid, two.term.pid],
  flowControl,
}))

async function probeFlowControl(): Promise<{
  pid: number
  bytesBeforePause: number
  bytesWhilePaused: number
  bytesAfterResume: number
  gracefulKillWhilePaused: true
}> {
  if (!backend.supportsFlowControl) {
    throw new Error('Bun PTY backend did not advertise output flow control')
  }

  const marker = 'OA_FLOW_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ\n'
  const session = {
    bytes: 0,
    term: backend.spawn('/bin/sh', [
      '-c',
      `while :; do printf '${marker.replace('\n', '\\n')}'; done & wait`,
    ], {
      name: 'xterm-256color',
      cols: 80,
      rows: 24,
      cwd: process.cwd(),
      env,
    }),
    exited: Promise.resolve(),
  }
  session.term.onData((data) => {
    session.bytes += Buffer.isBuffer(data) ? data.byteLength : Buffer.byteLength(data)
  })
  session.exited = new Promise<void>((resolve) => {
    session.term.onExit(() => resolve())
  })

  try {
    await waitForBytes(session, 512 * 1024)
    session.term.pause?.()

    // Let bytes already read from the PTY master settle, then prove the
    // producer group is stopped rather than copied into an unbounded JS queue.
    await Bun.sleep(200)
    const bytesBeforePause = session.bytes
    await Bun.sleep(300)
    const bytesWhilePaused = session.bytes
    if (bytesWhilePaused !== bytesBeforePause) {
      throw new Error(
        `PTY output kept growing while paused: ${bytesBeforePause} -> ${bytesWhilePaused}`,
      )
    }

    session.term.resume?.()
    await waitForBytes(session, bytesWhilePaused + (512 * 1024))
    const bytesAfterResume = session.bytes

    // A stopped process cannot run a SIGTERM handler until continued. The
    // backend must unstop the group as part of a normal Session shutdown.
    session.term.pause?.()
    await Bun.sleep(100)
    session.term.kill()
    await waitForPromise(session.exited, 'graceful PTY exit while paused')
    return {
      pid: session.term.pid,
      bytesBeforePause,
      bytesWhilePaused,
      bytesAfterResume,
      gracefulKillWhilePaused: true,
    }
  } finally {
    try {
      session.term.kill('SIGKILL')
    } catch {
      // already stopped
    }
    await session.exited
  }
}

function spawnInteractive(label: string): {
  term: PtyProcess
  output: string
  exited: Promise<void>
} {
  const { file, args } = interactiveCommand(label)
  const state = {
    output: '',
    term: null as unknown as PtyProcess,
    exited: Promise.resolve(),
  }
  state.term = backend.spawn(file, args, {
    name: 'xterm-256color',
    cols: 80,
    rows: 24,
    cwd: process.cwd(),
    env,
  })
  state.term.onData((data) => {
    state.output += Buffer.isBuffer(data) ? data.toString('utf8') : data
  })
  state.exited = new Promise<void>((resolve) => {
    state.term.onExit(() => resolve())
  })
  return state
}

function interactiveCommand(label: string): { file: string; args: string[] } {
  if (process.platform === 'win32') {
    const systemRoot = process.env['SystemRoot'] ?? 'C:\\Windows'
    return {
      file: join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
      args: [
        '-NoLogo',
        '-NoProfile',
        '-Command',
        `[Console]::WriteLine('OA_${label}_READY'); while ($null -ne ($line = [Console]::ReadLine())) { [Console]::WriteLine('OA_${label}_INPUT:' + $line) }`,
      ],
    }
  }
  return {
    file: '/bin/sh',
    args: [
      '-c',
      `printf 'OA_${label}_READY\\n'; while IFS= read -r line; do printf 'OA_${label}_INPUT:%s\\n' "$line"; done`,
    ],
  }
}

async function waitForOutput(
  session: { output: string },
  expected: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (session.output.includes(expected)) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for ${expected}; output=${JSON.stringify(session.output)}`)
}

async function waitForBytes(
  session: { bytes: number },
  minimum: number,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (session.bytes >= minimum) return
    await Bun.sleep(20)
  }
  throw new Error(`Timed out waiting for ${minimum} PTY bytes; received=${session.bytes}`)
}

async function waitForPromise(
  promise: Promise<void>,
  label: string,
  timeoutMs = 10_000,
): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
