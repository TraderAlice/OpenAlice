import { describe, expect, it } from 'vitest'

import {
  buildVendorRuntimeManifest,
  requiredWindowsGitFiles,
  resolveFdRuntimeSpec,
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

  it('pins fd for the supported desktop release targets', () => {
    expect(resolveFdRuntimeSpec({ platform: 'darwin', arch: 'arm64' })).toMatchObject({
      version: '10.4.2',
      platformArch: 'darwin-arm64',
      path: 'vendor/tools/darwin-arm64/fd',
      sha256: '623dc0afc81b92e4d4606b380d7bc91916ba7b97814263e554d50923a39e480a',
    })
    expect(resolveFdRuntimeSpec({ platform: 'win32', arch: 'x64' })).toMatchObject({
      version: '10.4.2',
      platformArch: 'win32-x64',
      path: 'vendor/tools/win32-x64/fd.exe',
      sha256: 'b2816e506390a89941c63c9187d58a3cc10e9a55f2ef0685f9ea0eccaf7c98c8',
    })
    expect(resolveFdRuntimeSpec({ platform: 'win32', arch: 'arm64' })).toMatchObject({
      platformArch: 'win32-arm64',
      path: 'vendor/tools/win32-arm64/fd.exe',
    })
    expect(resolveFdRuntimeSpec({ platform: 'linux', arch: 'x64' })).toMatchObject({
      platformArch: 'linux-x64',
      path: 'vendor/tools/linux-x64/fd',
      sha256: 'def59805cd14b5651b68990855f426ad087f3b96881296d963910431ba3143c8',
    })
    expect(resolveFdRuntimeSpec({ platform: 'linux', arch: 'arm64' })).toMatchObject({
      platformArch: 'linux-arm64',
      path: 'vendor/tools/linux-arm64/fd',
    })
    expect(resolveFdRuntimeSpec({ platform: 'freebsd', arch: 'x64' })).toBeNull()
    expect(() => resolveFdRuntimeSpec({ platform: 'darwin', arch: 'x64' }))
      .toThrow('unsupported darwin architecture')
  })

  it('writes platform-specific fd and Git metadata', () => {
    const macFd = resolveFdRuntimeSpec({ platform: 'darwin', arch: 'arm64' })
    const macManifest = buildVendorRuntimeManifest(macFd, null)
    expect(macManifest.git).toBeUndefined()
    expect(macManifest.fd['darwin-arm64']).toMatchObject({
      distribution: 'sharkdp/fd',
      path: 'vendor/tools/darwin-arm64/fd',
    })

    const winFd = resolveFdRuntimeSpec({ platform: 'win32', arch: 'x64' })
    const winGit = resolveWindowsGitRuntimeSpec({ platform: 'win32', arch: 'x64' })
    const winManifest = buildVendorRuntimeManifest(winFd, winGit)
    expect(winManifest.git['win32-x64']).toMatchObject({
      distribution: 'PortableGit',
      path: 'vendor/git/win32-x64',
      gitBin: 'cmd/git.exe',
      shellPath: 'bin/bash.exe',
      shPath: 'bin/sh.exe',
    })
    expect(winManifest.fd['win32-x64'].path).toBe('vendor/tools/win32-x64/fd.exe')
  })
})
