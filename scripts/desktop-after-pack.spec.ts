import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPackage } from '@electron/asar'
import { describe, expect, it } from 'vitest'
import afterPack from './desktop-after-pack.mjs'

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
})
