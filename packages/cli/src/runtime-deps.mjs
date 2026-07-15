import { spawn } from 'node:child_process'

export const RUNTIME_BUILD_TOOL_GROUPS = [
  { id: 'git', label: 'Git', commands: ['git'] },
  { id: 'python3', label: 'Python 3', commands: ['python3'] },
  { id: 'make', label: 'make', commands: ['make'] },
  { id: 'cxx', label: 'a C++ compiler', commands: ['c++', 'g++', 'clang++'] },
]

export async function inspectRuntimeBuildTools(dependencies = {}) {
  const platform = dependencies.platform ?? process.platform
  if (!['linux', 'darwin'].includes(platform)) {
    return { platform, supported: false, missing: [] }
  }

  const commandAvailable = dependencies.commandAvailable ?? executableAvailable
  const missing = []
  for (const group of RUNTIME_BUILD_TOOL_GROUPS) {
    let found = false
    for (const command of group.commands) {
      if (await commandAvailable(command, dependencies)) {
        found = true
        break
      }
    }
    if (!found) missing.push(group.id)
  }
  return { platform, supported: true, missing }
}

export function formatMissingRuntimeBuildTools(missing) {
  const labels = new Map(RUNTIME_BUILD_TOOL_GROUPS.map((group) => [group.id, group.label]))
  return missing.map((id) => labels.get(id) ?? id).join(', ')
}

export function runtimeBuildToolsError(report) {
  const missing = formatMissingRuntimeBuildTools(report.missing)
  if (report.platform === 'linux') {
    return `Source Runtime build tools are missing: ${missing}. Re-run the OpenAlice installer with --with-runtime-deps, or install them with your system package manager before retrying.`
  }
  if (report.platform === 'darwin') {
    return `Source Runtime build tools are missing: ${missing}. Run "xcode-select --install" in a local macOS session, then retry.`
  }
  return `Source Runtime build tools are missing: ${missing}. Install them before retrying.`
}

function executableAvailable(command, dependencies = {}) {
  const spawnProcess = dependencies.spawnProcess ?? spawn
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawnProcess(command, ['--version'], {
      env: dependencies.env ?? process.env,
      stdio: 'ignore',
      windowsHide: true,
    })
    let settled = false
    child.once('error', (error) => {
      if (settled) return
      settled = true
      if (error?.code === 'ENOENT') resolvePromise(false)
      else rejectPromise(error)
    })
    child.once('exit', () => {
      if (settled) return
      settled = true
      resolvePromise(true)
    })
  })
}
