import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackage } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import afterPack from './desktop-after-pack.mjs'
import { INSTALL_INTEGRITY_FILE, readInstallIntegrity, verifyInstallIntegrity } from './desktop-install-integrity.mjs'

describe('desktop product metadata projection', () => {
  it.each(['darwin', 'win32'])('takes %s runtime identity from the built archive', async (platform) => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-asar-metadata-'))
    try {
      const input = join(root, 'input')
      const resources = platform === 'darwin'
        ? join(root, 'OpenAlice.app/Contents/Resources')
        : join(root, 'resources')
      mkdirSync(input)
      mkdirSync(join(resources, 'runtime'), { recursive: true })
      writeFileSync(join(input, 'package.json'), JSON.stringify({
        name: 'open-alice', version: '0.91.2-beta.1', type: 'module',
        main: 'dist/electron/main.js', dependencies: { example: '1.0.0' },
      }))
      await createPackage(input, join(resources, 'app.asar'))
      await afterPack({
        electronPlatformName: platform, appOutDir: root,
        packager: { appInfo: { productFilename: 'OpenAlice' } },
      })
      expect(JSON.parse(readFileSync(join(resources, 'runtime/package.json'), 'utf8'))).toEqual({
        name: 'open-alice', version: '0.91.2-beta.1', type: 'module',
      })
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('inventories the archive, unpacked natives, and runtime payload after projecting metadata', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openalice-asar-integrity-'))
    try {
      const input = join(root, 'input')
      const resources = join(root, 'resources')
      mkdirSync(input)
      mkdirSync(join(resources, 'runtime/vendor/pi'), { recursive: true })
      mkdirSync(join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release'), { recursive: true })
      writeFileSync(join(input, 'package.json'), JSON.stringify({ name: 'open-alice', version: '0.92.1', type: 'module' }))
      await createPackage(input, join(resources, 'app.asar'))
      writeFileSync(join(resources, 'runtime/vendor/pi/package.json'), '{"name":"pi"}')
      writeFileSync(join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'), 'native')
      writeFileSync(join(resources, 'elevate.exe'), 'not inventoried')

      await afterPack({ electronPlatformName: 'win32', appOutDir: root, packager: { appInfo: { productFilename: 'OpenAlice' } } })

      const manifest = readInstallIntegrity(resources)
      expect(manifest.version).toBe('0.92.1')
      expect(manifest.files).toEqual([
        ['app.asar', statSync(join(resources, 'app.asar')).size],
        ['app.asar.unpacked/node_modules/node-pty/build/Release/pty.node', 6],
        ['runtime/package.json', statSync(join(resources, 'runtime/package.json')).size],
        ['runtime/vendor/pi/package.json', 13],
      ])
      expect(verifyInstallIntegrity(resources, manifest)).toEqual({ checked: 4, missing: [], mismatched: [] })

      rmSync(join(resources, 'runtime/vendor/pi/package.json'))
      writeFileSync(join(resources, 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'), 'nat')
      expect(verifyInstallIntegrity(resources, manifest)).toEqual({
        checked: 4,
        missing: ['runtime/vendor/pi/package.json'],
        mismatched: ['app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'],
      })
      rmSync(join(resources, INSTALL_INTEGRITY_FILE))
      expect(() => readInstallIntegrity(resources)).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
