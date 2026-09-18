import { afterEach, describe, expect, it, vi } from 'vitest'

import { configApi } from './config'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('configApi.discoverModels', () => {
  it('preserves the request shape and accepts valid model results', async () => {
    const input = {
      wireShape: 'openai-chat',
      credentialSlug: 'openai-main',
      baseUrl: 'https://api.openai.com/v1',
      apiKey: 'secret',
    }
    const response = {
      status: 'success' as const,
      models: ['m'.repeat(128)],
    }
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(configApi.discoverModels(input)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith('/api/config/credentials/models', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
  })

  it('accepts unsupported responses without a models payload', async () => {
    const response = { status: 'unsupported' as const }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))

    await expect(configApi.discoverModels({ wireShape: 'anthropic-messages' })).resolves.toEqual(response)
  })

  it('accepts valid failure responses with boolean retryable', async () => {
    const response = { status: 'failure' as const, retryable: false }
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))

    await expect(configApi.discoverModels({ wireShape: 'openai-chat' })).resolves.toEqual(response)
  })

  it.each([
    ['a non-string model', { status: 'success', models: [42] }],
    ['an overlong model', { status: 'success', models: ['m'.repeat(129)] }],
    ['a control character in a model', { status: 'success', models: ['good\u0000model'] }],
    ['an empty model', { status: 'success', models: [''] }],
    ['a whitespace-only model', { status: 'success', models: ['   '] }],
    ['a failure without retryable', { status: 'failure' }],
    ['a failure with a non-boolean retryable', { status: 'failure', retryable: 'true' }],
  ])('rejects %s with the API error', async (_description, response) => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(response), { status: 200 })))

    await expect(configApi.discoverModels({ wireShape: 'openai-chat' }))
      .rejects.toThrow('Failed to discover models')
  })
})
