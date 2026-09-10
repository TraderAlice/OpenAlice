import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  INSTALL_INTEGRITY_FILE,
  describeInstallIntegrityFailure,
  summarizeInstallIntegrity,
  verifyInstallIntegrity,
} from './install-integrity.js'

const roots: string[] = []

async function resourcesFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-install-integrity-'))
  roots.push(root)
  await mkdir(join(root, 'runtime/vendor/pi'), { recursive: true })
  await mkdir(join(root, 'app.asar.unpacked/node_modules/node-pty/build/Release'), { recursive: true })
  const contents: Array<[string, string]> = [
    ['app.asar', 'archive-bytes'],
    ['app.asar.unpacked/node_modules/node-pty/build/Release/pty.node', 'native'],
    ['runtime/package.json', '{"version":"0.92.1"}'],
    ['runtime/vendor/pi/package.json', '{"name":"pi"}'],
  ]
  for (const [file, body] of contents) await writeFile(join(root, file), body)
  await writeFile(join(root, INSTALL_INTEGRITY_FILE), JSON.stringify({
    version: '0.92.1',
    files: contents.map(([file, body]) => [file, Buffer.byteLength(body)]),
  }))
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('packaged install integrity', () => {
  it('verifies every inventoried file by presence and size', async () => {
    const root = await resourcesFixture()
    const result = await verifyInstallIntegrity(root, { concurrency: 2 })
    expect(result).toMatchObject({ status: 'verified', checked: 4 })
    expect(summarizeInstallIntegrity(result)).toMatch(/^verified 4 files in \d+ms$/)
  })

  it('reports missing and truncated files sorted for the reinstall dialog', async () => {
    const root = await resourcesFixture()
    await rm(join(root, 'runtime/vendor/pi/package.json'))
    await writeFile(join(root, 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'), 'nat')
    await writeFile(join(root, 'app.asar'), 'archive-bytes-plus-trailing-garbage')

    const result = await verifyInstallIntegrity(root)
    expect(result).toMatchObject({
      status: 'damaged',
      checked: 4,
      missing: ['runtime/vendor/pi/package.json'],
      mismatched: ['app.asar', 'app.asar.unpacked/node_modules/node-pty/build/Release/pty.node'],
    })
    if (result.status !== 'damaged') throw new Error('expected damaged result')
    expect(summarizeInstallIntegrity(result)).toContain('damaged: 1 missing, 2 truncated of 4 files')
    const message = describeInstallIntegrityFailure(result, {
      version: '0.92.1',
      installRoot: root,
      diagnosticsPath: join(root, 'desktop.log'),
    })
    expect(message).toContain('OpenAlice 0.92.1 is missing part of its installation')
    expect(message).toContain('1 file(s) are missing and 2 are truncated under:')
    expect(message).toContain(root)
    expect(message).toContain('  runtime/vendor/pi/package.json')
    expect(message).toContain('Download the installer again and reinstall OpenAlice.')
    expect(message).toContain(join(root, 'desktop.log'))
  })

  it('treats a missing or malformed inventory as unverifiable', async () => {
    const root = await resourcesFixture()
    await writeFile(join(root, INSTALL_INTEGRITY_FILE), '{"files":"nope"}')
    const malformed = await verifyInstallIntegrity(root)
    expect(malformed).toMatchObject({ status: 'unverifiable' })
    if (malformed.status !== 'unverifiable') throw new Error('expected unverifiable result')
    expect(malformed.reason).toContain(INSTALL_INTEGRITY_FILE)
    expect(describeInstallIntegrityFailure(malformed, { version: '0.92.1', installRoot: root }))
      .toContain('could not verify its installed files')

    await rm(join(root, INSTALL_INTEGRITY_FILE))
    await expect(verifyInstallIntegrity(root)).resolves.toMatchObject({ status: 'unverifiable' })
  })

  it.skipIf(process.platform === 'win32')('checks symlinks by presence only', async () => {
    const root = await resourcesFixture()
    await symlink('../package.json', join(root, 'runtime/vendor/link'))
    await writeFile(join(root, INSTALL_INTEGRITY_FILE), JSON.stringify({
      version: '0.92.1',
      files: [['runtime/vendor/link', null], ['runtime/vendor/missing-link', null]],
    }))
    await expect(verifyInstallIntegrity(root)).resolves.toMatchObject({
      status: 'damaged',
      missing: ['runtime/vendor/missing-link'],
      mismatched: [],
    })
  })
})
