import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'

// Config and sealing paths bind at import time; never touch the user's real home.
const isolatedHome = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const previous = process.env['OPENALICE_HOME']
  const previousGlobal = process.env['OPENALICE_GLOBAL_DIR']
  const directory = mkdtempSync(join(tmpdir(), 'oa-news-config-home-'))
  process.env['OPENALICE_HOME'] = directory
  process.env['OPENALICE_GLOBAL_DIR'] = directory
  return { directory, previous, previousGlobal }
})

import { createConfigRoutes } from './config.js'
import { createNewsRoutes } from './news.js'
import { createAuthMiddleware } from '../middleware/auth.js'
import { loadConfig, writeConfigSection } from '../../core/config.js'
import { newsCollectorSchema } from '../../domain/news/config.js'
import { NewsCollector } from '../../domain/news/collector/rss.js'
import { NewsCollectorStore } from '../../domain/news/store.js'
import { NewsModuleManager } from '../../domain/news/modules/manager.js'
import { RssHubSecretStore } from '../../domain/news/modules/secrets.js'
import type { EngineContext } from '../../core/types.js'

let directory: string
let collector: NewsCollector
let context: EngineContext
let routes: Hono

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oa-news-config-routes-'))
  await writeConfigSection('news', newsCollectorSchema.parse({ feeds: [], rsshubBaseUrl: 'https://rsshub.example' }))
  const config = await loadConfig()
  collector = new NewsCollector({
    store: new NewsCollectorStore({ logPath: join(directory, 'news.jsonl') }),
    manager: new NewsModuleManager({ directory: join(directory, 'modules') }),
    secrets: new RssHubSecretStore(join(directory, 'secrets')),
    feeds: [], intervalMs: 600_000, enabled: true, rsshubBaseUrl: 'https://rsshub.example',
  })
  context = { config, newsCollector: collector } as EngineContext
  routes = new Hono()
  routes.route('/api/config', createConfigRoutes({ ctx: context }))
  routes.route('/api/news', createNewsRoutes(context))
})

afterEach(async () => {
  await collector.close()
  await rm(directory, { recursive: true, force: true })
})

afterAll(async () => {
  if (isolatedHome.previous === undefined) delete process.env['OPENALICE_HOME']
  else process.env['OPENALICE_HOME'] = isolatedHome.previous
  if (isolatedHome.previousGlobal === undefined) delete process.env['OPENALICE_GLOBAL_DIR']
  else process.env['OPENALICE_GLOBAL_DIR'] = isolatedHome.previousGlobal
  await rm(isolatedHome.directory, { recursive: true, force: true })
})

function json(method: string, body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function artifact(entry: string) {
  return {
    manifest: {
      abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', name: 'Test feed',
      description: '', entry: 'entry.mjs', sources: [{ key: 'headlines', name: 'Headlines', parameters: [] }],
    },
    files: { 'entry.mjs': entry },
  }
}

const subscription = {
  id: 'test-headlines', moduleId: 'test.feed', sourceKey: 'headlines',
  name: 'Test headlines', source: 'test-provider', enabled: true, params: {}, categories: [],
}

describe('news module configuration HTTP route', () => {
  it('rejects unapproved execution, then persists approved selection and reports the loaded hash', async () => {
    const marker = join(directory, 'executed')
    const entry = `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(marker)}, 'yes'); export const newsModule = { abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', async collect() { return [] } }`
    const imported = await routes.request('/api/news/modules', json('POST', { artifact: artifact(entry) }))
    expect(imported.status).toBe(200)
    const { contentHash } = await imported.json() as { contentHash: string }
    const next = {
      ...context.config.news, enabled: true, feeds: [], rsshubBaseUrl: 'https://rsshub.example',
      modules: [{ moduleId: 'test.feed', contentHash, enabled: true }], subscriptions: [subscription],
    }

    const denied = await routes.request('/api/config/news', json('PUT', next))
    expect(denied.status).toBe(400)
    await expect(readFile(marker)).rejects.toMatchObject({ code: 'ENOENT' })
    expect((await loadConfig()).news.modules).toEqual([])

    const approved = await routes.request(`/api/news/modules/${contentHash}/approve`, { method: 'POST' })
    expect(approved.status).toBe(200)
    const saved = await routes.request('/api/config/news', json('PUT', next))
    expect(saved.status).toBe(200)
    expect((await loadConfig()).news).toMatchObject({ modules: next.modules, subscriptions: next.subscriptions })
    expect(context.config.news).toMatchObject({ modules: next.modules, subscriptions: next.subscriptions })
    expect(await readFile(marker, 'utf8')).toBe('yes')
    expect(await (await routes.request('/api/news/modules')).json()).toMatchObject({
      modules: [expect.objectContaining({ contentHash, desiredEnabled: true, approved: true, loaded: true, loadedHash: contentHash, state: 'running' })],
    })
    expect(collector.getStatus()).toEqual([expect.objectContaining({ id: subscription.id, moduleId: 'test.feed' })])

    const retried = await routes.request(`/api/news/modules/${contentHash}/retry`, { method: 'POST' })
    expect(retried.status).toBe(200)
    expect(await retried.json()).toMatchObject({ modules: [expect.objectContaining({ loadedHash: contentHash })] })
  }, 30_000)

  it('retains the approved old selection and reports its failed restoration after a rejected replacement', async () => {
    const oldEntry = `export const newsModule = { abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', async collect() { return [] } }`
    const oldImport = await routes.request('/api/news/modules', json('POST', { artifact: artifact(oldEntry) }))
    expect(oldImport.status).toBe(200)
    const { contentHash: oldHash } = await oldImport.json() as { contentHash: string }
    expect((await routes.request(`/api/news/modules/${oldHash}/approve`, { method: 'POST' })).status).toBe(200)
    const previous = {
      ...context.config.news, enabled: true, feeds: [],
      modules: [{ moduleId: 'test.feed', contentHash: oldHash, enabled: true }], subscriptions: [],
    }
    expect((await routes.request('/api/config/news', json('PUT', previous))).status).toBe(200)
    const before = await (await routes.request('/api/news/modules')).json() as { modules: Array<{ contentHash: string; loaded: boolean }> }
    expect(before.modules.find(module => module.contentHash === oldHash)?.loaded).toBe(true)

    const replacement = await routes.request('/api/news/modules', json('POST', {
      artifact: artifact("throw new Error('candidate import failed'); export const newsModule = { abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', async collect() { return [] } }"),
    }))
    expect(replacement.status).toBe(200)
    const { contentHash: candidateHash } = await replacement.json() as { contentHash: string }
    expect(candidateHash).not.toBe(oldHash)
    expect((await routes.request(`/api/news/modules/${candidateHash}/approve`, { method: 'POST' })).status).toBe(200)
    const configPath = join(isolatedHome.directory, 'data', 'config', 'news.json')
    const archivedConfig = await readFile(configPath, 'utf8')
    expect(archivedConfig).not.toContain(candidateHash)
    await rm(join(directory, 'modules', oldHash, 'entry.mjs'))

    const refused = await routes.request('/api/config/news', json('PUT', {
      ...previous, modules: [{ moduleId: 'test.feed', contentHash: candidateHash, enabled: true }],
    }))
    expect(await readFile(configPath, 'utf8')).toBe(archivedConfig)
    expect((await loadConfig()).news).toMatchObject({ modules: previous.modules, subscriptions: [] })
    expect(context.config.news).toMatchObject({ modules: previous.modules, subscriptions: [] })
    const { modules } = await (await routes.request('/api/news/modules')).json() as { modules: Array<{ contentHash: string; lastError: string | null }> }
    expect(modules.find(module => module.contentHash === candidateHash)).toMatchObject({ desiredEnabled: false, loaded: false, state: 'failed' })
    const oldStatus = modules.find(module => module.contentHash === oldHash)
    expect(oldStatus).toMatchObject({ approved: true, desiredEnabled: true, loaded: false, loadedHash: null, state: 'failed' })
    expect(oldStatus?.lastError).toEqual(expect.any(String))
    expect(refused.ok).toBe(false)
  }, 45_000)

  it('preserves an enabled module preference while globally disabled and loads it again when re-enabled', async () => {
    const entry = `export const newsModule = { abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', async collect() { return [] } }`
    const imported = await routes.request('/api/news/modules', json('POST', { artifact: artifact(entry) }))
    expect(imported.status).toBe(200)
    const { contentHash } = await imported.json() as { contentHash: string }
    expect((await routes.request(`/api/news/modules/${contentHash}/approve`, { method: 'POST' })).status).toBe(200)
    const enabled = {
      ...context.config.news, feeds: [], enabled: true,
      modules: [{ moduleId: 'test.feed', contentHash, enabled: true }], subscriptions: [],
    }
    expect((await routes.request('/api/config/news', json('PUT', enabled))).status).toBe(200)
    expect((await routes.request('/api/config/news', json('PUT', { ...enabled, enabled: false }))).status).toBe(200)
    expect((await loadConfig()).news).toMatchObject({ enabled: false, modules: enabled.modules })
    const disabled = await routes.request('/api/news/modules')
    expect(disabled.status).toBe(200)
    expect(await disabled.json()).toMatchObject({ modules: [expect.objectContaining({
      contentHash, approved: true, desiredEnabled: true, loaded: false, loadedHash: null, state: 'disabled', lastError: null,
    })] })

    expect((await routes.request('/api/config/news', json('PUT', enabled))).status).toBe(200)
    expect((await loadConfig()).news).toMatchObject({ enabled: true, modules: enabled.modules })
    const resumed = await routes.request('/api/news/modules')
    expect(resumed.status).toBe(200)
    expect(await resumed.json()).toMatchObject({ modules: [expect.objectContaining({
      contentHash, desiredEnabled: true, loaded: true, loadedHash: contentHash, state: 'running', lastError: null,
    })] })
  }, 30_000)

  it('requires both module arrays on news saves rather than silently resetting them', async () => {
    for (const missing of ['modules', 'subscriptions'] as const) {
      const invalid = await routes.request('/api/config/news', json('PUT', { ...context.config.news, [missing]: undefined }))
      expect(invalid.status).toBe(400)
    }
    expect((await loadConfig()).news).toMatchObject({ modules: [], subscriptions: [] })
  })

  it('refuses a news configuration save without its collector before persisting it', async () => {
    const noCollector = createConfigRoutes({ ctx: { ...context, newsCollector: undefined } })
    const response = await noCollector.request('/news', json('PUT', { ...context.config.news, modules: [], subscriptions: [] }))
    expect(response.status).toBe(409)
    expect((await loadConfig()).news).toMatchObject({ modules: [], subscriptions: [] })
  })

  it('does not leak the rejected module ABI diagnostic or persist an unstartable selection', async () => {
    const imported = await routes.request('/api/news/modules', json('POST', {
      artifact: artifact(`throw new Error('ABI_SECRET_DO_NOT_LEAK'); export const newsModule = { abiVersion: 2, moduleId: 'test.feed', version: '1.0.0', async collect() { return [] } }`),
    }))
    const { contentHash } = await imported.json() as { contentHash: string }
    await routes.request(`/api/news/modules/${contentHash}/approve`, { method: 'POST' })
    const response = await routes.request('/api/config/news', json('PUT', {
      ...context.config.news, feeds: [], modules: [{ moduleId: 'test.feed', contentHash, enabled: true }], subscriptions: [],
    }))
    expect(response.status).toBe(400)
    expect(await response.text()).not.toContain('ABI_SECRET_DO_NOT_LEAK')
    expect(JSON.stringify(await (await routes.request('/api/news/modules')).json())).not.toContain('ABI_SECRET_DO_NOT_LEAK')
    expect((await loadConfig()).news.modules).toEqual([])
  })

  it('keeps RSSHub key out of ordinary configuration saves and reads', async () => {
    const key = 'rsshub-key-do-not-return'
    const status = await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'set', key }))
    expect(status.status).toBe(200)
    const saved = await routes.request('/api/config/news', json('PUT', {
      ...context.config.news, feeds: [], modules: [], subscriptions: [],
    }))
    expect(saved.status).toBe(200)
    expect(await saved.text()).not.toContain(key)
    expect(await (await routes.request('/api/config')).text()).not.toContain(key)
    expect(await readFile(join(isolatedHome.directory, 'data', 'config', 'news.json'), 'utf8')).not.toContain(key)
    expect(await (await routes.request('/api/news/rsshub-key')).json()).toEqual({ configured: true, available: true, baseUrl: 'https://rsshub.example' })
  })

  it('keeps config save and module actions below the existing authentication gate', async () => {
    const protectedApp = new Hono()
    protectedApp.use('/api/*', createAuthMiddleware({ trustedProxies: ['192.0.2.10'], csrfTrustedOrigins: [] }))
    protectedApp.route('/api/config', createConfigRoutes({ ctx: context }))
    protectedApp.route('/api/news', createNewsRoutes(context))
    const remote = { incoming: { socket: { remoteAddress: '203.0.113.8' } } }
    expect((await protectedApp.request('/api/config/news', json('PUT', { ...context.config.news, modules: [], subscriptions: [] }), remote)).status).toBe(401)
    expect((await protectedApp.request('/api/news/modules/invalid/retry', { method: 'POST' }, remote)).status).toBe(401)
    expect((await protectedApp.request('/api/news/modules/invalid', { method: 'DELETE' }, remote)).status).toBe(401)
    expect((await protectedApp.request('/api/news/rsshub-key', undefined, remote)).status).toBe(401)
  })
})
