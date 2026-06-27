/**
 * config routes — GET/PUT /workspace-credential-defaults (the per-agent
 * "inject my usual key on every new workspace" setting).
 *
 * Mocks core/config.js read/write with an in-memory store so we don't touch the
 * real data/ dir; the real `compatibleCredentials` wire funnel is exercised so
 * the GET's per-agent options reflect actual wire compatibility.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import type { Credential, WorkspaceCredentialDefault } from '../../core/config.js'

let credStore: Record<string, Credential> = {}
let defaultsStore: Record<string, WorkspaceCredentialDefault> = {}

vi.mock('../../core/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/config.js')>('../../core/config.js')
  return {
    ...actual,
    readCredentials: vi.fn(async () => ({ ...credStore })),
    readWorkspaceCredentialDefaults: vi.fn(async () => ({ ...defaultsStore })),
    writeWorkspaceCredentialDefaults: vi.fn(async (next: Record<string, WorkspaceCredentialDefault>) => {
      // Mirror the real writer: drop empty slugs.
      const cleaned: Record<string, WorkspaceCredentialDefault> = {}
      for (const [k, v] of Object.entries(next)) if (v.credentialSlug) cleaned[k] = v
      defaultsStore = cleaned
    }),
  }
})

import { createConfigRoutes } from './config.js'

async function req(routes: ReturnType<typeof createConfigRoutes>, method: 'GET' | 'PUT', path: string, body?: unknown) {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.headers = { 'Content-Type': 'application/json' }
    init.body = JSON.stringify(body)
  }
  const res = await routes.request(path, init)
  const json = await res.json().catch(() => null)
  return { status: res.status, body: json as Record<string, unknown> | null }
}

beforeEach(() => {
  credStore = {
    'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-ant', wires: { anthropic: '' } },
    'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-responses': '', 'openai-chat': '' } },
    'chat-1': { vendor: 'custom', authType: 'api-key', apiKey: 'k', wires: { 'openai-chat': 'https://gw/v1' } },
  }
  defaultsStore = {}
})

describe('GET /workspace-credential-defaults', () => {
  it('returns current defaults + per-agent compatible slugs (wire funnel)', async () => {
    const routes = createConfigRoutes()
    defaultsStore = { opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' } }

    const { status, body } = await req(routes, 'GET', '/workspace-credential-defaults')
    expect(status).toBe(200)
    expect(body!.defaults).toEqual({ opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' } })

    const compat = body!.compatibleByAgent as Record<string, string[]>
    // claude speaks anthropic only.
    expect(compat.claude).toEqual(['anthropic-1'])
    // codex is Responses-only → only the openai key qualifies (chat-only excluded).
    expect(compat.codex).toEqual(['openai-1'])
    // opencode/pi speak chat|anthropic|responses → every key qualifies.
    expect(new Set(compat.opencode)).toEqual(new Set(['anthropic-1', 'openai-1', 'chat-1']))
    expect(new Set(compat.pi)).toEqual(new Set(['anthropic-1', 'openai-1', 'chat-1']))
  })
})

describe('PUT /workspace-credential-defaults', () => {
  it('replaces the map, keeps optional model, persists via the writer', async () => {
    const routes = createConfigRoutes()
    const { status, body } = await req(routes, 'PUT', '/workspace-credential-defaults', {
      defaults: {
        opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' },
        pi: { credentialSlug: 'anthropic-1' },
      },
    })
    expect(status).toBe(200)
    expect(body!.defaults).toEqual({
      opencode: { credentialSlug: 'openai-1', model: 'gpt-5.5' },
      pi: { credentialSlug: 'anthropic-1' },
    })
    expect(defaultsStore).toEqual(body!.defaults)
  })

  it('drops an agent whose credentialSlug is empty ("don\'t seed")', async () => {
    const routes = createConfigRoutes()
    const { body } = await req(routes, 'PUT', '/workspace-credential-defaults', {
      defaults: { opencode: { credentialSlug: 'openai-1' }, pi: { credentialSlug: '' } },
    })
    expect(body!.defaults).toEqual({ opencode: { credentialSlug: 'openai-1' } })
  })

  it('ignores unknown agent keys (only the four defaultable agents pass through)', async () => {
    const routes = createConfigRoutes()
    const { body } = await req(routes, 'PUT', '/workspace-credential-defaults', {
      defaults: { shell: { credentialSlug: 'openai-1' }, bogus: { credentialSlug: 'x' } },
    })
    expect(body!.defaults).toEqual({})
  })

  it('clears all defaults on an empty body', async () => {
    const routes = createConfigRoutes()
    defaultsStore = { opencode: { credentialSlug: 'openai-1' } }
    const { body } = await req(routes, 'PUT', '/workspace-credential-defaults', { defaults: {} })
    expect(body!.defaults).toEqual({})
    expect(defaultsStore).toEqual({})
  })
})
