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
let defaultAgentStore: string | null = null
let issueDefaultAgentStore: string | null = null

const { probeByWireShapeMock } = vi.hoisted(() => ({
  probeByWireShapeMock: vi.fn(async () => ({ text: 'real probe' })),
}))

vi.mock('../../core/config.js', async () => {
  const actual = await vi.importActual<typeof import('../../core/config.js')>('../../core/config.js')
  return {
    ...actual,
    readCredentials: vi.fn(async () => ({ ...credStore })),
    readWorkspaceCredentialDefaults: vi.fn(async () => ({ ...defaultsStore })),
    readWorkspaceDefaultAgent: vi.fn(async () => defaultAgentStore),
    readIssueDefaultAgent: vi.fn(async () => issueDefaultAgentStore),
    writeWorkspaceCredentialDefaults: vi.fn(async (next: Record<string, WorkspaceCredentialDefault>) => {
      // Mirror the real writer: drop empty slugs.
      const cleaned: Record<string, WorkspaceCredentialDefault> = {}
      for (const [k, v] of Object.entries(next)) if (v.credentialSlug) cleaned[k] = v
      defaultsStore = cleaned
    }),
    writeWorkspaceDefaultAgent: vi.fn(async (agent: string | null) => {
      defaultAgentStore = agent
    }),
    writeIssueDefaultAgent: vi.fn(async (agent: string | null) => {
      issueDefaultAgentStore = agent
    }),
    addCredential: vi.fn(async (credential: Credential) => {
      const slug = `${credential.vendor}-${Object.keys(credStore).length + 1}`
      credStore[slug] = credential
      return slug
    }),
    resolveCredential: vi.fn(async (slug: string) => {
      const cred = credStore[slug]
      if (!cred) throw new Error(`Unknown credential: "${slug}"`)
      return cred
    }),
    writeCredential: vi.fn(async (slug: string, credential: Credential) => {
      credStore[slug] = credential
    }),
  }
})

vi.mock('../../workspaces/agent-probe.js', () => ({
  probeByWireShape: probeByWireShapeMock,
}))

import { createConfigRoutes } from './config.js'

async function req(routes: ReturnType<typeof createConfigRoutes>, method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown) {
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
  delete process.env.OPENALICE_ONBOARDING_TEST
  delete process.env.OPENALICE_CREDENTIAL_TEST_MODE
  probeByWireShapeMock.mockClear()
  probeByWireShapeMock.mockResolvedValue({ text: 'real probe' })
  credStore = {
    'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-ant', wires: { anthropic: '' } },
    'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-responses': '', 'openai-chat': '' } },
    'chat-1': { vendor: 'custom', authType: 'api-key', apiKey: 'k', wires: { 'openai-chat': 'https://gw/v1' } },
  }
  defaultsStore = {}
  defaultAgentStore = null
  issueDefaultAgentStore = null
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

describe('POST /credentials', () => {
  it('stores lastModel so custom provider injection has a default model', async () => {
    const routes = createConfigRoutes()

    const { status, body } = await req(routes, 'POST', '/credentials', {
      vendor: 'custom',
      label: 'Gateway',
      apiKey: 'sk-gw',
      wires: { 'openai-chat': 'https://gw/v1' },
      lastModel: 'longmao-chat',
    })

    expect(status).toBe(201)
    const slug = body!.slug
    expect(typeof slug).toBe('string')
    expect(credStore[slug as string]).toMatchObject({ lastModel: 'longmao-chat' })
  })
})

describe('POST /credentials/test', () => {
  const mockBody = {
    wireShape: 'openai-chat',
    baseUrl: 'https://onboarding.openalice.test/openai-chat',
    apiKey: 'oa_test_ok',
    model: 'openalice-onboarding-test',
  }

  it('uses the onboarding mock provider only when the test env enables it', async () => {
    process.env.OPENALICE_ONBOARDING_TEST = '1'
    process.env.OPENALICE_CREDENTIAL_TEST_MODE = 'mock'
    const routes = createConfigRoutes()

    const { body } = await req(routes, 'POST', '/credentials/test', mockBody)

    expect(body).toEqual({ ok: true, response: 'OpenAlice onboarding mock credential is ready.' })
    expect(probeByWireShapeMock).not.toHaveBeenCalled()
  })

  it('rejects the onboarding mock provider with the wrong test key', async () => {
    process.env.OPENALICE_ONBOARDING_TEST = '1'
    process.env.OPENALICE_CREDENTIAL_TEST_MODE = 'mock'
    const routes = createConfigRoutes()

    const { body } = await req(routes, 'POST', '/credentials/test', { ...mockBody, apiKey: 'wrong' })

    expect(body).toEqual({ ok: false, error: 'Use the onboarding test key "oa_test_ok".' })
    expect(probeByWireShapeMock).not.toHaveBeenCalled()
  })

  it('falls back to the real probe outside onboarding mock mode', async () => {
    const routes = createConfigRoutes()

    const { body } = await req(routes, 'POST', '/credentials/test', mockBody)

    expect(body).toEqual({ ok: true, response: 'real probe' })
    expect(probeByWireShapeMock).toHaveBeenCalledOnce()
  })
})

describe('GET/PUT /workspace-default-agent', () => {
  it('round-trips a valid agent runtime default', async () => {
    const routes = createConfigRoutes()
    const put = await req(routes, 'PUT', '/workspace-default-agent', { agent: 'codex' })
    expect(put.status).toBe(200)
    expect(put.body).toEqual({ agent: 'codex' })
    expect(defaultAgentStore).toBe('codex')

    const get = await req(routes, 'GET', '/workspace-default-agent')
    expect(get.body).toEqual({ agent: 'codex' })
  })

  it('does not persist shell or unknown ids as a default workload', async () => {
    const routes = createConfigRoutes()
    defaultAgentStore = 'codex'

    const shell = await req(routes, 'PUT', '/workspace-default-agent', { agent: 'shell' })
    expect(shell.body).toEqual({ agent: null })
    expect(defaultAgentStore).toBeNull()

    const unknown = await req(routes, 'PUT', '/workspace-default-agent', { agent: 'bogus' })
    expect(unknown.body).toEqual({ agent: null })
    expect(defaultAgentStore).toBeNull()
  })
})

describe('GET/PUT /issue-default-agent', () => {
  it('round-trips a valid issue runtime default', async () => {
    const routes = createConfigRoutes()
    const put = await req(routes, 'PUT', '/issue-default-agent', { agent: 'pi' })
    expect(put.status).toBe(200)
    expect(put.body).toEqual({ agent: 'pi' })
    expect(issueDefaultAgentStore).toBe('pi')

    const get = await req(routes, 'GET', '/issue-default-agent')
    expect(get.body).toEqual({ agent: 'pi' })
  })

  it('does not persist shell or unknown ids as an issue default', async () => {
    const routes = createConfigRoutes()
    issueDefaultAgentStore = 'pi'

    const shell = await req(routes, 'PUT', '/issue-default-agent', { agent: 'shell' })
    expect(shell.body).toEqual({ agent: null })
    expect(issueDefaultAgentStore).toBeNull()

    const unknown = await req(routes, 'PUT', '/issue-default-agent', { agent: 'bogus' })
    expect(unknown.body).toEqual({ agent: null })
    expect(issueDefaultAgentStore).toBeNull()
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
