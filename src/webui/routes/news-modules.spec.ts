import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Hono } from 'hono'

// Hoist isolation because sealing.key is resolved when the route dependencies import.
const isolatedHome = await vi.hoisted(async () => {
  const { mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const previous = process.env['OPENALICE_HOME']
  const previousGlobal = process.env['OPENALICE_GLOBAL_DIR']
  const directory = mkdtempSync(join(tmpdir(), 'oa-news-http-home-'))
  process.env['OPENALICE_HOME'] = directory
  process.env['OPENALICE_GLOBAL_DIR'] = directory
  return { directory, previous, previousGlobal }
})

import { createNewsRoutes } from './news.js'
import { createAuthMiddleware } from '../middleware/auth.js'
import { NewsCollector } from '../../domain/news/collector/rss.js'
import { NewsCollectorStore } from '../../domain/news/store.js'
import { NewsModuleManager } from '../../domain/news/modules/manager.js'
import { RssHubSecretStore } from '../../domain/news/modules/secrets.js'
import { NEWS_MODULE_LIMITS } from '../../domain/news/modules/contract.js'
import type { EngineContext } from '../../core/types.js'

let directory: string
let collector: NewsCollector

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'oa-news-routes-'))
  collector = new NewsCollector({
    store: new NewsCollectorStore({ logPath: join(directory, 'news.jsonl') }),
    manager: new NewsModuleManager({ directory: join(directory, 'modules') }),
    secrets: new RssHubSecretStore(join(directory, 'secrets')),
    feeds: [], intervalMs: 600_000, enabled: true, rsshubBaseUrl: 'https://rsshub.example',
  })
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

function app(withCollector = true, authenticated = false) {
  const route = new Hono()
  if (authenticated) route.use('/api/*', createAuthMiddleware({ trustedProxies: ['192.0.2.10'], csrfTrustedOrigins: [] }))
  route.route('/api/news', createNewsRoutes({ ...(withCollector ? { newsCollector: collector } : {}) } as EngineContext))
  return route
}

function json(method: string, body: unknown) {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }
}

function artifact() {
  return {
    manifest: {
      abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', name: 'Test feed',
      description: '', entry: 'entry.mjs', sources: [{ key: 'headlines', name: 'Headlines', parameters: [] }],
    },
    files: {
      'entry.mjs': `import { writeFileSync } from 'node:fs'; writeFileSync(` + JSON.stringify(join(directory, 'executed')) + `, 'executed'); export const newsModule = { abiVersion: 1, moduleId: 'test.feed', version: '1.0.0', async collect() { return [] } }`,
    },
  }
}

describe('news module management HTTP routes', () => {
  it('installs and approves an artifact without executing unselected code, then uninstalls it', async () => {
    const routes = app()
    const installed = await routes.request('/api/news/modules', json('POST', { artifact: artifact() }))
    expect(installed.status).toBe(200)
    const module = await installed.json() as { contentHash: string; approved: boolean }
    expect(module).toMatchObject({ contentHash: expect.stringMatching(/^[a-f0-9]{64}$/), approved: false })
    await expect(readFile(join(directory, 'executed'))).rejects.toMatchObject({ code: 'ENOENT' })

    const listed = await routes.request('/api/news/modules')
    expect(listed.status).toBe(200)
    expect(await listed.json()).toMatchObject({ modules: [expect.objectContaining({ contentHash: module.contentHash, state: 'unapproved', loaded: false, loadedHash: null })] })

    const approved = await routes.request(`/api/news/modules/${module.contentHash}/approve`, { method: 'POST' })
    expect(approved.status).toBe(200)
    expect(await approved.json()).toMatchObject({ contentHash: module.contentHash, approved: true })
    await expect(readFile(join(directory, 'executed'))).rejects.toMatchObject({ code: 'ENOENT' })

    const removed = await routes.request(`/api/news/modules/${module.contentHash}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect(await removed.json()).toEqual({ ok: true })
    expect(await (await routes.request('/api/news/modules')).json()).toEqual({ modules: [] })
  })

  it('rejects malformed artifact, hash and secret operations without changing modules', async () => {
    const routes = app()
    expect((await routes.request('/api/news/modules', json('POST', { artifact: { manifest: { abiVersion: 99 } } }))).status).toBe(400)
    expect((await routes.request('/api/news/modules/not-a-hash/approve', { method: 'POST' })).status).toBe(400)
    expect((await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'set', key: '' }))).status).toBe(400)
    expect((await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'rotate', key: 'key' }))).status).toBe(400)
    expect(await (await routes.request('/api/news/modules')).json()).toEqual({ modules: [] })
  })

  it('rejects an oversized declared import body before parsing or installing it', async () => {
    const routes = app()
    const response = await routes.request('/api/news/modules', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(NEWS_MODULE_LIMITS.artifact * 6 + 1024 * 1024 + 1) },
      body: JSON.stringify({ artifact: artifact() }),
    })
    expect(response.status).toBe(413)
    expect(await response.json()).toEqual({ error: 'Module import request too large' })
    expect(await collector.getModules()).toEqual([])
  })

  it('enforces the module import byte limit when Content-Length understates a streaming body', async () => {
    const routes = app()
    const requestLimit = NEWS_MODULE_LIMITS.artifact * 6 + 1024 * 1024
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(requestLimit + 1)) },
      cancel() { cancelled = true },
    })
    const request = new Request('http://localhost/api/news/modules', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '1' },
      body: stream,
      duplex: 'half',
    } as RequestInit)
    const response = await routes.fetch(request)
    expect(response.status).toBe(413)
    expect(cancelled).toBe(true)
    expect(await collector.getModules()).toEqual([])
  })

  it('returns 409 when collector is missing instead of reporting a successful no-op', async () => {
    const routes = app(false)
    expect((await routes.request('/api/news/modules')).status).toBe(409)
    expect((await routes.request('/api/news/modules', json('POST', { artifact: artifact() }))).status).toBe(409)
    expect((await routes.request('/api/news/rsshub-key')).status).toBe(409)
    expect((await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'clear' }))).status).toBe(409)
  })

  it('stores the RSSHub key but returns only status, and clear removes it', async () => {
    const routes = app()
    const key = 'rsshub-secret-DO-NOT-RETURN'
    const saved = await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'set', key }))
    expect(saved.status).toBe(200)
    expect(await saved.json()).toEqual({ configured: true, available: true, baseUrl: 'https://rsshub.example' })
    const status = await routes.request('/api/news/rsshub-key')
    expect(await status.json()).toEqual({ configured: true, available: true, baseUrl: 'https://rsshub.example' })
    expect(JSON.stringify(await (await routes.request('/api/news/modules')).json())).not.toContain(key)
    expect((await readFile(join(directory, 'secrets', 'rsshub-key.json'), 'utf8'))).not.toContain(key)
    const cleared = await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'clear' }))
    expect(await cleared.json()).toEqual({ configured: false, available: true, baseUrl: null })
  })

  it('does not let unauthenticated remote requests manage modules or credentials', async () => {
    const routes = app(true, true)
    const remote = { incoming: { socket: { remoteAddress: '203.0.113.8' } } }
    expect((await routes.request('/api/news/modules', undefined, remote)).status).toBe(401)
    expect((await routes.request('/api/news/modules', json('POST', { artifact: artifact() }), remote)).status).toBe(401)
    expect((await routes.request('/api/news/rsshub-key', json('PUT', { operation: 'set', key: 'secret' }), remote)).status).toBe(401)
    await expect(readFile(join(directory, 'executed'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await collector.getModules()).toEqual([])
  })
})
