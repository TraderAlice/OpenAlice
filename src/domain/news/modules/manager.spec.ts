import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NewsModuleManager } from './manager.js'
import type { NewsModuleArtifact, NewsSubscription } from './contract.js'

const launch = { command: process.env.OPENALICE_NEWS_TEST_NODE ?? process.execPath, args: ['--conditions=openalice-source', '--import', import.meta.resolve('tsx'), fileURLToPath(new URL('./worker-entry.ts', import.meta.url))] }
const item = { externalId: 'one', title: 'Test article', content: 'Content', url: 'https://example.test/article', publishedAt: '2026-01-01T00:00:00Z' }
const row: NewsSubscription = { id: 'one', moduleId: 'test.news', sourceKey: 'latest', name: 'News', source: 'test', enabled: true, params: {}, categories: [] }
const code = (body = 'return [' + JSON.stringify(item) + ']') =>
  'export const newsModule = { abiVersion: 1, moduleId: "test.news", version: "1", async collect(input) { ' + body + ' } }'
const artifact = (entry = code()): NewsModuleArtifact => ({
  manifest: { abiVersion: 1, moduleId: 'test.news', version: '1', name: 'Test news', description: '', entry: 'entry.mjs', sources: [{ key: 'latest', name: 'Latest', parameters: [] }] },
  files: { 'entry.mjs': entry },
})
let home: string
let directory: string
let manager: NewsModuleManager

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'openalice-news-manager-'))
  directory = join(home, 'modules')
  manager = new NewsModuleManager({ directory, launch })
})
afterEach(async () => {
  try { await manager.close() }
  finally { await rm(home, { recursive: true, force: true }) }
})

describe('news module manager with real child processes', () => {
  it('never imports code for install/list/unapproved enable, then collects only after exact approval', async () => {
    const marker = join(home, 'imported.txt')
    const installed = await manager.importArtifact(artifact(
      'import { writeFileSync } from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ', "loaded"); ' + code(),
    ))
    const selection = { moduleId: 'test.news', contentHash: installed.contentHash, enabled: true }
    expect(installed.approved).toBe(false)
    expect(await manager.list()).toMatchObject([{ state: 'unapproved', loaded: false, approved: false }])
    await expect(manager.configure([selection], [row])).rejects.toThrow(/approve/i)
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    await manager.approve(installed.contentHash)
    await manager.configure([selection], [row])
    expect(await readFile(marker, 'utf8')).toBe('loaded')
    expect(await manager.collect(row)).toEqual([item])
    expect(await manager.list()).toMatchObject([{ state: 'running', loadedHash: installed.contentHash }])
  }, 35_000)

  it('rejects changed artifact or manifest bytes before ever importing approved code', async () => {
    const marker = join(home, 'unexpected.txt')
    const installed = await manager.importArtifact(artifact(
      'import { writeFileSync } from "node:fs"; writeFileSync(' + JSON.stringify(marker) + ', "loaded"); ' + code(),
    ))
    await manager.approve(installed.contentHash)
    const selection = { moduleId: 'test.news', contentHash: installed.contentHash, enabled: true }
    for (const file of ['artifact.json', 'manifest.json', 'entry.mjs']) {
      const path = join(directory, installed.contentHash, file)
      const original = await readFile(path, 'utf8')
      await chmod(path, 0o600)
      await writeFile(path, file === 'entry.mjs' ? original + ' ' : original.replace('Test news', 'Altered news'))
      await expect(manager.configure([selection], [row])).rejects.toThrow()
      await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
      await writeFile(path, original)
    }
  }, 30_000)

  it('checks declared string, number and boolean parameter types before enabling', async () => {
    const a = artifact(code('return [{ ...' + JSON.stringify(item) + ', title: String(input.params.slug) + "/" + input.params.limit + "/" + input.params.featured }]'))
    a.manifest.sources[0]!.parameters = [
      { key: 'slug', label: 'Slug', type: 'string', required: true },
      { key: 'limit', label: 'Limit', type: 'number', required: true },
      { key: 'featured', label: 'Featured', type: 'boolean', required: true },
    ]
    const installed = await manager.importArtifact(a)
    await manager.approve(installed.contentHash)
    const selection = { moduleId: 'test.news', contentHash: installed.contentHash, enabled: true }
    for (const params of [{ limit: 3, featured: true }, { slug: 4, limit: 3, featured: true }, { slug: 'x', limit: '3', featured: true }, { slug: 'x', limit: 3, featured: 'true' }, { slug: 'x', limit: 3, featured: true, extra: 'bad' }]) {
      await expect(manager.validate([selection], [{ ...row, params } as NewsSubscription])).rejects.toThrow()
    }
    const typed = { ...row, params: { slug: 'markets', limit: 3, featured: false } }
    await manager.configure([selection], [typed])
    expect(await manager.collect(typed)).toEqual([{ ...item, title: 'markets/3/false' }])
  }, 35_000)

  it('persists a worker crash across manager restarts until explicit retry', async () => {
    const marker = join(home, 'crashed-once.txt')
    const source = 'import { existsSync, writeFileSync } from "node:fs"; ' + code(
      'if (!existsSync(' + JSON.stringify(marker) + ')) { writeFileSync(' + JSON.stringify(marker) + ', "yes"); process.exit(19) } return [' + JSON.stringify(item) + ']',
    )
    const installed = await manager.importArtifact(artifact(source))
    await manager.approve(installed.contentHash)
    const selection = { moduleId: 'test.news', contentHash: installed.contentHash, enabled: true }
    await manager.configure([selection], [row])
    await expect(manager.collect(row)).rejects.toThrow(/retry/i)
    expect(await manager.list()).toMatchObject([{ state: 'failed', loaded: false }])
    await manager.close()
    manager = new NewsModuleManager({ directory, launch })
    await manager.configure([selection], [row])
    expect(await manager.list()).toMatchObject([{ state: 'failed', loaded: false }])
    await expect(manager.collect(row)).rejects.toThrow(/retry/i)
    await manager.retry(installed.contentHash)
    expect(await manager.collect(row)).toEqual([item])
    expect(await manager.list()).toMatchObject([{ state: 'running', loaded: true }])
  }, 45_000)

  it('persists a timed-out worker until explicit retry without hanging the manager', async () => {
    const marker = join(home, 'hung-once.txt')
    const source = 'import { existsSync, writeFileSync } from "node:fs"; ' + code(
      'if (!existsSync(' + JSON.stringify(marker) + ')) { writeFileSync(' + JSON.stringify(marker) + ', "yes"); return Promise.withResolvers().promise } return [' + JSON.stringify(item) + ']',
    )
    const installed = await manager.importArtifact(artifact(source))
    await manager.approve(installed.contentHash)
    const selection = { moduleId: 'test.news', contentHash: installed.contentHash, enabled: true }
    await manager.configure([selection], [row])
    await expect(manager.collect(row)).rejects.toThrow(/retry/i)
    expect(await manager.list()).toMatchObject([{ state: 'failed', loaded: false }])
    await manager.close()
    manager = new NewsModuleManager({ directory, launch })
    await manager.configure([selection], [row])
    expect(await manager.list()).toMatchObject([{ state: 'failed', loaded: false }])
    await manager.retry(installed.contentHash)
    expect(await manager.collect(row)).toEqual([item])
  }, 45_000)

  it('stops the old process before importing the newly approved version', async () => {
    const oldPortFile = join(home, 'old.port')
    const old = await manager.importArtifact(artifact(
      'import { createServer } from "node:net"; import { writeFileSync } from "node:fs"; ' +
      'const listener = createServer(); const gate = Promise.withResolvers(); listener.once("error", gate.reject); listener.listen(0, "127.0.0.1", gate.resolve); await gate.promise; ' +
      'writeFileSync(' + JSON.stringify(oldPortFile) + ', String(listener.address().port)); ' + code(),
    ))
    const next = await manager.importArtifact(artifact(
      'import { createServer } from "node:net"; import { readFileSync } from "node:fs"; ' +
      'const port = Number(readFileSync(' + JSON.stringify(oldPortFile) + ', "utf8")); ' +
      'const probe = createServer(); const gate = Promise.withResolvers(); probe.once("error", gate.reject); probe.listen(port, "127.0.0.1", gate.resolve); await gate.promise; probe.close(); ' + code(),
    ))
    await manager.approve(old.contentHash)
    await manager.approve(next.contentHash)
    await manager.configure([{ moduleId: 'test.news', contentHash: old.contentHash, enabled: true }], [row])
    expect(Number(await readFile(oldPortFile, 'utf8'))).toBeGreaterThan(0)
    await manager.configure([{ moduleId: 'test.news', contentHash: next.contentHash, enabled: true }], [row])
    expect(await manager.collect(row)).toEqual([item])
    expect(await manager.list()).toEqual(expect.arrayContaining([expect.objectContaining({ contentHash: next.contentHash, state: 'running' })]))
  }, 45_000)
})
