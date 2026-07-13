import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { prepareBuildMetadata, prepareMirrorAssets } from './prepare-desktop-release-assets.mjs'

function withTempDir(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'openalice-release-assets-'))
  try {
    run(dir)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('prepareBuildMetadata', () => {
  it('keeps arm64 canonical metadata and gives Intel its own feeds', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'beta-mac.yml'), 'version: 1.2.3-beta\n')
      prepareBuildMetadata({ outDir: dir, platform: 'macOS', arch: 'x64', version: '1.2.3-beta' })

      expect(readFileSync(join(dir, 'latest-mac-intel.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'latest-intel-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-mac-intel.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-intel-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(() => readFileSync(join(dir, 'beta-mac.yml'))).toThrow()
    })

    withTempDir((dir) => {
      writeFileSync(join(dir, 'beta-mac.yml'), 'version: 1.2.3-beta\n')
      prepareBuildMetadata({ outDir: dir, platform: 'macOS', arch: 'arm64', version: '1.2.3-beta' })

      expect(readFileSync(join(dir, 'beta-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-mac-arm64.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'latest-mac-arm64.yml'), 'utf8')).toContain('1.2.3-beta')
    })
  })
})

describe('prepareMirrorAssets', () => {
  it('publishes distinct arm64 and Intel aliases and manifest entries', () => {
    withTempDir((dir) => {
      const files = [
        'OpenAlice-1.2.3-beta-arm64.dmg',
        'OpenAlice-1.2.3-beta-arm64-mac.zip',
        'OpenAlice-1.2.3-beta.dmg',
        'OpenAlice-1.2.3-beta-mac.zip',
        'OpenAlice.Setup.1.2.3-beta.exe',
        'OpenAlice.Setup.1.2.3-beta.exe.blockmap',
      ]
      for (const file of files) writeFileSync(join(dir, file), file)
      writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.2.3-beta\n')
      writeFileSync(join(dir, 'latest-mac-intel.yml'), 'version: 1.2.3-beta\n')
      writeFileSync(join(dir, 'latest-intel-mac.yml'), 'version: 1.2.3-beta\n')
      writeFileSync(join(dir, 'latest.yml'), 'version: 1.2.3-beta\npath: OpenAlice.Setup.1.2.3-beta.exe\n')
      mkdirSync(join(dir, 'unused'))

      const manifest = prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3-beta',
        baseUrl: 'https://download.openalice.ai/',
        repository: 'TraderAlice/OpenAlice',
      })

      expect(readFileSync(join(dir, 'mac-arm64.dmg'), 'utf8')).toContain('arm64')
      expect(readFileSync(join(dir, 'mac-x64.dmg'), 'utf8')).toBe('OpenAlice-1.2.3-beta.dmg')
      expect(readFileSync(join(dir, 'beta-mac-intel.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-intel-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(manifest.feeds.macIntel).toBe('https://download.openalice.ai/beta-mac-intel.yml')
      expect(manifest.macX64Dmg).toBe('https://download.openalice.ai/mac-x64.dmg')
      expect(manifest.versioned.macX64Zip).toBe('https://download.openalice.ai/OpenAlice-1.2.3-beta-mac.zip')
    })
  })

  it('keeps old arm64-only releases mirrorable without claiming an Intel feed', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'OpenAlice-1.2.2-arm64.dmg'), 'arm64 dmg')
      writeFileSync(join(dir, 'OpenAlice-1.2.2-arm64-mac.zip'), 'arm64 zip')
      writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.2.2\n')

      const manifest = prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.2',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })

      expect(manifest.feeds.macIntel).toBeNull()
      expect(manifest.macX64Dmg).toBeNull()
      expect(manifest.macArm64Dmg).toBe('https://download.openalice.ai/mac-arm64.dmg')
    })
  })
})
