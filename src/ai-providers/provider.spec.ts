import { createHash } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { createAIProvider, DeepSeekProvider } from './provider.js'
import { ProviderModelCatalogStore } from './model-catalog.js'
import type { Credential } from '../core/config.js'

afterEach(() => vi.unstubAllGlobals())
const key: Credential = { vendor: 'deepseek', authType: 'api-key', apiKey: 'fixture-key', wires: { 'openai-chat': 'https://example.test/v1' } }

it('binds an immutable account without changing its persisted shape or revealing secrets', async () => {
  const credential = structuredClone(key)
  const before = structuredClone(credential)
  const provider = createAIProvider('deepseek-1', credential)
  expect(provider).toBeInstanceOf(DeepSeekProvider)
  expect(credential).toEqual(before)
  credential.apiKey = 'replacement'
  credential.wires!['openai-chat'] = 'https://replacement.test/v1'
  const wires = provider.wires
  wires['openai-chat'] = 'https://mutation.test/v1'
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'private' }] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await provider.discoverModels!()).toEqual([{ id: 'private', label: 'private' }])
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://example.test/v1/models')
  expect(fetcher.mock.calls[0]![1].headers.Authorization).toBe('Bearer fixture-key')
  expect(JSON.stringify(provider)).not.toContain('fixture-key')
  expect(provider.models.length).toBeGreaterThan(0)
  expect(provider.defaultModel).toBeTruthy()
})

it('chooses a provider directory independently of runtime wire preference', async () => {
  const provider = createAIProvider('minimax', { ...key, vendor: 'minimax', wires: {
    anthropic: 'https://example.test/anthropic', 'openai-chat': 'https://example.test/v1',
  } })
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [] }))
  vi.stubGlobal('fetch', fetcher)
  await provider.discoverModels!()
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://example.test/v1/models')
})

it.each(['glm', 'cursor'] as const)('serves %s defaults with no discovery, even on explicit refresh', async (vendor) => {
  const fetcher = vi.fn()
  vi.stubGlobal('fetch', fetcher)
  const provider = createAIProvider('static', { ...key, vendor })
  expect(provider.discoverModels).toBeUndefined()
  const result = await new ProviderModelCatalogStore().read(provider, true)
  expect(result).toMatchObject({ discoverySupported: false, source: 'bundled', error: null, refreshing: false, fetchedAt: null })
  expect(result.models.length).toBeGreaterThan(0)
  expect(fetcher).not.toHaveBeenCalled()
})

it('does not turn a native subscription or missing key into an API account', () => {
  expect(createAIProvider('native', { ...key, authType: 'subscription' }).discoverModels).toBeUndefined()
  expect(createAIProvider('missing', { ...key, apiKey: undefined }).discoverModels).toBeUndefined()
})

it('preserves legacy single-wire cache identity and honors its configured endpoint', () => {
  const provider = createAIProvider('old', { vendor: 'deepseek', authType: 'api-key', apiKey: 'fixture-key', wireShape: 'openai-chat', baseUrl: 'https://example.test/v1' })
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  expect(provider.catalogSlot).toBe(digest(['old', 'openai-chat']))
  expect(provider.catalogIdentity).toBe(digest(['deepseek', 'openai-chat', 'https://example.test/v1', 'fixture-key']))
  expect(provider.wires).toEqual(key.wires)
})

it('keeps OpenRouter directory capabilities when only its Anthropic wire is configured', async () => {
  const account = createAIProvider('router', { ...key, vendor: 'openrouter', wires: { anthropic: 'https://openrouter.ai/api' } })
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'private', context_length: 1234, supported_parameters: ['reasoning'] }] })))
  expect(await account.discoverModels!()).toEqual([{ id: 'private', label: 'private', semantics: { contextWindow: 1234, reasoning: { supported: true } } }])
})
