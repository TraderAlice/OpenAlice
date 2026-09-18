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

function nativeBootstrapFixture(platform: string, arch: string) {
  const bytes = Buffer.alloc(1024)
  if (platform === 'win32') {
    bytes.write('MZ', 0, 'ascii')
    const peOffset = 0x80
    bytes.writeUInt32LE(peOffset, 0x3c)
    bytes.write('PE\0\0', peOffset, 'ascii')
    bytes.writeUInt16LE(arch === 'x64' ? 0x8664 : 0xaa64, peOffset + 4)
    bytes.writeUInt16LE(1, peOffset + 6)
    bytes.writeUInt16LE(240, peOffset + 20)
    bytes.writeUInt16LE(0x0002, peOffset + 22)
    const optional = peOffset + 24
    bytes.writeUInt16LE(0x20b, optional)
    bytes.writeUInt32LE(0x1000, optional + 16)
    bytes.writeUInt32LE(0x2000, optional + 56)
    bytes.writeUInt32LE(16, optional + 108)
    const section = optional + 240
    bytes.writeUInt32LE(0x100, section + 8)
    bytes.writeUInt32LE(0x1000, section + 12)
    bytes.writeUInt32LE(16, section + 16)
    bytes.writeUInt32LE(0x200, section + 20)
    bytes.writeUInt32LE(0x20000000, section + 36)
  } else if (platform === 'linux') {
    Buffer.from([0x7f, 0x45, 0x4c, 0x46]).copy(bytes)
    bytes[4] = 2
    bytes[5] = 1
    bytes.writeUInt16LE(2, 16)
    bytes.writeUInt16LE(arch === 'x64' ? 0x3e : 0xb7, 18)
    bytes.writeBigUInt64LE(0x1000n, 24)
    bytes.writeBigUInt64LE(64n, 32)
    bytes.writeUInt16LE(64, 52)
    bytes.writeUInt16LE(56, 54)
    bytes.writeUInt16LE(1, 56)
    bytes.writeUInt32LE(1, 64)
    bytes.writeUInt32LE(1, 68)
    bytes.writeBigUInt64LE(0n, 72)
    bytes.writeBigUInt64LE(0x1000n, 80)
    bytes.writeBigUInt64LE(BigInt(bytes.length), 96)
    bytes.writeBigUInt64LE(BigInt(bytes.length), 104)
  } else {
    bytes.writeUInt32LE(0xfeedfacf, 0)
    bytes.writeUInt32LE(arch === 'x64' ? 0x01000007 : 0x0100000c, 4)
    bytes.writeUInt32LE(2, 12)
    bytes.writeUInt32LE(2, 16)
    bytes.writeUInt32LE(96, 20)
    bytes.writeUInt32LE(0x19, 32)
    bytes.writeUInt32LE(72, 36)
    bytes.writeBigUInt64LE(BigInt(bytes.length), 64)
    bytes.writeBigUInt64LE(0n, 72)
    bytes.writeBigUInt64LE(BigInt(bytes.length), 80)
    bytes.writeUInt32LE(4, 92)
    bytes.writeUInt32LE(0x80000028, 104)
    bytes.writeUInt32LE(24, 108)
    bytes.writeBigUInt64LE(0x100n, 112)
  }
  return bytes
}


function writeNativeBootstrapMatrix(dir: string, version = '1.2.3') {
  for (const [platform, arch] of [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
    ['win32', 'arm64'],
    ['win32', 'x64'],
  ]) {
    const asset = `openalice-bootstrap-${version}-${platform}-${arch}${platform === 'win32' ? '.exe' : ''}`
    const bytes = nativeBootstrapFixture(platform, arch)
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    writeFileSync(join(dir, asset), bytes)
    writeFileSync(join(dir, `${asset}.sha256`), `${sha256}  ${asset}\n`)
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
  it('binds the PowerShell snapshot separately without changing the desktop updater', () => {
    withTempDir((dir) => {
      const name = 'OpenAlice-1.2.3-beta-install.ps1'
      writeFileSync(join(dir, name), '# OpenAlice Windows CLI installer\n')
      const manifest = prepareMirrorAssets({ outDir: dir, tag: 'v1.2.3-beta', repository: 'TraderAlice/OpenAlice', baseUrl: 'https://download.openalice.ai' })
      expect(manifest.windowsInstaller).toEqual({
        url: 'https://download.openalice.ai/install.ps1',
        versionedUrl: `https://download.openalice.ai/${name}`,
        sha256: createHash('sha256').update(readFileSync(join(dir, name))).digest('hex'),
      })
      expect(readFileSync(join(dir, 'install.ps1'))).toEqual(readFileSync(join(dir, name)))
      expect(manifest.feeds.windows).toBe('https://download.openalice.ai/beta.yml')
    })
  })
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
  it('publishes a complete checksum-bound native bootstrap matrix', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)

      const manifest = prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai/',
        repository: 'TraderAlice/OpenAlice',
      })

      expect(manifest.bootstraps).toHaveLength(6)
      expect(manifest.bootstraps).toContainEqual({
        platform: 'win32',
        arch: 'x64',
        asset: 'openalice-bootstrap-1.2.3-win32-x64.exe',
        url: 'https://download.openalice.ai/openalice-bootstrap-1.2.3-win32-x64.exe',
        sha256: createHash('sha256').update(nativeBootstrapFixture('win32', 'x64')).digest('hex'),
      })
      expect(JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')).bootstraps)
        .toEqual(manifest.bootstraps)
    })
  })

  it('requires native bootstraps for a new release publication', () => {
    withTempDir((dir) => {
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
        requireNativeBootstraps: true,
      })).toThrow('native bootstrap set is required')
    })
  })

  it('rejects unexpected native bootstrap sidecars', () => {
    withTempDir((dir) => {
      writeFileSync(join(dir, 'openalice-bootstrap-stale.sha256'), 'stale')
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('unexpected native bootstrap assets')
    })
  })

  it('rejects native bootstrap entries that are not regular files', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = join(dir, 'openalice-bootstrap-1.2.3-linux-x64')
      rmSync(asset)
      mkdirSync(asset)
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('must be regular files')
    })
  })

  it('rejects a checksum-valid bootstrap built for the wrong architecture', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-linux-arm64'
      const bytes = nativeBootstrapFixture('linux', 'x64')
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('architecture mismatch')
    })
  })
  it('rejects a checksum-valid bootstrap whose entry point is not executable', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-linux-x64'
      const bytes = nativeBootstrapFixture('linux', 'x64')
      bytes.writeBigUInt64LE(0xdeadbeefn, 24)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('entry point is not in an executable load segment')
    })
  })

  it('rejects a PE entry point outside the declared image', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-win32-x64.exe'
      const bytes = nativeBootstrapFixture('win32', 'x64')
      bytes.writeUInt32LE(1, 0x80 + 24 + 56)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('not an executable PE32+ image')
    })
  })

  it('rejects an ELF segment whose file bytes exceed its memory extent', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-linux-x64'
      const bytes = nativeBootstrapFixture('linux', 'x64')
      bytes.writeBigUInt64LE(1n, 104)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('file size exceeds memory size')
    })
  })

  it('rejects a Mach-O segment with missing section records', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-darwin-x64'
      const bytes = nativeBootstrapFixture('darwin', 'x64')
      bytes.writeUInt32LE(1, 96)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('segment section table is invalid')
    })
  })
  it('rejects a PE section outside the declared image', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-win32-x64.exe'
      const bytes = nativeBootstrapFixture('win32', 'x64')
      bytes.writeUInt32LE(0x1001, 0x188 + 8)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('section exceeds the declared image')
    })
  })

  it('rejects a PE data directory outside the declared image', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-win32-x64.exe'
      const bytes = nativeBootstrapFixture('win32', 'x64')
      bytes.writeUInt32LE(0x3000, 0x108)
      bytes.writeUInt32LE(0x100, 0x10c)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('data directory exceeds the declared image')
    })
  })
  it('rejects PE raw section bytes outside the declared image', () => {
    withTempDir((dir) => {
      writeNativeBootstrapMatrix(dir)
      const asset = 'openalice-bootstrap-1.2.3-win32-x64.exe'
      const bytes = Buffer.alloc(0x2000)
      nativeBootstrapFixture('win32', 'x64').copy(bytes)
      bytes.writeUInt32LE(0x1001, 0x188 + 16)
      bytes.writeUInt32LE(0, 0x188 + 20)
      writeFileSync(join(dir, asset), bytes)
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update(bytes).digest('hex')}  ${asset}\n`,
      )
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('section exceeds the declared image')
    })
  })
  it('rejects an incomplete native bootstrap publication', () => {
    withTempDir((dir) => {
      const asset = 'openalice-bootstrap-1.2.3-linux-x64'
      writeFileSync(join(dir, asset), 'bootstrap')
      writeFileSync(
        join(dir, `${asset}.sha256`),
        `${createHash('sha256').update('bootstrap').digest('hex')}  ${asset}\n`,
      )

      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('incomplete native bootstrap set')
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
