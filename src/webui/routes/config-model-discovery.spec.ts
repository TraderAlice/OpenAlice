import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Credential } from '../../core/config.js'

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}))

let credentials: Record<string, Credential>

vi.stubGlobal('fetch', fetchMock)

vi.mock('../../core/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/config.js')>('../../core/config.js')
  return {
    ...actual,
    resolveCredential: vi.fn(async (slug: string) => {
      const credential = credentials[slug]
      if (!credential) throw new Error('unknown credential')
      return credential
    }),
    readCredentials: vi.fn(async () => ({ ...credentials })),
  }
})

import { createConfigRoutes } from './config.js'

async function request(
  routes: ReturnType<typeof createConfigRoutes>,
  body: unknown,
) {
  const response = await routes.request('/credentials/models', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  }
}

function upstream(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

beforeEach(() => {
  credentials = {
    saved: {
      vendor: 'custom',
      authType: 'api-key',
      apiKey: 'saved-secret',
      wires: { 'openai-chat': 'https://gateway.example/v1/' },
    },
  }
  fetchMock.mockReset()
})

describe('POST /credentials/models', () => {
  it('discovers models for a saved credential without accepting a browser key', async () => {
    fetchMock.mockResolvedValue(upstream({
      data: [{ id: ' gpt-discovered ' }, { id: 'gpt-discovered' }, { id: 'private/chat' }],
    }))
    const result = await request(createConfigRoutes(), {
      wireShape: 'openai-chat',
      credentialSlug: 'saved',
    })

    expect(result.status).toBe(200)
    expect(result.body).toEqual({ status: 'success', models: ['gpt-discovered', 'private/chat'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://gateway.example/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer saved-secret' }),
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    )
    expect(fetchMock.mock.calls[0]?.[0]).not.toContain('saved-secret')
  })

  it('returns unsupported without network I/O for saved credentials without an OpenAI chat wire', async () => {
    credentials.anthropicOnly = {
      vendor: 'anthropic',
      authType: 'api-key',
      apiKey: 'anthropic-secret',
      baseUrl: 'https://api.anthropic.com/v1',
      wireShape: 'anthropic',
    }
    const result = await request(createConfigRoutes(), {
      credentialSlug: 'anthropicOnly',
    })

    expect(result).toEqual({ status: 200, body: { status: 'unsupported' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('discovers models from complete draft fields', async () => {
    fetchMock.mockResolvedValue(upstream({ data: [{ id: 'draft-model' }] }))
    const result = await request(createConfigRoutes(), {
      wireShape: 'openai-chat',
      baseUrl: 'https://draft.example/v1',
      apiKey: 'draft-secret',
    })

    expect(result.body).toEqual({ status: 'success', models: ['draft-model'] })
    expect(fetchMock).toHaveBeenCalledWith(
      'https://draft.example/v1/models',
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer draft-secret' }) }),
    )
  })

  it('returns unsupported without network I/O for non-chat wires', async () => {
    const result = await request(createConfigRoutes(), {
      wireShape: 'openai-responses',
      credentialSlug: 'saved',
    })

    expect(result).toEqual({ status: 200, body: { status: 'unsupported' } })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('distinguishes a successful empty provider response', async () => {
    fetchMock.mockResolvedValue(upstream({ data: [] }))
    const result = await request(createConfigRoutes(), {
      wireShape: 'openai-chat',
      credentialSlug: 'saved',
    })

    expect(result).toEqual({ status: 200, body: { status: 'success', models: [] } })
  })

  it('returns a retryable failure without upstream details', async () => {
    fetchMock.mockResolvedValue(upstream({ error: { message: 'do not expose this' } }, 503))
    const result = await request(createConfigRoutes(), {
      wireShape: 'openai-chat',
      credentialSlug: 'saved',
    })

    expect(result.status).toBe(502)
    expect(result.body).toEqual({ status: 'failure', retryable: true })
    expect(JSON.stringify(result.body)).not.toContain('do not expose this')
  })

  it('sanitizes IDs and enforces count and length bounds', async () => {
    const tooLong = 'x'.repeat(129)
    fetchMock.mockResolvedValue(upstream({
      data: [
        { id: ' valid-model ' },
        { id: 'bad\nmodel' },
        { id: tooLong },
        { id: 42 },
        ...Array.from({ length: 105 }, (_, index) => ({ id: 'bounded-' + index })),
      ],
    }))
    const result = await request(createConfigRoutes(), {
      wireShape: 'openai-chat',
      credentialSlug: 'saved',
    })

    expect(result.body.status).toBe('success')
    const models = result.body.models as string[]
    expect(models).toHaveLength(100)
    expect(models.slice(0, 2)).toEqual(['valid-model', 'bounded-0'])
    expect(models).not.toContain('bad\nmodel')
    expect(models).not.toContain(tooLong)
    expect(models).not.toContain(42 as never)
    expect(models).toContain('bounded-98')
    expect(models).not.toContain('bounded-99')
  })
})
