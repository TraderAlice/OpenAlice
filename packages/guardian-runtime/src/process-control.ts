import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessController {
  isAlive(pid: number): boolean
  startedAt(pid: number): Promise<number | null>
  machineId(): Promise<string>
  signalTree(
    pid: number,
    signal: NodeJS.Signals,
    knownPids?: readonly number[],
  ): Promise<readonly number[] | void>
  sleep(ms: number): Promise<void>
}

export const defaultProcessController: ProcessController = {
  isAlive: (pid) => {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
      process.kill(pid, 0)
      return true
    } catch {
      return false
    }
  },
  startedAt: readProcessStartedAt,
  machineId: readMachineId,
  signalTree: signalProcessTree,
  sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

let machineIdPromise: Promise<string> | undefined

export function machineIdentity(): Promise<string> {
  machineIdPromise ??= readMachineId()
  return machineIdPromise
}

/**
 * Must come from the same clock `ProcessController.startedAt()` reads back.
 * `process.uptime()` counts from Node's main(), about 1s after exec, which
 * eats most of `PROCESS_START_TOLERANCE_MS`. The fallback is rounded to
 * seconds to match `ps lstart`.
 */
export function currentProcessStartedAt(): number {
  const fromProcfs = readProcfsProcessStartedAtSync(process.pid)
  if (fromProcfs !== null) return fromProcfs
  return Math.floor((Date.now() - process.uptime() * 1_000) / 1_000) * 1_000
}

/**
 * Keep process shutdown codes safe when a callback is also used as a Node
 * signal handler. Signal listeners receive the signal name as their first
 * argument, which must never flow into `process.exit()` as though it were a
 * numeric child-process exit code.
 */
export function normalizeProcessExitCode(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : 0
}

/**
 * Result of comparing a live pid against the start time recorded for it.
 *
 * `unverified` means the platform could not report a start time at all, so the
 * pid may or may not still be the recorded process. Callers decide how to treat
 * that ambiguity: liveness checks fail open, while lock inspection combines it
 * with heartbeat age.
 */
export type ProcessIdentityMatch = 'same' | 'different' | 'unverified'

/** `ps lstart` reports whole seconds and the fallback in
 * `currentProcessStartedAt()` rounds to whole seconds, so a small tolerance
 * keeps every source comparable. */
const PROCESS_START_TOLERANCE_MS = 2_000

export async function compareProcessIdentity(
  pid: number,
  expectedStartedAt: string | undefined,
  controller: ProcessController = defaultProcessController,
): Promise<ProcessIdentityMatch> {
  if (!expectedStartedAt) return 'unverified'
  const expected = Date.parse(expectedStartedAt)
  if (!Number.isFinite(expected)) return 'unverified'
  // A recorded owner pid that is our own pid never needs an external lookup:
  // we already know when this process started. A container restarted under the
  // same pid namespace hands the fresh process the same low pid as the owner it
  // is meant to replace, so this must resolve to `different`, not `unverified`.
  const actual = pid === process.pid ? currentProcessStartedAt() : await controller.startedAt(pid)
  if (actual === null) return 'unverified'
  return Math.abs(actual - expected) <= PROCESS_START_TOLERANCE_MS ? 'same' : 'different'
}

export async function isSameProcess(
  pid: number,
  expectedStartedAt: string | undefined,
  controller: ProcessController = defaultProcessController,
): Promise<boolean> {
  if (!controller.isAlive(pid)) return false
  return (await compareProcessIdentity(pid, expectedStartedAt, controller)) !== 'different'
}

export interface TerminateProcessTreeOptions {
  readonly gracefulMs?: number
  readonly forceMs?: number
  readonly controller?: ProcessController
}

export async function terminateProcessTree(
  pid: number,
  opts: TerminateProcessTreeOptions = {},
): Promise<void> {
  const controller = opts.controller ?? defaultProcessController
  if (!controller.isAlive(pid)) return

  const gracefulTargets = uniquePids([
    pid,
    ...((await controller.signalTree(pid, 'SIGTERM')) ?? []),
  ])
  if (await waitForProcessesExit(gracefulTargets, opts.gracefulMs ?? 5_000, controller)) return

  const forceTargets = uniquePids([
    ...gracefulTargets,
    ...((await controller.signalTree(pid, 'SIGKILL', gracefulTargets)) ?? []),
  ])
  if (await waitForProcessesExit(forceTargets, opts.forceMs ?? 5_000, controller)) return

  const survivors = forceTargets.filter((target) => controller.isAlive(target))
  throw new Error(`process tree ${pid} did not exit after SIGTERM and SIGKILL (survivors: ${survivors.join(', ')})`)
}

export async function waitForProcessExit(
  pid: number,
  timeoutMs: number,
  controller: ProcessController = defaultProcessController,
): Promise<boolean> {
  let waitedMs = 0
  while (controller.isAlive(pid) && waitedMs < timeoutMs) {
    const delayMs = Math.min(50, Math.max(1, timeoutMs - waitedMs))
    await controller.sleep(delayMs)
    waitedMs += delayMs
  }
  return !controller.isAlive(pid)
}

async function waitForProcessesExit(
  pids: readonly number[],
  timeoutMs: number,
  controller: ProcessController,
): Promise<boolean> {
  let waitedMs = 0
  while (pids.some((pid) => controller.isAlive(pid)) && waitedMs < timeoutMs) {
    const delayMs = Math.min(50, Math.max(1, timeoutMs - waitedMs))
    await controller.sleep(delayMs)
    waitedMs += delayMs
  }
  return pids.every((pid) => !controller.isAlive(pid))
}

/**
 * Linux exposes process start time in `/proc/<pid>/stat` field 22, counted in
 * clock ticks since boot. `/proc` always reports these in USER_HZ (100), which
 * is fixed in the kernel ABI regardless of the compiled-in scheduler HZ, so the
 * conversion does not need `sysconf(_SC_CLK_TCK)`.
 *
 * Field 2 (`comm`) is unquoted and may itself contain spaces and parentheses,
 * so the fields are parsed after the LAST `)` rather than by splitting the
 * whole line.
 */
export function parseProcStatStartTicks(content: string): number | null {
  const commEnd = content.lastIndexOf(')')
  if (commEnd < 0) return null
  const fields = content.slice(commEnd + 1).trim().split(/\s+/)
  // Fields resume at 3 (state) after `comm`, so field 22 is index 19.
  const ticks = Number(fields[19])
  return Number.isFinite(ticks) && ticks >= 0 ? ticks : null
}

/** Seconds since the epoch at which the machine booted, from `/proc/stat`. */
export function parseProcBootTimeSeconds(content: string): number | null {
  const value = /^btime\s+(\d+)$/m.exec(content)?.[1]
  if (value === undefined) return null
  const seconds = Number(value)
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

const USER_HZ = 100

function procfsStartedAt(statContent: string, bootContent: string): number | null {
  const ticks = parseProcStatStartTicks(statContent)
  const bootSeconds = parseProcBootTimeSeconds(bootContent)
  if (ticks === null || bootSeconds === null) return null
  return bootSeconds * 1_000 + (ticks / USER_HZ) * 1_000
}

async function readProcfsProcessStartedAt(pid: number): Promise<number | null> {
  try {
    const [statContent, bootContent] = await Promise.all([
      readFile(`/proc/${pid}/stat`, 'utf8'),
      readFile('/proc/stat', 'utf8'),
    ])
    return procfsStartedAt(statContent, bootContent)
  } catch {
    return null
  }
}

function readProcfsProcessStartedAtSync(pid: number): number | null {
  if (process.platform !== 'linux') return null
  try {
    return procfsStartedAt(
      readFileSync(`/proc/${pid}/stat`, 'utf8'),
      readFileSync('/proc/stat', 'utf8'),
    )
  } catch {
    return null
  }
}

async function readProcessStartedAt(pid: number): Promise<number | null> {
  // Prefer procfs on Linux. Minimal container images (including the OpenAlice
  // server image) ship no `ps`, and a failed lookup there used to make every
  // recorded owner look unverifiable forever.
  if (process.platform === 'linux') {
    const fromProcfs = await readProcfsProcessStartedAt(pid)
    if (fromProcfs !== null) return fromProcfs
  }
  try {
    if (process.platform === 'win32') {
      const script = `(Get-Process -Id ${pid} -ErrorAction Stop).StartTime.ToUniversalTime().ToString('o')`
      const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
        windowsHide: true,
        timeout: 2_000,
      })
      const parsed = Date.parse(stdout.trim())
      return Number.isFinite(parsed) ? parsed : null
    }

    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', 'lstart='], { timeout: 2_000 })
    const parsed = Date.parse(stdout.trim())
    return Number.isFinite(parsed) ? parsed : null
  } catch {
    return null
  }
}

/**
 * `hostname:` ids are the fallback used when no stable machine id exists, e.g.
 * slim containers without /etc/machine-id. Hostnames change on container
 * recreate and are not unique, so such an id is not evidence of a machine.
 */
export function isWeakMachineId(id: string): boolean {
  return id.startsWith('hostname:')
}

async function readMachineId(): Promise<string> {
  const override = process.env['OPENALICE_MACHINE_ID']?.trim()
  if (override) return `env:${override}`
  try {
    if (process.platform === 'linux') {
      const value = (await readFile('/etc/machine-id', 'utf8')).trim()
      if (value) return `linux:${value}`
    }
    if (process.platform === 'darwin') {
      const { stdout } = await execFileAsync('ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], { timeout: 2_000 })
      const value = /"IOPlatformUUID"\s*=\s*"([^"]+)"/.exec(stdout)?.[1]
      if (value) return `darwin:${value}`
    }
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('reg.exe', [
        'query',
        'HKLM\\SOFTWARE\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid',
      ], { windowsHide: true, timeout: 2_000 })
      const value = /MachineGuid\s+REG_\w+\s+([^\r\n]+)/i.exec(stdout)?.[1]?.trim()
      if (value) return `win32:${value}`
    }
  } catch {
    // Fall through to hostname. New owner metadata still records that this is
    // a weaker fallback so diagnostics can explain an identity limitation.
  }
  return `hostname:${hostname()}`
}

async function signalProcessTree(
  pid: number,
  signal: NodeJS.Signals,
  knownPids?: readonly number[],
): Promise<readonly number[]> {
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T']
    if (signal === 'SIGKILL') args.push('/F')
    try {
      await execFileAsync('taskkill', args, { windowsHide: true, timeout: 5_000 })
    } catch {
      // The process may have exited between the liveness check and taskkill.
    }
    return [pid]
  }

  const targets = uniquePids(knownPids?.length
    ? knownPids
    : [...await listDescendantPids(pid), pid])
  // Signal descendants before their wrapper. Package managers and shell shims
  // can exit immediately, reparenting children before a later tree walk.
  for (const target of targets.filter((target) => target !== pid)) {
    try { process.kill(target, signal) } catch { /* already gone */ }
  }
  try { process.kill(pid, signal) } catch { /* already gone */ }
  return targets
}

function uniquePids(values: readonly number[]): number[] {
  return [...new Set(values.filter((value) => Number.isInteger(value) && value > 0))]
}

export async function listDescendantPids(rootPid: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('ps', ['-axo', 'pid=,ppid='], { timeout: 2_000 })
    const children = new Map<number, number[]>()
    for (const line of stdout.split('\n')) {
      const [pidRaw, ppidRaw] = line.trim().split(/\s+/)
      const pid = Number(pidRaw)
      const ppid = Number(ppidRaw)
      if (!Number.isInteger(pid) || !Number.isInteger(ppid)) continue
      const row = children.get(ppid) ?? []
      row.push(pid)
      children.set(ppid, row)
    }
    const out: number[] = []
    const visit = (pid: number): void => {
      for (const child of children.get(pid) ?? []) {
        visit(child)
        out.push(child)
      }
    }
    visit(rootPid)
    return out
  } catch {
    return []
  }
}
