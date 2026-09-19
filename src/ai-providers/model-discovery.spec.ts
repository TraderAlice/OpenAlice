import { afterEach, expect, it, vi } from 'vitest'
import { discoverModels } from './model-discovery.js'

afterEach(() => vi.unstubAllGlobals())

it('reads exact OpenAI-compatible IDs without generation or returning credentials', async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [{ id: 'private/model-1' }, { id: 'private/model-1' }] }))
  vi.stubGlobal('fetch', fetcher)
  expect(await discoverModels({ wireShape: 'openai-responses', baseUrl: 'https://gateway.test/v1/', apiKey: 'secret' }))
    .toEqual([{ id: 'private/model-1', label: 'private/model-1' }])
  expect(String(fetcher.mock.calls[0]![0])).toBe('https://gateway.test/v1/models')
  expect(fetcher.mock.calls[0]![1]).toMatchObject({ headers: { Authorization: 'Bearer secret' }, redirect: 'error' })
})

it('paginates Anthropic models and accepts a base URL already ending in v1', async () => {
  const urls: string[] = []
  const fetcher = vi.fn(async (url: URL) => {
    urls.push(String(url))
    return Response.json(url.searchParams.has('after_id')
      ? { data: [{ id: 'second', display_name: 'Second' }], has_more: false }
      : { data: [{ id: 'first' }], has_more: true, last_id: 'first' })
  })
  vi.stubGlobal('fetch', fetcher)
  expect(await discoverModels({ wireShape: 'anthropic', baseUrl: 'https://anthropic.test/v1/', apiKey: 'key' }))
    .toEqual([{ id: 'first', label: 'first' }, { id: 'second', label: 'Second' }])
  expect(urls).toEqual(['https://anthropic.test/v1/models?limit=1000', 'https://anthropic.test/v1/models?limit=1000&after_id=first'])
})

it('paginates Google and excludes models without text generation', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => Response.json(url.searchParams.has('pageToken')
    ? { models: [{ name: 'models/gemini-test', displayName: 'Gemini', supportedGenerationMethods: ['generateContent'] }] }
    : { models: [{ name: 'models/embed', supportedGenerationMethods: ['embedContent'] }], nextPageToken: 'next' })))
  expect(await discoverModels({ wireShape: 'google-generative-ai', apiKey: 'key' })).toEqual([{ id: 'gemini-test', label: 'Gemini' }])
})

it('rejects malformed, repeated-page and failed responses without exposing provider error bodies', async () => {
  const fetcher = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: 'secret-key' }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ surprise: [] }))
    .mockImplementation(() => Promise.resolve(Response.json({ data: [], has_more: true, last_id: 'same' })))
  vi.stubGlobal('fetch', fetcher)
  const input = { wireShape: 'anthropic' as const, apiKey: 'key' }
  await expect(discoverModels(input)).rejects.toThrow('Model API returned HTTP 401')
  await expect(discoverModels(input)).rejects.toThrow('invalid model list')
  await expect(discoverModels(input)).rejects.toThrow('repeated a page cursor')
  await expect(discoverModels({ ...input, baseUrl: 'file:///private' })).rejects.toThrow('Invalid model API endpoint')
})
