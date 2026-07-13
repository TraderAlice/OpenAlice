import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { resolveManagedRuntimeEnv } from './managed-runtime.js'

function touch(path: string): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
}

describe('resolveManagedRuntimeEnv', () => {
  it('publishes managed Pi and complete macOS search tools', () => {
    const appHome = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-mac-'))
    try {
      const piCli = join(
        appHome,
        'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      )
      const toolsBin = join(appHome, 'vendor/tools/darwin-arm64/bin')
      touch(piCli)
      touch(join(toolsBin, 'fd'))
      touch(join(toolsBin, 'rg'))

      const env = resolveManagedRuntimeEnv({
        appHome,
        launcherMode: 'electron-packaged',
        platform: 'darwin',
        arch: 'arm64',
        execPath: '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
      })

      expect(env.OPENALICE_MANAGED_PI_PATH).toBe(piCli)
      expect(env.OPENALICE_MANAGED_PI_NODE_PATH).toContain('/Applications/OpenAlice.app')
      expect(env.OPENALICE_MANAGED_TOOLCHAIN_PATH).toBe(toolsBin)
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })

  it('does not advertise a partial search tool payload', () => {
    const appHome = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-partial-'))
    try {
      touch(join(appHome, 'vendor/tools/darwin-arm64/bin/fd'))

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

  it('places Windows search tools before PortableGit directories', () => {
    const appHome = mkdtempSync(join(tmpdir(), 'openalice-managed-runtime-win-'))
    try {
      const toolsBin = join(appHome, 'vendor/tools/win32-x64/bin')
      const gitRoot = join(appHome, 'vendor/git/win32-x64')
      touch(join(toolsBin, 'fd.exe'))
      touch(join(toolsBin, 'rg.exe'))
      touch(join(gitRoot, 'cmd/git.exe'))
      touch(join(gitRoot, 'bin/bash.exe'))
      mkdirSync(join(gitRoot, 'usr/bin'), { recursive: true })
      mkdirSync(join(gitRoot, 'mingw64/bin'), { recursive: true })

      const env = resolveManagedRuntimeEnv({
        appHome,
        launcherMode: 'electron-packaged',
        platform: 'win32',
        arch: 'x64',
        execPath: 'C:\\OpenAlice\\OpenAlice.exe',
      })

      const toolchain = env.OPENALICE_MANAGED_TOOLCHAIN_PATH?.split(delimiter) ?? []
      expect(toolchain[0]).toBe(toolsBin)
      expect(toolchain).toContain(join(gitRoot, 'mingw64/bin'))
      expect(env.OPENALICE_MANAGED_SHELL_PATH).toBe(join(gitRoot, 'bin/bash.exe'))
    } finally {
      rmSync(appHome, { recursive: true, force: true })
    }
  })
})
