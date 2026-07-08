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
      version: '0.80.3',
      mode: 'npm',
      cli: PI_CLI,
    },
  }
}

describe('assertDesktopPackage', () => {
  it('does not require vendor Git in macOS packages', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-mac-'))
    try {
      const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/app')
      writeBasePackage(appRoot, piManifest())

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

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'x64' })

      expect(result.ok).toBe(true)
      expect(result.platform).toBe('win32')
      expect(result.platformArch).toBe('win32-x64')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
