import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { createPackageWithOptions, uncache } from '@electron/asar'

import { ASAR_REQUIRED_FILES, BASE_REQUIRED_FILES, assertDesktopPackage } from './assert-desktop-package.mjs'
import { INSTALL_INTEGRITY_FILE, collectInstallIntegrity } from './desktop-install-integrity.mjs'

const PI_CLI = 'vendor/pi/node_modules/@earendil-works/pi-coding-agent/dist/cli.js'

function writePackageFile(appRoot: string, file: string, content = '') {
  const path = join(appRoot, file)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function writeIntegrityManifest(appRoot: string) {
  const resources = dirname(appRoot)
  writePackageFile(resources, INSTALL_INTEGRITY_FILE, JSON.stringify(collectInstallIntegrity(resources, { version: '0.91.1' })))
}

async function writeBasePackage(
  appRoot: string,
  manifest: unknown,
  options: { duplicateResource?: boolean; buildIntermediate?: boolean } = {},
) {
  for (const file of BASE_REQUIRED_FILES) {
    if (file === 'vendor/manifest.json') continue
    writePackageFile(appRoot, file)
  }
  writePackageFile(appRoot, 'package.json', JSON.stringify({ version: '0.91.1' }))
  writePackageFile(appRoot, 'vendor/manifest.json', JSON.stringify(manifest))
  const input = join(dirname(appRoot), 'fixture-source')
  // Native Windows builder retains these empty directory entries when it
  // moves their files to extraResources. They are not duplicated payloads.
  for (const dir of ['default', 'vendor', 'ui/dist', 'src/workspaces/templates']) {
    mkdirSync(join(input, dir), { recursive: true })
  }
  if (options.duplicateResource) writePackageFile(input, 'default/duplicated.md', 'duplicate')
  if (options.buildIntermediate) writePackageFile(input, 'node_modules/node-pty/build/Release/obj/pty/pty.obj', 'obj')
  for (const file of ASAR_REQUIRED_FILES) writePackageFile(input, file)
  writePackageFile(input, 'package.json', JSON.stringify({ version: '0.91.1' }))
  writePackageFile(input, 'node_modules/node-pty/build/Release/pty.node')
  await createPackageWithOptions(input, join(dirname(appRoot), 'app.asar'), { unpack: '**/*.node' })
  rmSync(input, { recursive: true, force: true })
  writeIntegrityManifest(appRoot)
}

function piManifest() {
  return {
    pi: {
      version: '0.83.0',
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
  it.each(['mac', 'win'])('keeps the real builder %s file selection inside the app-code boundary', (platform) => {
    const root = resolve(import.meta.dirname, '..')
    const desktopRequire = createRequire(join(root, 'apps/desktop/package.json'))
    const builderRequire = createRequire(desktopRequire.resolve('electron-builder'))
    const { doMergeConfigs } = builderRequire('app-builder-lib/out/util/config/config.js')
    const { getMainFileMatchers, getNodeModuleFileMatcher } = builderRequire('app-builder-lib/out/fileMatcher.js')
    const { AppFileWalker } = builderRequire('app-builder-lib/out/util/AppFileWalker.js')
    // Exercise builder's normalization: a platform string exclusion can create
    // a separate all-files matcher beside the normalized global FileSet.
    const config = doMergeConfigs([JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).build])
    const info = { config, projectDir: root, buildResourcesDir: 'build', debugLogger: { isEnabled: false } }
    const destination = join(root, 'dist/inspector-fixture')
    const expand = (value: string) => value
    const matchers = getMainFileMatchers(root, destination, expand, config[platform], { info }, join(root, 'dist/electron-app'), false)
    const fileStat = { isDirectory: () => false }
    const filters = matchers.map((matcher: unknown) => new AppFileWalker(matcher, info).filter)
    const selected = (file: string) => filters.some((filter: (path: string, stat: unknown) => boolean) =>
      filter(join(root, file), fileStat))
    for (const file of ['dist/main.js', 'dist/electron/main.js', 'services/uta/dist/uta.js', 'services/connector/dist/connector.cjs']) {
      expect(selected(file), file).toBe(true)
    }
    for (const file of ['default/alice-harness.json', 'ui/dist/index.html', 'vendor/pi/package.json', 'src/main.ts', 'docs/README.md']) {
      expect(selected(file), file).toBe(false)
    }
    const dependencyFilter = getNodeModuleFileMatcher(root, destination, expand, config[platform], info).createFilter()
    expect(dependencyFilter(join(root, 'node_modules/dugite/build/lib/index.js'), fileStat)).toBe(true)
    expect(dependencyFilter(join(root, 'node_modules/dugite/git/bin/git'), fileStat)).toBe(platform === 'mac')
    expect(dependencyFilter(join(root, 'node_modules/node-pty/build/Release/pty.node'), fileStat)).toBe(true)
    expect(dependencyFilter(join(root, 'node_modules/node-pty/build/Release/winpty-agent.exe'), fileStat)).toBe(true)
    for (const file of [
      'node_modules/node-pty/build/Release/obj/pty/pty.obj',
      'node_modules/node-pty/build/Release/obj/conpty/conpty.tlog/CL.command.1.tlog',
      'node_modules/node-pty/build/deps/winpty/src/Release/obj/agent/Agent.obj',
      'node_modules/node-pty/build/Release/pty.lib',
      'node_modules/node-pty/build/Release/winpty.iobj',
      'node_modules/node-pty/build/Release/conpty.ipdb',
      'node_modules/node-pty/build/Release/conpty.exp',
    ]) {
      expect(dependencyFilter(join(root, file), fileStat), file).toBe(false)
    }
  })

  it('rejects duplicated resource files while permitting empty archive directories', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-duplicate-'))
    try {
      const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/runtime')
      await writeBasePackage(appRoot, { ...piManifest(), ...searchToolsManifest('darwin-arm64') }, { duplicateResource: true })
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).errors.join('\n'))
        .toContain('external runtime resource duplicated in ASAR: default/duplicated.md')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects node-pty compiler intermediates inside the archive', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-intermediates-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/runtime')
      await writeBasePackage(appRoot, piManifest(), { buildIntermediate: true })
      expect(assertDesktopPackage({ packageRoot: root, arch: 'x64' }).errors.join('\n'))
        .toContain('node-pty build intermediates must not ship: node_modules/node-pty/build/Release/obj/pty/pty.obj')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires the install integrity inventory to match the packaged payload', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-integrity-'))
    const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/runtime')
    try {
      await writeBasePackage(appRoot, { ...piManifest(), ...searchToolsManifest('darwin-arm64') })
      writeSearchToolFiles(appRoot, 'darwin-arm64')
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/dugite/git/bin/git')
      writeIntegrityManifest(appRoot)
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).ok).toBe(true)

      rmSync(join(appRoot, 'src/workspaces/templates/_common.mjs'))
      writePackageFile(appRoot, 'ui/dist/index.html', 'truncated differently')
      const errors = assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).errors.join('\n')
      expect(errors).toContain(`${INSTALL_INTEGRITY_FILE} lists a missing file: runtime/src/workspaces/templates/_common.mjs`)
      expect(errors).toContain(`${INSTALL_INTEGRITY_FILE} size differs on disk: runtime/ui/dist/index.html`)

      rmSync(join(dirname(appRoot), INSTALL_INTEGRITY_FILE))
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).errors.join('\n'))
        .toContain(`unreadable ${INSTALL_INTEGRITY_FILE}`)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a legacy loose app tree with no ASAR runtime layout', () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-legacy-'))
    try {
      writePackageFile(join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/app'), 'package.json', '{}')
      expect(assertDesktopPackage({ packageRoot: root }).ok).toBe(false)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects a corrupt archive, missing native payload, and mismatched product metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-asar-invalid-'))
    const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/runtime')
    try {
      await writeBasePackage(appRoot, { ...piManifest(), ...searchToolsManifest('darwin-arm64') })
      writeSearchToolFiles(appRoot, 'darwin-arm64')
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/dugite/git/bin/git')
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).ok).toBe(true)
      rmSync(join(dirname(appRoot), 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'))
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).errors.join('\n'))
        .toContain('native payload must be unpacked')
      writePackageFile(appRoot, 'package.json', JSON.stringify({ version: '0.0.0' }))
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).errors.join('\n'))
        .toContain('product versions differ')
      const archivePath = join(dirname(appRoot), 'app.asar')
      uncache(archivePath)
      writeFileSync(archivePath, 'broken')
      expect(assertDesktopPackage({ packageRoot: root, arch: 'arm64' }).errors.join('\n'))
        .toContain('invalid app.asar')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires managed search tools but not vendor Git in macOS packages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-mac-'))
    try {
      const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/runtime')
      await writeBasePackage(appRoot, { ...piManifest(), ...searchToolsManifest('darwin-arm64') })
      writeSearchToolFiles(appRoot, 'darwin-arm64')
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/dugite/git/bin/git')

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'arm64' })

      expect(result.ok).toBe(true)
      expect(result.platform).toBe('darwin')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('requires managed Git Bash files and manifest metadata in Windows packages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-win-missing-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/runtime')
      await writeBasePackage(appRoot, piManifest())

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

  it('accepts Windows packages with PortableGit files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-win-ok-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/runtime')
      await writeBasePackage(appRoot, {
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

  it('rejects dugite embedded Git in Windows packages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-win-dugite-git-'))
    try {
      const appRoot = join(root, 'win-unpacked/resources/runtime')
      await writeBasePackage(appRoot, {
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
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/dugite/git/cmd/git.exe')

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'x64' })

      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain('dugite\'s embedded Git payload is forbidden')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('rejects optional broker SDKs bundled into the desktop app', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-package-broker-sdk-'))
    try {
      const appRoot = join(root, 'mac-arm64/OpenAlice.app/Contents/Resources/runtime')
      await writeBasePackage(appRoot, { ...piManifest(), ...searchToolsManifest('darwin-arm64') })
      writeSearchToolFiles(appRoot, 'darwin-arm64')
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/dugite/git/bin/git')
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/.pnpm/ccxt@4.5.38/package.json')
      writePackageFile(join(dirname(appRoot), 'app.asar.unpacked'), 'node_modules/longbridge/package.json')

      const result = assertDesktopPackage({ packageRoot: root, repoRoot: root, arch: 'arm64' })

      expect(result.ok).toBe(false)
      expect(result.errors.join('\n')).toContain('optional broker SDKs')
      expect(result.errors.join('\n')).toContain('ccxt')
      expect(result.errors.join('\n')).toContain('longbridge')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
