import { spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

const requireDesktop = createRequire(new URL('../apps/desktop/package.json', import.meta.url))

export function desktopDevExecutable() {
  return requireDesktop('electron')
}

export function spawnDesktopSmoke(executable, args, options) {
  // A private process group lets the smoke clean up Electron's helper and
  // Alice child processes even when Electron exits before its wrapper does.
  const env = { ...options.env }
  delete env.ELECTRON_RUN_AS_NODE
  return spawn(executable, args, {
    ...options,
    env,
    detached: process.platform !== 'win32',
  })
}

function groupAlive(pid) {
  if (process.platform === 'win32' || !pid) return false
  try {
    process.kill(-pid, 0)
    return true
  } catch {
    return false
  }
}

function signalGroup(pid, signal) {
  if (!pid || process.platform === 'win32') return
  try { process.kill(-pid, signal) } catch { /* already stopped */ }
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (predicate() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return !predicate()
}

export async function stopDesktopSmoke(child, graceMs = 5_000) {
  const pid = child?.pid
  if (!pid) return

  if (process.platform === 'win32') {
    if (child.exitCode === null && child.signalCode === null) {
      spawnSync('taskkill.exe', ['/pid', String(pid), '/T', '/F'], {
        stdio: 'ignore', windowsHide: true,
      })
    }
    await waitUntil(() => child.exitCode === null && child.signalCode === null, graceMs)
    return
  }

  // Let the main process run its own Guardian shutdown first. Its helpers are
  // in the smoke-owned group, so an unexpected main-process exit still leaves
  // us a bounded way to reap them before deleting temporary data or packages.
  if (child.exitCode === null && child.signalCode === null) {
    try { child.kill('SIGTERM') } catch { /* already stopped */ }
    await waitUntil(() => child.exitCode === null && child.signalCode === null, graceMs)
  }
  if (!groupAlive(pid)) return
  signalGroup(pid, 'SIGTERM')
  if (await waitUntil(() => groupAlive(pid), 1_000)) return
  signalGroup(pid, 'SIGKILL')
  if (!await waitUntil(() => groupAlive(pid), 1_000)) {
    throw new Error(`desktop smoke process group ${pid} did not exit`)
  }
}
