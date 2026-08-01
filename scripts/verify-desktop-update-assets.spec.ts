import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  updateMetadataName,
  verifyDesktopUpdateAssets,
} from './verify-desktop-update-assets.mjs'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function fixture(platform: string, arch: string) {
  const outDir = mkdtempSync(join(tmpdir(), 'openalice-update-assets-'))
  roots.push(outDir)
  const version = '1.2.3-beta'
  const file = platform === 'Windows'
    ? `OpenAlice.Setup.${version}.exe`
    : arch === 'arm64'
      ? `OpenAlice-${version}-arm64-mac.zip`
      : `OpenAlice-${version}-mac.zip`
  const bytes = Buffer.from(`candidate ${platform}-${arch}`)
  writeFileSync(join(outDir, file), bytes)
  writeFileSync(join(outDir, `${file}.blockmap`), 'blockmap')
  const sha512 = createHash('sha512').update(bytes).digest('base64')
  const metadata = [
    `version: ${version}`,
    'files:',
    `  - url: ${file}`,
    `    sha512: ${sha512}`,
    `    size: ${bytes.length}`,
    `path: ${file}`,
    `sha512: ${sha512}`,
  ].join('\n')
  writeFileSync(join(outDir, updateMetadataName({ platform, arch, version })), `${metadata}\n`)
  return { outDir, version, file }
}

describe('desktop update asset verification', () => {
  it.each([
    ['macOS', 'arm64', 'beta-mac.yml'],
    ['macOS', 'x64', 'beta-mac-intel.yml'],
    ['Windows', 'x64', 'beta.yml'],
  ])('verifies %s %s metadata and bytes', (platform, arch, metadataName) => {
    const input = fixture(platform, arch)
    expect(updateMetadataName({ platform, arch, version: input.version })).toBe(metadataName)
    expect(verifyDesktopUpdateAssets({ ...input, platform, arch })).toMatchObject({
      ok: true,
      errors: [],
      files: [input.file],
    })
  })

  it('rejects a mismatched digest, size, and missing blockmap', () => {
    const input = fixture('macOS', 'arm64')
    writeFileSync(join(input.outDir, input.file), 'changed candidate bytes')
    rmSync(join(input.outDir, `${input.file}.blockmap`))

    const result = verifyDesktopUpdateAssets({ ...input, platform: 'macOS', arch: 'arm64' })
    expect(result.ok).toBe(false)
    expect(result.errors).toEqual(expect.arrayContaining([
      expect.stringContaining('size'),
      expect.stringContaining('SHA-512 mismatch'),
      expect.stringContaining('missing or empty blockmap'),
    ]))
  })

  it('rejects traversal in a metadata asset URL', () => {
    const input = fixture('Windows', 'x64')
    const metadataName = updateMetadataName({ platform: 'Windows', arch: 'x64', version: input.version })
    writeFileSync(join(input.outDir, metadataName), [
      `version: ${input.version}`,
      'files:',
      '  - url: ../outside.exe',
      '    sha512: invalid',
      '    size: 1',
      'path: ../outside.exe',
    ].join('\n'))

    const result = verifyDesktopUpdateAssets({ ...input, platform: 'Windows', arch: 'x64' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('[desktop-update-assets] unsafe asset path "../outside.exe"')
  })

  it('rejects malformed URL encoding without crashing verification', () => {
    const input = fixture('Windows', 'x64')
    const metadataName = updateMetadataName({ platform: 'Windows', arch: 'x64', version: input.version })
    writeFileSync(join(input.outDir, metadataName), [
      `version: ${input.version}`,
      'files:',
      '  - url: OpenAlice%ZZ.exe',
      '    sha512: invalid',
      '    size: 1',
      'path: OpenAlice%ZZ.exe',
    ].join('\n'))

    const result = verifyDesktopUpdateAssets({ ...input, platform: 'Windows', arch: 'x64' })
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('[desktop-update-assets] unsafe asset path "OpenAlice%ZZ.exe"')
  })
})
