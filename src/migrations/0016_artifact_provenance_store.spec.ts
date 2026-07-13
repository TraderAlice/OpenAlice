import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { ensureArtifactProvenanceStore } from './0016_artifact_provenance_store/index.js'

const dirs: string[] = []
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('0016_artifact_provenance_store', () => {
  it('creates an empty v1 store once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migration-provenance-'))
    dirs.push(root)
    await expect(ensureArtifactProvenanceStore(root)).resolves.toEqual({ created: true })
    await expect(ensureArtifactProvenanceStore(root)).resolves.toEqual({ created: false })
    expect(JSON.parse(await readFile(join(root, 'state', 'artifact-provenance.json'), 'utf8')))
      .toEqual({ version: 1, records: [] })
  })

  it('does not overwrite an unexpected existing file', async () => {
    const root = await mkdtemp(join(tmpdir(), 'migration-provenance-corrupt-'))
    dirs.push(root)
    const path = join(root, 'state', 'artifact-provenance.json')
    await mkdir(join(root, 'state'), { recursive: true })
    await writeFile(path, '{"unexpected":true}\n')
    await expect(ensureArtifactProvenanceStore(root)).resolves.toEqual({ created: false })
    expect(await readFile(path, 'utf8')).toBe('{"unexpected":true}\n')
  })
})
