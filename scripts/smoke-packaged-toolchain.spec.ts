import { spawnSync } from 'node:child_process'
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
      const appRoot = join(root, 'OpenAlice.app/Contents/Resources/runtime')
      touch(join(root, 'OpenAlice.app/Contents/MacOS/OpenAlice'))
      const plan = buildPackagedToolchainSmokePlan({
        ok: true,
        errors: [],
        appRoot,
        platform: 'darwin',
        platformArch: 'darwin-arm64',
        manifest: {
          pi: {
            version: '0.83.0',
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
      const cli = plan.commands.at(-1)!
      const result = spawnSync(process.execPath, ['src/workspaces/cli/bin/openalice-cli.cjs'], {
        encoding: 'utf8', env: { ...process.env, ...cli.env, ELECTRON_RUN_AS_NODE: '' },
      })
      expect(result.status).toBe(cli.expectStatus)
      expect(result.stderr).toMatch(cli.expectStderr)
      expect(plan.commands[1].expectStdout.test('0.83.0\n')).toBe(true)
      expect(plan.commands[1].expectStdout.test('0x83x0\n')).toBe(false)
      expect(packagedElectronExecutable(appRoot, 'darwin')?.replaceAll('\\', '/'))
        .toContain('OpenAlice.app/Contents/MacOS/OpenAlice')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('adds Windows managed Git Bash command probes', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-toolchain-win-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/runtime')
      touch(join(root, 'win-unpacked/OpenAlice.exe'))
      const plan = buildPackagedToolchainSmokePlan({
        ok: true,
        errors: [],
        appRoot,
        platform: 'win32',
        platformArch: 'win32-x64',
        manifest: {
          pi: {
            version: '0.83.0',
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
        'dugite JS wrapper routes Git operations through managed PortableGit',
        'managed bash.exe',
        'managed sh.exe can resolve git and bash on PATH',
        'Workspace CLI launcher through managed Git Bash',
        'Workspace CLI transport env through managed Git Bash',
      ])
      expect(plan.commands[2].command.replaceAll('\\', '/')).toContain('vendor/tools/win32-x64/bin/fd.exe')
      expect(plan.commands[6].command.replaceAll('\\', '/')).toContain('vendor/git/win32-x64/cmd/git.exe')
      expect(plan.commands[7].env?.LOCAL_GIT_DIRECTORY.replaceAll('\\', '/'))
        .toContain('vendor/git/win32-x64')
      expect(plan.commands[7].args.join('\n').replaceAll('\\', '/').replaceAll('//', '/'))
        .toContain('node_modules/dugite/build/lib/index.js')
      expect(plan.commands[9].env?.PATH.replaceAll('\\', '/')).toContain('vendor/git/win32-x64/mingw64/bin')
      expect(plan.commands[9].env?.PATH.replaceAll('\\', '/')).toContain('vendor/tools/win32-x64/bin')
      expect(plan.commands[10].env?.OPENALICE_MANAGED_PI_NODE_PATH.replaceAll('\\', '/'))
        .toContain('win-unpacked/OpenAlice.exe')
      const transport = plan.commands[11]
      expect(transport.env?.OPENALICE_TOOL_URL).toBe('/cli')
      const result = spawnSync(process.execPath, ['src/workspaces/cli/bin/openalice-cli.cjs', '--help'], {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          ...process.env,
          ...transport.env,
          OPENALICE_PROJECT_ID: '',
          OPENALICE_TOOL_SOCKET: join(root, 'missing.sock'),
          ELECTRON_RUN_AS_NODE: '',
        },
      })
      expect(result.status).toBe(transport.expectStatus)
      expect(result.stderr).toMatch(transport.expectStderr)
      expect(result.stdout).toBe('')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses a missing packaged executable', () => {
    const plan = buildPackagedToolchainSmokePlan({
      ok: true,
      errors: [],
      appRoot: '/tmp/missing/OpenAlice.app/Contents/Resources/runtime',
      platform: 'darwin',
      platformArch: null,
      manifest: {
        pi: {
          version: '0.83.0',
          cli: 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
        },
      },
    })

    expect(plan.ok).toBe(false)
    expect(plan.errors.join('\n')).toContain('packaged Electron executable not found')
  })
})
