import { existsSync, statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

export interface ManagedRuntimeEnvOptions {
  readonly appHome: string
  readonly launcherMode: 'electron-dev' | 'electron-packaged'
  readonly platform?: NodeJS.Platform
  readonly arch?: NodeJS.Architecture
  readonly execPath?: string
}

function existingFile(path: string): string | null {
  try {
    return existsSync(path) && statSync(path).isFile() ? path : null
  } catch {
    return null
  }
}

function existingDir(path: string): string | null {
  try {
    return existsSync(path) && statSync(path).isDirectory() ? path : null
  } catch {
    return null
  }
}

/**
 * Describe only the managed capabilities that are actually present in the
 * application resource tree. The backend consumes these paths as one runtime
 * profile and prepends the toolchain entries to every Workspace process.
 */
export function resolveManagedRuntimeEnv(opts: ManagedRuntimeEnvOptions): Record<string, string> {
  const platform = opts.platform ?? process.platform
  const arch = opts.arch ?? process.arch
  const platformArch = `${platform}-${arch}`
  const out: Record<string, string> = {
    OPENALICE_RUNTIME_PROFILE: opts.launcherMode,
  }

  const managedPiCli = existingFile(join(
    opts.appHome,
    'vendor',
    'pi',
    'node_modules',
    '@earendil-works',
    'pi-coding-agent',
    'dist',
    'cli.js',
  ))
  const managedPiBinary = existingFile(join(
    opts.appHome,
    'vendor',
    'pi',
    platformArch,
    platform === 'win32' ? 'pi.exe' : 'pi',
  ))
  if (managedPiCli) {
    out.OPENALICE_MANAGED_PI_PATH = managedPiCli
    out.OPENALICE_MANAGED_PI_NODE_PATH = opts.execPath ?? process.execPath
  } else if (managedPiBinary) {
    out.OPENALICE_MANAGED_PI_PATH = managedPiBinary
  }

  const toolchainPaths: string[] = []
  const searchToolsBin = existingDir(join(
    opts.appHome,
    'vendor',
    'tools',
    platformArch,
    'bin',
  ))
  const executableSuffix = platform === 'win32' ? '.exe' : ''
  if (
    searchToolsBin &&
    existingFile(join(searchToolsBin, `fd${executableSuffix}`)) &&
    existingFile(join(searchToolsBin, `rg${executableSuffix}`))
  ) {
    toolchainPaths.push(searchToolsBin)
  }

  if (platform === 'win32') {
    const gitDir = existingDir(join(opts.appHome, 'vendor', 'git', platformArch))
    if (gitDir) {
      out.OPENALICE_MANAGED_GIT_DIR = gitDir
      out.LOCAL_GIT_DIRECTORY = gitDir

      const gitBin =
        existingFile(join(gitDir, 'cmd', 'git.exe')) ??
        existingFile(join(gitDir, 'bin', 'git.exe')) ??
        existingFile(join(gitDir, 'mingw64', 'bin', 'git.exe')) ??
        existingFile(join(gitDir, 'clangarm64', 'bin', 'git.exe'))
      if (gitBin) out.OPENALICE_MANAGED_GIT_BIN = gitBin

      const shellPath =
        existingFile(join(gitDir, 'bin', 'bash.exe')) ??
        existingFile(join(gitDir, 'usr', 'bin', 'bash.exe'))
      if (shellPath) out.OPENALICE_MANAGED_SHELL_PATH = shellPath

      for (const rel of ['cmd', 'bin', 'usr/bin', 'mingw64/bin', 'clangarm64/bin']) {
        const dir = existingDir(join(gitDir, ...rel.split('/')))
        if (dir) toolchainPaths.push(dir)
      }
    }
  } else if (opts.launcherMode === 'electron-packaged') {
    const shellPath = existingFile('/bin/bash') ?? existingFile('/bin/sh')
    if (shellPath) out.OPENALICE_MANAGED_SHELL_PATH = shellPath
  }

  if (toolchainPaths.length > 0) {
    out.OPENALICE_MANAGED_TOOLCHAIN_PATH = toolchainPaths.join(delimiter)
  }

  return out
}
