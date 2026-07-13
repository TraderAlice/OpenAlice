import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  buildPackagedToolchainSmokePlan,
  packagedElectronExecutable,
} from './smoke-packaged-toolchain.mjs'

function touch(path: string) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, '')
}

describe('buildPackagedToolchainSmokePlan', () => {
  it('builds a macOS packaged Electron + Pi smoke plan', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-toolchain-mac-'))
    try {
      const appRoot = join(root, 'OpenAlice.app/Contents/Resources/app')
      touch(join(root, 'OpenAlice.app/Contents/MacOS/OpenAlice'))
      const plan = buildPackagedToolchainSmokePlan({
        ok: true,
        errors: [],
        appRoot,
        platform: 'darwin',
        platformArch: 'darwin-arm64',
        manifest: {
          pi: {
            cli: 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
          },
          searchTools: {
            'darwin-arm64': {
              path: 'vendor/tools/darwin-arm64',
              binPath: 'bin',
              fd: { binary: 'bin/fd' },
              rg: { binary: 'bin/rg' },
            },
          },
        },
      })

      expect(plan.ok).toBe(true)
      expect(plan.commands.map((command) => command.label)).toEqual([
        'packaged Electron Node mode',
        'managed Pi through packaged Electron Node',
        'managed fd',
        'managed ripgrep',
        'managed Pi resolves packaged fd/rg without download',
        'workspace CLI payload through packaged Electron Node',
      ])
      expect(packagedElectronExecutable(appRoot, 'darwin')?.replaceAll('\\', '/'))
        .toContain('OpenAlice.app/Contents/MacOS/OpenAlice')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('adds Windows managed Git Bash command probes', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-toolchain-win-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/app')
      touch(join(root, 'win-unpacked/OpenAlice.exe'))
      const plan = buildPackagedToolchainSmokePlan({
        ok: true,
        errors: [],
        appRoot,
        platform: 'win32',
        platformArch: 'win32-x64',
        manifest: {
          pi: {
            cli: 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
          },
          searchTools: {
            'win32-x64': {
              path: 'vendor/tools/win32-x64',
              binPath: 'bin',
              fd: { binary: 'bin/fd.exe' },
              rg: { binary: 'bin/rg.exe' },
            },
          },
          git: {
            'win32-x64': {
              path: 'vendor/git/win32-x64',
              gitBin: 'cmd/git.exe',
              shellPath: 'bin/bash.exe',
              shPath: 'bin/sh.exe',
              toolchainPaths: ['cmd', 'bin', 'usr/bin', 'mingw64/bin'],
            },
          },
        },
      })

      expect(plan.ok).toBe(true)
      expect(plan.commands.map((command) => command.label)).toEqual([
        'packaged Electron Node mode',
        'managed Pi through packaged Electron Node',
        'managed fd',
        'managed ripgrep',
        'managed Pi resolves packaged fd/rg without download',
        'workspace CLI payload through packaged Electron Node',
        'managed git.exe',
        'managed bash.exe',
        'managed sh.exe can resolve git and bash on PATH',
        'Workspace CLI launcher through managed Git Bash',
        'Workspace CLI transport env through managed Git Bash',
      ])
      expect(plan.commands[2].command.replaceAll('\\', '/')).toContain('vendor/tools/win32-x64/bin/fd.exe')
      expect(plan.commands[6].command.replaceAll('\\', '/')).toContain('vendor/git/win32-x64/cmd/git.exe')
      expect(plan.commands[8].env?.PATH.replaceAll('\\', '/')).toContain('vendor/git/win32-x64/mingw64/bin')
      expect(plan.commands[8].env?.PATH.replaceAll('\\', '/')).toContain('vendor/tools/win32-x64/bin')
      expect(plan.commands[9].env?.OPENALICE_MANAGED_PI_NODE_PATH.replaceAll('\\', '/'))
        .toContain('win-unpacked/OpenAlice.exe')
      expect(plan.commands[10].env?.OPENALICE_TOOL_URL).toBe('/cli')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a missing packaged executable', () => {
    const plan = buildPackagedToolchainSmokePlan({
      ok: true,
      errors: [],
      appRoot: '/tmp/missing/OpenAlice.app/Contents/Resources/app',
      platform: 'darwin',
      platformArch: null,
      manifest: {
        pi: {
          cli: 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        },
      },
    })

    expect(plan.ok).toBe(false)
    expect(plan.errors.join('\n')).toContain('packaged Electron executable not found')
  })
})
