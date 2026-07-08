import { describe, expect, it } from 'vitest'

import {
  buildVendorRuntimeManifest,
  requiredWindowsGitFiles,
  resolveWindowsGitRuntimeSpec,
} from './vendor-managed-runtime.mjs'

describe('vendor managed runtime helpers', () => {
  it('does not select a managed Git runtime on non-Windows hosts', () => {
    expect(resolveWindowsGitRuntimeSpec({ platform: 'darwin', arch: 'arm64' })).toBeNull()
    expect(resolveWindowsGitRuntimeSpec({ platform: 'linux', arch: 'x64' })).toBeNull()
  })

  it('pins the Windows x64 PortableGit runtime', () => {
    const spec = resolveWindowsGitRuntimeSpec({ platform: 'win32', arch: 'x64' })

    expect(spec).toMatchObject({
      version: '2.55.0.2',
      platformArch: 'win32-x64',
      root: 'vendor/git/win32-x64',
      gitBin: 'cmd/git.exe',
      shellPath: 'bin/bash.exe',
      shPath: 'bin/sh.exe',
      sha256: 'b20d42da3afa228e9fa6174480de820282667e799440d655e308f700dfa0d0df',
    })
    expect(spec?.url).toContain('PortableGit-2.55.0.2-64-bit.7z.exe')
    expect(requiredWindowsGitFiles(spec!)).toEqual([
      'cmd/git.exe',
      'bin/bash.exe',
      'bin/sh.exe',
    ])
  })

  it('writes Git metadata only when a Windows Git spec is provided', () => {
    const macManifest = buildVendorRuntimeManifest(null)
    expect(macManifest.git).toBeUndefined()

    const spec = resolveWindowsGitRuntimeSpec({ platform: 'win32', arch: 'x64' })
    const winManifest = buildVendorRuntimeManifest(spec)
    expect(winManifest.git['win32-x64']).toMatchObject({
      distribution: 'PortableGit',
      path: 'vendor/git/win32-x64',
      gitBin: 'cmd/git.exe',
      shellPath: 'bin/bash.exe',
      shPath: 'bin/sh.exe',
    })
  })
})
