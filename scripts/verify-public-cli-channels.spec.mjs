import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { parseArgs, verifyPublicCliChannels } from './verify-public-cli-channels.mjs'

const roots = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('public CLI channel verification', () => {
  it('verifies every public archive and sidecar against the accepted manifest', async () => {
    const fixture = createFixture()
    const receipt = await verifyPublicCliChannels({
      manifestPath: fixture.manifestPath,
      version: fixture.version,
      fetchImpl: fixture.fetchImpl,
    })
    expect(receipt.status).toBe('pass')
    expect(receipt.targets).toHaveLength(4)
    expect(receipt.targets.every((target) => target.public)).toBe(true)
  })

  it('rejects a public archive whose bytes differ from the accepted checksum', async () => {
    const fixture = createFixture()
    await expect(verifyPublicCliChannels({
      manifestPath: fixture.manifestPath,
      version: fixture.version,
      fetchImpl: async (url, init) => {
        if (String(url).includes('linux-x64.tar.gz') && !String(url).endsWith('.sha256')) {
          return new Response('tampered')
        }
        return fixture.fetchImpl(url, init)
      },
    })).rejects.toThrow('public openalice-cli-0.91.0-linux-x64.tar.gz checksum')
  })

  it('rejects a non-release asset base and malformed CLI arguments', async () => {
    const fixture = createFixture({ assetBaseUrl: 'https://example.test/assets' })
    await expect(verifyPublicCliChannels({
      manifestPath: fixture.manifestPath,
      version: fixture.version,
      fetchImpl: fixture.fetchImpl,
    })).rejects.toThrow('asset base')
    expect(() => parseArgs(['--manifest', 'manifest.json', '--version', 'latest'])).toThrow('Usage:')
  })
})

function createFixture(overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'openalice-public-channel-'))
  roots.push(root)
  const version = '0.91.0'
  const repository = 'TraderAlice/OpenAlice'
  const assetBaseUrl = overrides.assetBaseUrl
    ?? `https://github.com/${repository}/releases/download/v${version}`
  const bytes = new Map()
  const targets = [
    ['darwin', 'arm64'],
    ['darwin', 'x64'],
    ['linux', 'arm64'],
    ['linux', 'x64'],
  ].map(([platform, arch], index) => {
    const archive = `openalice-cli-${version}-${platform}-${arch}.tar.gz`
    const body = Buffer.from(`accepted-${platform}-${arch}`)
    const sha256 = createHash('sha256').update(body).digest('hex')
    bytes.set(`${assetBaseUrl}/${archive}`, body)
    bytes.set(`${assetBaseUrl}/${archive}.sha256`, Buffer.from(`${sha256}  ${archive}\n`))
    return { platform, arch, sha256, contentIdentity: String(index).repeat(16) }
  })
  const manifestPath = join(root, 'cli-package-channels.json')
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 1,
    version,
    assetBaseUrl,
    targets,
  }))
  return {
    version,
    manifestPath,
    fetchImpl: async (url) => {
      const body = bytes.get(String(url))
      return body ? new Response(body) : new Response('not found', { status: 404 })
    },
  }
}
