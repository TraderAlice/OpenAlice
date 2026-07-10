import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface ProcessController {
  isAlive(pid: number): boolean
  startedAt(pid: number): Promise<number | null>
  machineId(): Promise<string>
  signalTree(pid: number, signal: NodeJS.Signals): Promise<void>
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

/** Rounded to seconds so it can be compared with `ps lstart` on POSIX. */
export function currentProcessStartedAt(): number {
  return Math.floor((Date.now() - process.uptime() * 1_000) / 1_000) * 1_000
}

export async function isSameProcess(
  pid: number,
  expectedStartedAt: string | undefined,
  controller: ProcessController = defaultProcessController,
): Promise<boolean> {
  if (!controller.isAlive(pid)) return false
  if (!expectedStartedAt) return true
  const expected = Date.parse(expectedStartedAt)
  if (!Number.isFinite(expected)) return true
  const actual = await controller.startedAt(pid)
  if (actual === null) return true
  return Math.abs(actual - expected) <= 2_000
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

  await controller.signalTree(pid, 'SIGTERM')
  if (await waitForProcessExit(pid, opts.gracefulMs ?? 5_000, controller)) return

  await controller.signalTree(pid, 'SIGKILL')
  if (await waitForProcessExit(pid, opts.forceMs ?? 5_000, controller)) return

  throw new Error(`process tree ${pid} did not exit after SIGTERM and SIGKILL`)
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

async function readProcessStartedAt(pid: number): Promise<number | null> {
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

async function signalProcessTree(pid: number, signal: NodeJS.Signals): Promise<void> {
  if (process.platform === 'win32') {
    const args = ['/pid', String(pid), '/T']
    if (signal === 'SIGKILL') args.push('/F')
    try {
      await execFileAsync('taskkill', args, { windowsHide: true, timeout: 5_000 })
    } catch {
      // The process may have exited between the liveness check and taskkill.
    }
    return
  }

  if (signal === 'SIGKILL') {
    for (const childPid of await descendantPids(pid)) {
      try { process.kill(childPid, signal) } catch { /* already gone */ }
    }
  }
  try { process.kill(pid, signal) } catch { /* already gone */ }
}

async function descendantPids(rootPid: number): Promise<number[]> {
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
