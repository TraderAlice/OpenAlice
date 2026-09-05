import { access, constants } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { posix, win32 } from 'node:path'

const exec = promisify(execFile)
const probes = {
  git: { args: ['--version'], pattern: /^git version / },
  bash: { args: ['--noprofile', '--norc', '-c', 'printf "%s" "$BASH_VERSION"'], pattern: /^\d+\.\d+/ },
}

export function dependencyCandidates(id, { platform = process.platform, env = process.env, gitExecutable } = {}) {
  if (!Object.hasOwn(probes, id)) throw new Error(`Unknown dependency: ${id}`)
  const windows = platform === 'win32'
  const path = windows ? win32 : posix
  const variable = windows ? Object.keys(env).find(key => key.toLowerCase() === 'path') : 'PATH'
  const directories = (env[variable] ?? '').split(windows ? ';' : ':')
    .map(directory => directory.replace(/^"(.*)"$/, '$1'))
    // Never search cwd implicitly while deciding what to install or execute.
    .filter(directory => path.isAbsolute(directory))
  const candidates = directories.map(directory => path.join(directory, windows ? `${id}.exe` : id))
  if (windows) {
    const value = key => env[Object.keys(env).find(name => name.toLowerCase() === key.toLowerCase())]
    const roots = [value('ProgramFiles'), value('ProgramW6432'), value('ProgramFiles(x86)')]
      .filter(Boolean).map(root => path.join(root, 'Git'))
    if (value('LOCALAPPDATA')) roots.push(path.join(value('LOCALAPPDATA'), 'Programs', 'Git'))
    if (gitExecutable) {
      const directory = path.dirname(gitExecutable)
      if (['cmd', 'bin'].includes(path.basename(directory).toLowerCase())) roots.unshift(path.dirname(directory))
    }
    for (const root of roots) candidates.push(path.join(root, id === 'git' ? 'cmd' : 'bin', `${id}.exe`))
  }
  const seen = new Set()
  return candidates.filter(candidate => {
    const key = windows ? candidate.toLowerCase() : candidate
    // Windows' legacy bash.exe invokes WSL, not a Windows Git Bash runtime.
    if (windows && id === 'bash' && /[\\/]windows[\\/]system32[\\/]bash\.exe$/i.test(candidate)) return false
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export async function inspectSystemDependencies(options = {}, dependencies = {}) {
  const env = options.env ?? process.env
  const platform = options.platform ?? process.platform
  const exists = dependencies.exists ?? (async executable => {
    try { await access(executable, platform === 'win32' ? constants.F_OK : constants.X_OK); return true }
    catch { return false }
  })
  const probe = dependencies.probe ?? (async (executable, args) => {
    const result = await exec(executable, args, { env, timeout: 5000, maxBuffer: 64 * 1024, windowsHide: true })
    return result.stdout.trim()
  })
  const checks = []
  for (const id of options.required ?? ['git', 'bash']) {
    const candidates = dependencyCandidates(id, {
      ...options, env, platform, gitExecutable: checks.find(check => check.id === 'git')?.executable,
    })
    let found = null
    for (const executable of candidates) {
      if (!await exists(executable)) continue
      // Respect precedence: don't silently replace a broken user's PATH entry
      // with a different installation and then call their environment healthy.
      try {
        const version = await probe(executable, probes[id].args)
        found = { id, executable, status: probes[id].pattern.test(version) ? 'available' : 'invalid', version }
      } catch (error) {
        found = { id, executable, status: 'invalid', detail: error.message }
      }
      break
    }
    checks.push(found ?? { id, status: 'missing' })
  }
  return checks
}
