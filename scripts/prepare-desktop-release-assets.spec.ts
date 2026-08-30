import { createHash } from 'node:crypto'
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
  it('preserves the existing stable updater feed names', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.2.3\n')
      prepareBuildMetadata({ outDir: dir, platform: 'macOS', arch: 'arm64', version: '1.2.3' })
      expect(readFileSync(join(dir, 'latest-mac.yml'), 'utf8')).toContain('1.2.3')
      expect(readFileSync(join(dir, 'latest-mac-arm64.yml'), 'utf8')).toContain('1.2.3')
    })

    withTempDir((dir) => {
      writeFileSync(join(dir, 'latest-mac.yml'), 'version: 1.2.3\n')
      prepareBuildMetadata({ outDir: dir, platform: 'macOS', arch: 'x64', version: '1.2.3' })
      expect(readFileSync(join(dir, 'latest-mac-intel.yml'), 'utf8')).toContain('1.2.3')
      expect(readFileSync(join(dir, 'latest-intel-mac.yml'), 'utf8')).toContain('1.2.3')
      expect(() => readFileSync(join(dir, 'latest-mac.yml'))).toThrow()
    })

    withTempDir((dir) => {
      writeFileSync(join(dir, 'latest.yml'), 'version: 1.2.3\n')
      prepareBuildMetadata({ outDir: dir, platform: 'Windows', arch: 'x64', version: '1.2.3' })
      expect(readFileSync(join(dir, 'latest.yml'), 'utf8')).toContain('1.2.3')
      expect(() => readFileSync(join(dir, 'beta.yml'))).toThrow()
    })
  })

  it('keeps arm64 canonical metadata and gives Intel its own feeds', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'beta-mac.yml'), 'version: 1.2.3-beta\n')
      prepareBuildMetadata({ outDir: dir, platform: 'macOS', arch: 'x64', version: '1.2.3-beta' })

      expect(readFileSync(join(dir, 'beta-mac-intel.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-intel-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(() => readFileSync(join(dir, 'latest-mac-intel.yml'))).toThrow()
      expect(() => readFileSync(join(dir, 'latest-intel-mac.yml'))).toThrow()
      expect(() => readFileSync(join(dir, 'beta-mac.yml'))).toThrow()
    })

    withTempDir((dir) => {
      writeFileSync(join(dir, 'beta-mac.yml'), 'version: 1.2.3-beta\n')
      prepareBuildMetadata({ outDir: dir, platform: 'macOS', arch: 'arm64', version: '1.2.3-beta' })

      expect(readFileSync(join(dir, 'beta-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-mac-arm64.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(() => readFileSync(join(dir, 'latest-mac-arm64.yml'))).toThrow()
    })

    withTempDir((dir) => {
      writeFileSync(join(dir, 'latest.yml'), 'version: 1.2.3-beta\n')
      prepareBuildMetadata({ outDir: dir, platform: 'Windows', arch: 'x64', version: '1.2.3-beta' })

      expect(readFileSync(join(dir, 'beta.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(() => readFileSync(join(dir, 'latest.yml'))).toThrow()
    })
  })
})

describe('prepareMirrorAssets', () => {
  it('keeps beta feeds and manifests isolated while reusing the channel-neutral installer', () => {
    withTempDir((dir) => {
      const files = [
        'OpenAlice-1.2.3-beta-arm64.dmg',
        'OpenAlice-1.2.3-beta-arm64-mac.zip',
        'OpenAlice-1.2.3-beta.dmg',
        'OpenAlice-1.2.3-beta-mac.zip',
        'OpenAlice.Setup.1.2.3-beta.exe',
        'OpenAlice.Setup.1.2.3-beta.exe.blockmap',
        'OpenAlice-1.2.3-beta-install',
      ]
      for (const file of files) writeFileSync(join(dir, file), file)
      writeFileSync(join(dir, 'beta-mac.yml'), 'version: 1.2.3-beta\n')
      writeFileSync(join(dir, 'beta-mac-intel.yml'), 'version: 1.2.3-beta\n')
      writeFileSync(join(dir, 'beta-intel-mac.yml'), 'version: 1.2.3-beta\n')
      writeFileSync(join(dir, 'beta.yml'), 'version: 1.2.3-beta\npath: OpenAlice.Setup.1.2.3-beta.exe\n')
      mkdirSync(join(dir, 'unused'))

      const manifest = prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3-beta',
        baseUrl: 'https://download.openalice.ai/',
        repository: 'TraderAlice/OpenAlice',
      })

      expect(() => readFileSync(join(dir, 'mac-arm64.dmg'))).toThrow()
      expect(() => readFileSync(join(dir, 'mac-x64.dmg'))).toThrow()
      expect(() => readFileSync(join(dir, 'windows-x64.exe'))).toThrow()
      expect(readFileSync(join(dir, 'install'), 'utf8')).toBe('OpenAlice-1.2.3-beta-install')
      expect(() => readFileSync(join(dir, 'manifest.json'))).toThrow()
      expect(readFileSync(join(dir, 'beta-mac-intel.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(readFileSync(join(dir, 'beta-intel-mac.yml'), 'utf8')).toContain('1.2.3-beta')
      expect(JSON.parse(readFileSync(join(dir, 'beta', 'manifest.json'), 'utf8'))).toMatchObject({
        channel: 'beta',
        version: '1.2.3-beta',
      })
      expect(manifest.feeds.macIntel).toBe('https://download.openalice.ai/beta-mac-intel.yml')
      expect(manifest.macX64Dmg).toBe('https://download.openalice.ai/OpenAlice-1.2.3-beta.dmg')
      expect(manifest.versioned.macX64Zip).toBe('https://download.openalice.ai/OpenAlice-1.2.3-beta-mac.zip')
      expect(() => readFileSync(join(dir, 'beta', 'install'))).toThrow()
      expect(manifest.installer).toEqual({
        url: 'https://download.openalice.ai/install',
        sha256: createHash('sha256').update('OpenAlice-1.2.3-beta-install').digest('hex'),
        versionedUrl: 'https://download.openalice.ai/OpenAlice-1.2.3-beta-install',
      })
    })
  })

  it('leaves existing stable aliases byte-for-byte unchanged while preparing beta', () => {
    withTempDir((dir) => {
      const stableAliases = [
        'manifest.json',
        'latest-mac.yml',
        'latest-intel-mac.yml',
        'latest.yml',
        'mac-arm64.dmg',
        'windows-x64.exe',
      ]
      const before = new Map(stableAliases.map((file) => {
        const bytes = `stable:${file}`
        writeFileSync(join(dir, file), bytes)
        return [file, createHash('sha256').update(bytes).digest('hex')]
      }))
      for (const file of [
        'OpenAlice-1.2.3-beta.1-arm64.dmg',
        'OpenAlice.Setup.1.2.3-beta.1.exe',
        'OpenAlice.Setup.1.2.3-beta.1.exe.blockmap',
        'OpenAlice-1.2.3-beta.1-install',
      ]) writeFileSync(join(dir, file), `beta:${file}`)
      writeFileSync(join(dir, 'beta-mac.yml'), 'version: 1.2.3-beta.1\n')
      writeFileSync(join(dir, 'beta.yml'), 'version: 1.2.3-beta.1\npath: OpenAlice.Setup.1.2.3-beta.1.exe\n')

      prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3-beta.1',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })

      for (const [file, digest] of before) {
        expect(createHash('sha256').update(readFileSync(join(dir, file))).digest('hex')).toBe(digest)
      }
      expect(readFileSync(join(dir, 'install'), 'utf8'))
        .toBe('beta:OpenAlice-1.2.3-beta.1-install')
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
      expect(manifest.installer).toBeNull()
      expect(manifest.macX64Dmg).toBeNull()
      expect(manifest.macArm64Dmg).toBe('https://download.openalice.ai/mac-arm64.dmg')
      expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'))).toMatchObject({
        channel: 'stable',
        version: '1.2.2',
      })
    })
  })

  it('rejects prerelease channels other than beta', () => {
    withTempDir((dir) => {
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3-rc.1',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('unsupported release channel: rc')
    })
  })
})
