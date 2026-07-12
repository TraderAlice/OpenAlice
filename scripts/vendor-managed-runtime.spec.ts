import { describe, expect, it } from 'vitest'

import {
  buildVendorRuntimeManifest,
  requiredManagedSearchToolFiles,
  requiredWindowsGitFiles,
  resolveManagedSearchToolsSpec,
  resolveWindowsGitRuntimeSpec,
} from './vendor-managed-runtime.mjs'

describe('vendor managed runtime helpers', () => {
  it('pins the managed Pi release', () => {
    expect(buildVendorRuntimeManifest(null).pi.version).toBe('0.80.6')
  })

  it('pins both Pi search tools for every supported desktop architecture', () => {
    const windows = resolveManagedSearchToolsSpec({ platform: 'win32', arch: 'x64' })
    expect(windows).toMatchObject({
      platformArch: 'win32-x64',
      root: 'vendor/tools/win32-x64',
      binPath: 'bin',
      tools: {
        fd: { version: '10.4.2', binaryName: 'fd.exe' },
        rg: { version: '15.1.0', binaryName: 'rg.exe' },
      },
    })
    expect(requiredManagedSearchToolFiles(windows!)).toEqual([
      'bin/fd.exe',
      'licenses/fd/LICENSE-APACHE',
      'licenses/fd/LICENSE-MIT',
      'bin/rg.exe',
      'licenses/rg/LICENSE-MIT',
      'licenses/rg/UNLICENSE',
    ])

    const intelMac = resolveManagedSearchToolsSpec({ platform: 'darwin', arch: 'x64' })
    expect(intelMac?.tools.fd.version).toBe('10.3.0')
    expect(intelMac?.tools.rg.version).toBe('15.1.0')
    expect(resolveManagedSearchToolsSpec({ platform: 'linux', arch: 'x64' })).toBeNull()
  })

  it('writes search tool provenance and license paths into the runtime manifest', () => {
    const tools = resolveManagedSearchToolsSpec({ platform: 'darwin', arch: 'arm64' })
    const manifest = buildVendorRuntimeManifest(null, tools)

    expect(manifest.searchTools['darwin-arm64']).toMatchObject({
      path: 'vendor/tools/darwin-arm64',
      binPath: 'bin',
      fd: {
        version: '10.4.2',
        binary: 'bin/fd',
        distribution: 'sharkdp/fd',
        licenses: ['licenses/fd/LICENSE-APACHE', 'licenses/fd/LICENSE-MIT'],
      },
      rg: {
        version: '15.1.0',
        binary: 'bin/rg',
        distribution: 'BurntSushi/ripgrep',
        licenses: ['licenses/rg/LICENSE-MIT', 'licenses/rg/UNLICENSE'],
      },
    })
  })

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
