import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { HarnessManifestError, readHarnessManifest } from './harness-manifest.js'

const dirs: string[] = []

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function workspace(manifest: unknown): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'openalice-harness-manifest-'))
  dirs.push(dir)
  await writeFile(join(dir, 'harness.json'), JSON.stringify(manifest))
  return dir
}

describe('readHarnessManifest', () => {
  it('accepts distinct AP-style managed ports', async () => {
    const dir = await workspace({
      manifestVersion: 1,
      version: '0.1.0',
      capabilities: {
        studio: {
          command: ['pnpm', 'studio'],
          ports: ['http', 'controlPlane'],
          entryPort: 'http',
          readinessPath: '/health',
        },
      },
    })
    await expect(readHarnessManifest(dir)).resolves.toMatchObject({
      version: '0.1.0',
      capabilities: { studio: { entryPort: 'http' } },
    })
  })

  it.each([
    ['unsupported version', { manifestVersion: 2, version: '1', capabilities: {} }],
    ['shell command', { manifestVersion: 1, version: '1', capabilities: { studio: { command: 'pnpm studio', ports: ['http'], entryPort: 'http', readinessPath: '/health' } } }],
    ['undeclared entry', { manifestVersion: 1, version: '1', capabilities: { studio: { command: ['pnpm'], ports: ['http'], entryPort: 'other', readinessPath: '/health' } } }],
    ['duplicate ports', { manifestVersion: 1, version: '1', capabilities: { studio: { command: ['pnpm'], ports: ['http', 'http'], entryPort: 'http', readinessPath: '/health' } } }],
  ])('rejects %s', async (_label, manifest) => {
    const dir = await workspace(manifest)
    await expect(readHarnessManifest(dir)).rejects.toBeInstanceOf(HarnessManifestError)
  })
})
