import { access, constants } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { posix, win32 } from 'node:path'

export async function findSystemCommand(name, { platform = process.platform, env = process.env } = {}) {
  const windows = platform === 'win32'
  const path = windows ? win32 : posix
  const key = windows ? Object.keys(env).find(key => key.toLowerCase() === 'path') : 'PATH'
  for (const entry of (env[key] ?? '').split(windows ? ';' : ':')) {
    const directory = entry.replace(/^"(.*)"$/, '$1')
    if (!path.isAbsolute(directory)) continue
    const executable = path.join(directory, windows ? `${name}.exe` : name)
    try { await access(executable, windows ? constants.F_OK : constants.X_OK); return executable } catch {}
  }
  return null
}

export async function planDependencyInstallation(checks, options = {}, dependencies = {}) {
  const platform = options.platform ?? process.platform
  const find = dependencies.find ?? (name => findSystemCommand(name, options))
  const packages = [...new Set(checks.map(check => check.id))]
  if (packages.some(name => !['git', 'bash'].includes(name))) throw new Error('Unsupported dependency')
  if (!packages.length) return []
  if (platform === 'win32') {
    const command = await find('winget')
    return command ? [{ command, args: ['install', '--id', 'Git.Git', '--exact', '--source', 'winget', '--no-upgrade'], packages: ['Git.Git'] }] : []
  }
  const managers = platform === 'darwin' ? ['brew'] : platform === 'linux' ? ['apt-get', 'dnf', 'pacman', 'apk', 'brew'] : []
  for (const manager of managers) {
    const command = await find(manager)
    if (!command) continue
    const args = manager === 'pacman' ? ['-S', '--needed', ...packages]
      : manager === 'apk' ? ['add', ...packages] : ['install', ...packages]
    const needsRoot = manager !== 'brew' && (options.uid ?? process.getuid?.()) !== 0
    const sudo = needsRoot ? await find('sudo') : null
    if (needsRoot && !sudo) return []
    // Leave package-manager confirmation and license prompts intact. No full
    // system upgrade, bypass flags, downloaded shell scripts, or auto sudo.
    const action = args => ({ command: sudo ?? command, args: sudo ? [command, ...args] : args, packages, requiresElevation: needsRoot })
    // Fresh Debian hosts may have no package index. Refresh metadata, not
    // installed packages, before installing the explicitly missing tools.
    return [...(manager === 'apt-get' ? [action(['update'])] : []), action(args)]
  }
  return []
}

export function executeDependencyInstallation(action, { env = process.env, spawnImpl = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawnImpl(action.command, action.args, { env, shell: false, stdio: 'inherit' })
    child.once('error', reject)
    child.once('exit', (code, signal) => resolve({ code: code ?? 1, signal }))
  })
}
