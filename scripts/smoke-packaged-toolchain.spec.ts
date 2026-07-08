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
        platformArch: null,
        manifest: {
          pi: {
            cli: 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
          },
        },
      })

      expect(plan.ok).toBe(true)
      expect(plan.commands.map((command) => command.label)).toEqual([
        'packaged Electron Node mode',
        'managed Pi through packaged Electron Node',
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
        'managed git.exe',
        'managed bash.exe',
        'managed sh.exe can resolve git and bash on PATH',
      ])
      expect(plan.commands[2].command.replaceAll('\\', '/')).toContain('vendor/git/win32-x64/cmd/git.exe')
      expect(plan.commands[4].env?.PATH.replaceAll('\\', '/')).toContain('vendor/git/win32-x64/mingw64/bin')
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
