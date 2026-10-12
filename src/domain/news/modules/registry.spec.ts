import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NewsModuleRegistry } from './registry.js'
import type { NewsModuleArtifact } from './contract.js'

let home: string
let registry: NewsModuleRegistry
const artifact = (code = 'export const newsModule = { abiVersion: 1, moduleId: "test.news", version: "1", collect: async () => [] }'): NewsModuleArtifact => ({
  manifest: { abiVersion: 1, moduleId: 'test.news', version: '1', name: 'Test news', description: '', entry: 'entry.mjs', sources: [{ key: 'latest', name: 'Latest', parameters: [] }] },
  files: { 'entry.mjs': code },
})

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'openalice-news-registry-'))
  registry = new NewsModuleRegistry(join(home, 'modules'))
})
afterEach(async () => { await rm(home, { recursive: true, force: true }) })

describe('news module artifact registry', () => {
  it('imports as unapproved data without evaluating the entry, then approves only its exact hash', async () => {
    const marker = join(home, 'imported.txt')
    const first = await registry.importArtifact(artifact(
      'import { writeFileSync } from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ', "executed")',
    ))
    expect(first.approved).toBe(false)
    expect(await registry.list()).toMatchObject([{ contentHash: first.contentHash, approved: false }])
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await registry.approve(first.contentHash)).approved).toBe(true)
    expect((await registry.list())[0]?.approved).toBe(true)
    await expect(readFile(marker, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })

    const changed = await registry.importArtifact(artifact('export const newsModule = { abiVersion: 1, moduleId: "test.news", version: "2" }'))
    expect(changed.contentHash).not.toBe(first.contentHash)
    expect(changed.approved).toBe(false)
  })

  it.each(['artifact.json', 'manifest.json', 'entry.mjs'])('refuses a post-approval change to %s', async file => {
    const installed = await registry.importArtifact(artifact())
    await registry.approve(installed.contentHash)
    const path = join(registry.directory, installed.contentHash, file)
    const original = await readFile(path, 'utf8')
    await chmod(path, 0o600)
    await writeFile(path, file === 'entry.mjs' ? original + ' ' : original.replace('Test news', 'Altered news'))
    await expect(registry.read(installed.contentHash)).rejects.toThrow()
  })

  it('rejects an artifact path escaping its installation directory before writing it', async () => {
    const invalid = artifact()
    invalid.files['../escape.mjs'] = 'export default 1'
    await expect(registry.importArtifact(invalid)).rejects.toThrow()
    await expect(readFile(join(home, 'escape.mjs'))).rejects.toMatchObject({ code: 'ENOENT' })
  })
})
