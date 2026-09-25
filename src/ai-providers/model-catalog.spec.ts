import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createAIProvider } from './provider.js'
import { discoverModels } from './model-discovery.js'
import type { CredentialVendor, CredentialWireShape } from '../core/config.js'
vi.mock('./model-discovery.js', () => ({ discoverModels: vi.fn() }))
const provider = (access: { slug: string; vendor: string; input: { wireShape: string; baseUrl?: string; apiKey: string } }) => createAIProvider(access.slug, { vendor: access.vendor as CredentialVendor, authType: 'api-key', apiKey: access.input.apiKey, wires: { [access.input.wireShape as CredentialWireShape]: access.input.baseUrl ?? '' } })
import { MODEL_CATALOG_TTL_MS, ProviderModelCatalogStore, cachedProviderModel } from './model-catalog.js'

const access = { slug: 'test', vendor: 'openai', input: { wireShape: 'openai-chat', baseUrl: 'https://example.test/v1', apiKey: 'test-only-secret' } }
const model = (id: string) => ({ id, label: id })
let directory: string
beforeEach(async () => { vi.mocked(discoverModels).mockReset(); directory = await mkdtemp(join(tmpdir(), 'provider-catalog-')) })
afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

it('serves seeds immediately and shares one refresh across concurrent readers', async () => {
  let finish!: (models: ReturnType<typeof model>[]) => void
  const discover = vi.mocked(discoverModels).mockImplementation(() => new Promise<ReturnType<typeof model>[]>((resolve) => { finish = resolve }))
  const store = new ProviderModelCatalogStore({ directory })
  const views = await Promise.all([store.read(provider(access)), store.read(provider(access)), store.read(provider(access))])
  expect(views.every((view) => view.source === 'bundled' && view.refreshing && view.models.length > 0)).toBe(true)
  expect(discover).toHaveBeenCalledTimes(1)
  finish([model('new-model')])
  const fresh = await store.read(provider(access), true)
  expect(fresh.models).toEqual([model('new-model')])
  expect(fresh.source).toBe('snapshot')
  expect(fresh.refreshing).toBe(false)
  expect(discover).toHaveBeenCalledTimes(1)
})

it('persists across restarts, refreshes at 24 hours, and replaces rather than unions lists', async () => {
  let time = 100
  const discover = vi.mocked(discoverModels).mockResolvedValueOnce([model('old')]).mockResolvedValueOnce([model('new')])
  const options = { directory, now: () => time }
  await new ProviderModelCatalogStore(options).read(provider(access), true)
  const restarted = new ProviderModelCatalogStore(options)
  time += MODEL_CATALOG_TTL_MS - 1
  expect((await restarted.read(provider(access))).models).toEqual([model('old')])
  expect(discover).toHaveBeenCalledTimes(1)
  time++
  const stale = await restarted.read(provider(access))
  expect(stale.models).toEqual([model('old')])
  expect(stale.refreshing).toBe(true)
  expect((await restarted.read(provider(access), true)).models).toEqual([model('new')])
  expect(discover).toHaveBeenCalledTimes(2)
})

it('retains successful data and timestamp on error, without retry storms or error-body leaks', async () => {
  let time = 100
  const discover = vi.mocked(discoverModels).mockResolvedValueOnce([model('old')]).mockRejectedValue(new Error(access.input.apiKey))
  const store = new ProviderModelCatalogStore({ directory, now: () => time })
  const first = await store.read(provider(access), true)
  time += MODEL_CATALOG_TTL_MS
  const failed = await store.read(provider(access), true)
  expect(failed.models).toEqual(first.models)
  expect(failed.fetchedAt).toBe(first.fetchedAt)
  expect(failed.error).toBeTruthy()
  expect(JSON.stringify(failed)).not.toContain(access.input.apiKey)
  await Promise.all([store.read(provider(access)), store.read(provider(access))])
  expect(discover).toHaveBeenCalledTimes(2)
})

it('keeps an empty successful response empty, including after restart', async () => {
  const discover = vi.mocked(discoverModels).mockResolvedValue([])
  const options = { directory }
  expect((await new ProviderModelCatalogStore(options).read(provider(access), true)).models).toEqual([])
  const view = await new ProviderModelCatalogStore(options).read(provider(access))
  expect(view.source).toBe('snapshot')
  expect(view.models).toEqual([])
  expect(discover).toHaveBeenCalledTimes(1)
})

it.each(['key', 'endpoint', 'vendor', 'wire', 'slug'] as const)('does not reuse another %s identity', async (field) => {
  const discover = vi.mocked(discoverModels).mockResolvedValue([model('old-account')])
  const store = new ProviderModelCatalogStore({ directory })
  await store.read(provider(access), true)
  const next = structuredClone(access)
  if (field === 'key') next.input.apiKey = 'different'
  if (field === 'endpoint') next.input.baseUrl = 'https://different.test/v1'
  if (field === 'vendor') next.vendor = 'custom'
  if (field === 'wire') next.input.wireShape = 'anthropic'
  if (field === 'slug') next.slug = 'other'
  const view = await store.read(provider(next))
  expect(view.source).toBe('bundled')
  expect(view.models.some((m) => m.id === 'old-account')).toBe(false)
  await store.read(provider(next), true)
})

it('does not let a late old-account refresh replace a newer result', async () => {
  let oldFinish!: (models: ReturnType<typeof model>[]) => void
  const discover = vi.mocked(discoverModels).mockImplementationOnce(() => new Promise((resolve) => { oldFinish = resolve }))
    .mockResolvedValueOnce([model('new-account')])
  const store = new ProviderModelCatalogStore({ directory })
  await store.read(provider(access))
  const oldCompletion = store.read(provider(access), true)
  const next = { ...access, input: { ...access.input, apiKey: 'different' } }
  await store.read(provider(next), true)
  oldFinish([model('old-account')])
  await oldCompletion
  expect((await new ProviderModelCatalogStore({ directory }).read(provider(next))).models).toEqual([model('new-account')])
})

it('repairs corrupt caches, and stores neither secrets nor raw endpoint URLs', async () => {
  const discover = vi.mocked(discoverModels).mockResolvedValue([model('model')])
  const options = { directory }
  await new ProviderModelCatalogStore(options).read(provider(access), true)
  const files = await readdir(directory)
  expect(files).toHaveLength(1)
  const path = join(directory, files[0]!)
  const data = await readFile(path, 'utf8')
  expect(data).not.toContain(access.input.apiKey)
  expect(data).not.toContain(access.input.baseUrl)
  await writeFile(path, 'broken')
  const store = new ProviderModelCatalogStore(options)
  expect((await store.read(provider(access))).source).toBe('bundled')
  await store.read(provider(access), true)
  expect(JSON.parse(await readFile(path, 'utf8')).models).toEqual([model('model')])
})

it('preserves discovered semantics across restart and shares them with local runtime resolution', async () => {
  const upstream = { id: 'gpt-6-astra', label: 'Live', semantics: { contextWindow: 1234, reasoning: { supported: true, efforts: ['low' as const], interleaved: false } } }
  vi.mocked(discoverModels).mockResolvedValue([upstream])
  const account = provider(access)
  const first = await new ProviderModelCatalogStore({ directory }).read(account, true)
  const restarted = await new ProviderModelCatalogStore({ directory }).read(account)
  expect(restarted.models).toEqual(first.models)
  expect(restarted.models[0]?.semantics).toMatchObject({ contextWindow: 1234, reasoning: { mode: 'required', efforts: ['low'], interleaved: false } })
  expect(cachedProviderModel(account, upstream.id, directory)).toEqual(first.models[0])
  const changedKey = provider({ ...access, input: { ...access.input, apiKey: 'another-key' } })
  expect(cachedProviderModel(changedKey, upstream.id, directory).semantics?.contextWindow).not.toBe(1234)
})
