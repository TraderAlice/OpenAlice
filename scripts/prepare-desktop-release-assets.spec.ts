import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import YAML from 'yaml'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

import { checkPublicationHead, previousReleaseTag, prepareBuildMetadata, prepareMirrorAssets } from './prepare-desktop-release-assets.mjs'

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

  it('rejects prerelease channels other than beta', () => {
    withTempDir((dir) => {
      expect(() => prepareMirrorAssets({
        outDir: dir,
        tag: 'v1.2.3-rc.1',
        baseUrl: 'https://download.openalice.ai',
        repository: 'TraderAlice/OpenAlice',
      })).toThrow('unsupported release version: 1.2.3-rc.1')
    })
  })
})

describe('channel publication uses shared release policy', () => {
  const bytes = (channel: string, version: string) => Buffer.from(JSON.stringify({ channel, version }))
  it.each([
    ['stable', '0.94.1', '0.94.2'],
    ['beta', '0.94.1-beta.2', '0.94.1-beta.10'],
  ])('accepts forward %s publication %s to %s', (channel, current, version) => {
    const headBytes = bytes(channel, current)
    expect(checkPublicationHead({ headBytes, channel, version, operation: 'release' }))
      .toBe(createHash('sha256').update(headBytes).digest('hex'))
  })
  it.each([
    ['stable', '0.94.1', '0.94.1'], ['stable', '0.94.2', '0.94.1'],
    ['stable', '0.94.1', '0.94.1-beta.2'], ['beta', '0.94.1-beta.10', '0.94.1-beta.2'],
    ['beta', '0.94.1-beta.2', '0.94.1-beta.01'], ['beta', '0.94.1-beta.2', '0.94.1-beta.0'],
    ['stable', '0.94.1', '00.94.2'],
  ])('rejects ordinary %s publication %s to %s', (channel, current, version) => {
    expect(() => checkPublicationHead({ headBytes: bytes(channel, current), channel, version, operation: 'release' })).toThrow()
  })
  it('permits exact active-head repair and refuses a different head even if it remains older', () => {
    const headBytes = bytes('stable', '0.94.1')
    const common = { headBytes, channel: 'stable', version: '0.94.1', operation: 'mirror' }
    const expectedSha256 = checkPublicationHead(common)
    expect(checkPublicationHead({ ...common, expectedSha256 })).toBe(expectedSha256)
    expect(() => checkPublicationHead({ ...common, version: '0.94.2' })).toThrow('active channel')
    expect(() => checkPublicationHead({ ...common, headBytes: bytes('stable', '0.94.2') })).toThrow('active channel')
    expect(() => checkPublicationHead({ ...common, expectedSha256, operation: 'release', version: '0.94.3', headBytes: bytes('stable', '0.94.2') })).toThrow('head changed')
  })
  it('rejects missing or contradictory head identity', () => {
    for (const headBytes of [Buffer.from('{}'), bytes('beta', '0.94.1-beta.2'), bytes('stable', '0.94.1-beta.2')]) {
      expect(() => checkPublicationHead({ headBytes, channel: 'stable', version: '0.94.2', operation: 'release' })).toThrow('invalid release identity')
    }
  })
  it('selects release-note predecessors with the same ordering and channel grammar', () => {
    const tags = ['v0.94.1-beta.2', 'v0.94.1-beta.10', 'v0.94.1', 'v0.94.0', 'v00.95.0', 'v0.94.1-beta.01']
    expect(previousReleaseTag(tags, 'beta')).toBe('v0.94.1-beta.10')
    expect(previousReleaseTag(tags, 'stable')).toBe('v0.94.1')
  })
})

it.skipIf(process.platform === 'win32').each([
  ['release', '0.94.2', '0.94.1', true],
  ['release', '0.94.3', '0.94.2', false],
  ['mirror', '0.94.1', '0.94.1', true],
  ['mirror', '0.94.1', '0.94.2', false],
])('executes the publication shell with %s %s and object-store head %s', (operation, version, storeVersion, accepted) => {
  withTempDir((temporary) => {
    const dir = realpathSync(temporary)
    const repo = resolve(import.meta.dirname, '..')
    const workflow = YAML.parse(readFileSync(join(repo, '.github/workflows/release.yml'), 'utf8'))
    const script = workflow.jobs['mirror-release-assets'].steps.find((s: { name?: string }) => s.name === 'Mirror release assets to Cloudflare R2').run
    for (const path of ['bin', 'scripts', 'packages/update-lifecycle/src', 'dist/r2-upload']) mkdirSync(join(dir, path), { recursive: true })
    for (const path of ['scripts/prepare-desktop-release-assets.mjs', 'packages/update-lifecycle/src/release-policy.ts']) copyFileSync(join(repo, path), join(dir, path))
    const intent = JSON.stringify({ channel: 'stable', version: '0.94.1' })
    writeFileSync(join(dir, 'store.json'), JSON.stringify({ channel: 'stable', version: storeVersion }))
    writeFileSync(join(dir, 'bin/aws'), String.raw`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FIXTURE_LOG, JSON.stringify(args) + '\n');
if (args[0] === 's3' && args[1] === 'cp' && args[2] === 's3://fixture/manifest.json') fs.copyFileSync(process.env.FIXTURE_HEAD, args[3]);
`)
    chmodSync(join(dir, 'bin/aws'), 0o755)
    const result = spawnSync('bash', ['-c', script], { cwd: dir, encoding: 'utf8', env: {
      PATH: `${join(dir, 'bin')}:${process.env.PATH}`, RUNNER_TEMP: dir,
      R2_BUCKET: 'fixture', R2_ACCOUNT_ID: 'fixture', RELEASE_CHANNEL: 'stable',
      RELEASE_OPERATION: operation, VERSION: version,
      EXPECTED_HEAD_SHA256: createHash('sha256').update(intent).digest('hex'),
      FIXTURE_LOG: join(dir, 'calls.jsonl'), FIXTURE_HEAD: join(dir, 'store.json'),
    } })
    expect(result.status, result.stderr).toBe(accepted ? 0 : 1)
    const calls = readFileSync(join(dir, 'calls.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line) as string[])
    const mutableWrites = calls.filter(args => args.includes('no-cache'))
    if (accepted) expect(mutableWrites.some(args => args.includes('s3://fixture/manifest.json'))).toBe(true)
    else {
      expect(result.stderr).toContain('Channel head changed')
      expect(mutableWrites).toEqual([])
    }
  })
})
