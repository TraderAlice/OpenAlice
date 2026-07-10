import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveManagedRuntimeEnv } from './managed-runtime.js'

function touch(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
}

describe('resolveManagedRuntimeEnv', () => {
  it('exposes packaged Pi and managed fd through the toolchain path', () => {
    const appHome = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-'))
    try {
      const piCli = join(
        appHome,
        'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      )
      const fdDir = join(appHome, 'vendor/tools/darwin-arm64')
      touch(piCli)
      touch(join(fdDir, 'fd'))

      const env = resolveManagedRuntimeEnv({
        appHome,
        launcherMode: 'electron-packaged',
        platform: 'darwin',
        arch: 'arm64',
        execPath: '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
      })

      expect(env.OPENALICE_RUNTIME_PROFILE).toBe('electron-packaged')
      expect(env.OPENALICE_MANAGED_PI_PATH).toBe(piCli)
      expect(env.OPENALICE_MANAGED_PI_NODE_PATH)
        .toBe('/Applications/OpenAlice.app/Contents/MacOS/OpenAlice')
      expect(env.OPENALICE_MANAGED_TOOLCHAIN_PATH).toBe(fdDir)
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })

  it('does not advertise an empty managed tools directory', () => {
    const appHome = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-empty-'))
    try {
      mkdirSync(join(appHome, 'vendor/tools/darwin-arm64'), { recursive: true })

      const env = resolveManagedRuntimeEnv({
        appHome,
        launcherMode: 'electron-dev',
        platform: 'darwin',
        arch: 'arm64',
      })

      expect(env.OPENALICE_MANAGED_TOOLCHAIN_PATH).toBeUndefined()
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })

  it('keeps managed fd ahead of the existing Windows Git toolchain', () => {
    const appHome = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-win-'))
    try {
      const fdDir = join(appHome, 'vendor/tools/win32-x64')
      const gitDir = join(appHome, 'vendor/git/win32-x64')
      touch(join(fdDir, 'fd.exe'))
      touch(join(gitDir, 'cmd/git.exe'))
      touch(join(gitDir, 'bin/bash.exe'))
      mkdirSync(join(gitDir, 'usr/bin'), { recursive: true })
      mkdirSync(join(gitDir, 'mingw64/bin'), { recursive: true })

      const env = resolveManagedRuntimeEnv({
        appHome,
        launcherMode: 'electron-packaged',
        platform: 'win32',
        arch: 'x64',
      })

      expect(env.OPENALICE_MANAGED_GIT_BIN).toBe(join(gitDir, 'cmd/git.exe'))
      expect(env.OPENALICE_MANAGED_SHELL_PATH).toBe(join(gitDir, 'bin/bash.exe'))
      expect(env.OPENALICE_MANAGED_TOOLCHAIN_PATH?.split(delimiter)).toEqual([
        fdDir,
        join(gitDir, 'cmd'),
        join(gitDir, 'bin'),
        join(gitDir, 'usr/bin'),
        join(gitDir, 'mingw64/bin'),
      ])
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })
})
