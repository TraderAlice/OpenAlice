import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { BASE_REQUIRED_FILES, assertDesktopPackage } from './assert-desktop-package.mjs'

const PI_CLI = 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'

function writePackageFile(appRoot: string, file: string, content = '') {
  const path = join(appRoot, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeBasePackage(appRoot: string, manifest: unknown) {
  for (const file of BASE_REQUIRED_FILES) {
    if (file === 'vendor/manifest.json') continue
    writePackageFile(appRoot, file)
  }
  writePackageFile(appRoot, 'vendor/manifest.json', JSON.stringify(manifest))
}

function piManifest() {
  return {
    pi: {
      version: '0.80.6',
      mode: 'npm',
      cli: PI_CLI,
    },
  }
}

function searchToolsManifest(platformArch: string, windows = false) {
  return {
    searchTools: {
      [platformArch]: {
        path: `vendor/tools/${platformArch}`,
        binPath: 'bin',
        fd: {
          version: windows || platformArch.endsWith('arm64') ? '10.4.2' : '10.3.0',
          binary: `bin/fd${windows ? '.exe' : ''}`,
        },
        rg: { version: '15.1.0', binary: `bin/rg${windows ? '.exe' : ''}` },
      },
    },
  }
}

function writeSearchToolFiles(appRoot: string, platformArch: string, windows = false) {
  writePackageFile(appRoot, `vendor/tools/${platformArch}/bin/fd${windows ? '.exe' : ''}`)
  writePackageFile(appRoot, `vendor/tools/${platformArch}/bin/rg${windows ? '.exe' : ''}`)
  writePackageFile(appRoot, `vendor/tools/${platformArch}/licenses/fd/LICENSE-APACHE`)
  writePackageFile(appRoot, `vendor/tools/${platformArch}/licenses/fd/LICENSE-MIT`)
  writePackageFile(appRoot, `vendor/tools/${platformArch}/licenses/rg/LICENSE-MIT`)
  writePackageFile(appRoot, `vendor/tools/${platformArch}/licenses/rg/UNLICENSE`)
}

describe('assertDesktopPackage', () => {
  it('requires managed search tools but not vendor Git in macOS packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-mac-'))
    try {
      const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/app')
      writeBasePackage(appRoot, { ...piManifest(), ...searchToolsManifest('darwin-arm64') })
      writeSearchToolFiles(appRoot, 'darwin-arm64')

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'arm64' })

      expect(result.ok).toBe(true)
      expect(result.platform).toBe('darwin')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires managed Git Bash files and manifest metadata in Windows packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-win-missing-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/app')
      writeBasePackage(appRoot, piManifest())

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'x64' })

      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain('vendor/tools/win32-x64/bin/fd.exe')
      expect(result.errors.join('\n')).toContain('expected manifest.searchTools.win32-x64')
      expect(result.errors.join('\n')).toContain('vendor/git/win32-x64/cmd/git.exe')
      expect(result.errors.join('\n')).toContain('vendor/git/win32-x64/bin/bash.exe')
      expect(result.errors.join('\n')).toContain('expected manifest.git.win32-x64')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('accepts Windows packages with PortableGit files', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-win-ok-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/app')
      writeBasePackage(appRoot, {
        ...piManifest(),
        ...searchToolsManifest('win32-x64', true),
        git: {
          'win32-x64': {
            version: '2.55.0.2',
            path: 'vendor/git/win32-x64',
            gitBin: 'cmd/git.exe',
            shellPath: 'bin/bash.exe',
            shPath: 'bin/sh.exe',
          },
        },
      })
      writePackageFile(appRoot, 'vendor/git/win32-x64/cmd/git.exe')
      writePackageFile(appRoot, 'vendor/git/win32-x64/bin/bash.exe')
      writePackageFile(appRoot, 'vendor/git/win32-x64/bin/sh.exe')
      writeSearchToolFiles(appRoot, 'win32-x64', true)

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'x64' })

      expect(result.ok).toBe(true)
      expect(result.platform).toBe('win32')
      expect(result.platformArch).toBe('win32-x64')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
