import { describe, it, expect, vi } from 'vitest'
import { credentialToWorkspaceAiCred, injectWorkspaceCredentials } from './credential-injection.js'
import { AdapterRegistry, type CliAdapter, type WorkspaceAiCred } from './cli-adapter.js'
import type { Credential } from '@/core/config.js'
import type { Logger } from './logger.js'

const anthropicKey: Credential = { vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-ant' }
const minimaxIntl: Credential = {
  vendor: 'minimax',
  authType: 'api-key',
  apiKey: 'mm-key',
  baseUrl: 'https://api.minimax.io/anthropic',
}
const openaiKey: Credential = { vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa' }
const customGateway: Credential = {
  vendor: 'custom',
  authType: 'api-key',
  apiKey: 'k',
  baseUrl: 'https://gw.example.com/v1',
}

describe('credentialToWorkspaceAiCred', () => {
  it('passes through apiKey + baseUrl and takes model from overrides', () => {
    const cred = credentialToWorkspaceAiCred(minimaxIntl, 'claude', { model: 'MiniMax-M3' })
    expect(cred.apiKey).toBe('mm-key')
    expect(cred.baseUrl).toBe('https://api.minimax.io/anthropic')
    expect(cred.model).toBe('MiniMax-M3')
  })

  it('credential carries no model — model is null without an override', () => {
    const cred = credentialToWorkspaceAiCred(anthropicKey, 'claude')
    expect(cred.model).toBeNull()
  })

  describe('claude → authMode', () => {
    it('defaults to x-api-key for first-party Anthropic', () => {
      const cred = credentialToWorkspaceAiCred(anthropicKey, 'claude', { model: 'claude-opus-4-8' })
      expect(cred.authMode).toBe('x-api-key')
    })

    it('auto-promotes api.minimax.io to bearer', () => {
      const cred = credentialToWorkspaceAiCred(minimaxIntl, 'claude', { model: 'MiniMax-M3' })
      expect(cred.authMode).toBe('bearer')
    })

    it('explicit override wins', () => {
      const cred = credentialToWorkspaceAiCred(anthropicKey, 'claude', { authMode: 'bearer' })
      expect(cred.authMode).toBe('bearer')
    })
  })

  describe('codex → wireApi', () => {
    it('left undefined when not overridden (adapter defaults to chat)', () => {
      const cred = credentialToWorkspaceAiCred(customGateway, 'codex', { model: 'gpt-5.5' })
      expect(cred.wireApi).toBeUndefined()
    })

    it('passes an explicit wireApi through', () => {
      const cred = credentialToWorkspaceAiCred(openaiKey, 'codex', { model: 'gpt-5.5', wireApi: 'responses' })
      expect(cred.wireApi).toBe('responses')
    })

    it('never sets authMode for codex', () => {
      const cred = credentialToWorkspaceAiCred(openaiKey, 'codex', { model: 'gpt-5.5' })
      expect(cred.authMode).toBeUndefined()
    })
  })

  describe('opencode / pi → plain chat (no adapter-specific knobs)', () => {
    for (const agent of ['opencode', 'pi']) {
      it(`${agent}: sets neither authMode nor wireApi`, () => {
        const cred = credentialToWorkspaceAiCred(customGateway, agent, { model: 'some-model' })
        expect(cred.authMode).toBeUndefined()
        expect(cred.wireApi).toBeUndefined()
        expect(cred.apiKey).toBe('k')
        expect(cred.baseUrl).toBe('https://gw.example.com/v1')
      })
    }
  })
})

interface WriteCall { id: string; dir: string; cred: WorkspaceAiCred }

function stubAdapter(id: string, calls: WriteCall[], writeable = true): CliAdapter {
  const adapter: CliAdapter = {
    id,
    displayName: id,
    capabilities: { parallelPerCwd: true, resumeLast: false, resumeById: false, transcriptDiscovery: 'none' },
    composeCommand: (base) => base,
  }
  if (writeable) {
    ;(adapter as { writeAiConfig?: CliAdapter['writeAiConfig'] }).writeAiConfig = async (dir, cred) => {
      calls.push({ id, dir, cred })
    }
  }
  return adapter
}

function fakeLogger(): { logger: Logger; warns: string[] } {
  const warns: string[] = []
  const logger = {
    warn: (msg: string) => { warns.push(msg) },
    info: () => {},
    debug: () => {},
    error: () => {},
    child: () => logger,
  } as unknown as Logger
  return { logger, warns }
}

describe('injectWorkspaceCredentials', () => {
  const credentials: Record<string, Credential> = {
    'openai-1': openaiKey,
    'anthropic-1': anthropicKey,
  }

  it('writes AI config for each declared+enabled agent, mapping the credential', async () => {
    const calls: WriteCall[] = []
    const reg = new AdapterRegistry()
    reg.register(stubAdapter('claude', calls))
    reg.register(stubAdapter('codex', calls))
    const { logger } = fakeLogger()

    await injectWorkspaceCredentials({
      dir: '/ws',
      agents: ['claude', 'codex'],
      agentCredentials: {
        claude: { credentialSlug: 'anthropic-1', model: 'claude-opus-4-8' },
        codex: { credentialSlug: 'openai-1', model: 'gpt-5.5' },
      },
      adapterRegistry: reg,
      credentials,
      logger,
    })

    expect(calls).toHaveLength(2)
    const claudeCall = calls.find((c) => c.id === 'claude')!
    expect(claudeCall.cred).toMatchObject({ apiKey: 'sk-ant', model: 'claude-opus-4-8', authMode: 'x-api-key' })
    const codexCall = calls.find((c) => c.id === 'codex')!
    expect(codexCall.cred).toMatchObject({ apiKey: 'sk-oa', model: 'gpt-5.5' })
  })

  it('skips (loud warn) an agent declared but not enabled on the workspace', async () => {
    const calls: WriteCall[] = []
    const reg = new AdapterRegistry()
    reg.register(stubAdapter('claude', calls))
    const { logger, warns } = fakeLogger()

    await injectWorkspaceCredentials({
      dir: '/ws',
      agents: ['claude'], // codex NOT enabled
      agentCredentials: { codex: { credentialSlug: 'openai-1', model: 'gpt-5.5' } },
      adapterRegistry: reg,
      credentials,
      logger,
    })

    expect(calls).toHaveLength(0)
    expect(warns).toContain('workspace.cred_inject_skip_disabled')
  })

  it('skips (loud warn) when the referenced credential slug is missing', async () => {
    const calls: WriteCall[] = []
    const reg = new AdapterRegistry()
    reg.register(stubAdapter('claude', calls))
    const { logger, warns } = fakeLogger()

    await injectWorkspaceCredentials({
      dir: '/ws',
      agents: ['claude'],
      agentCredentials: { claude: { credentialSlug: 'does-not-exist' } },
      adapterRegistry: reg,
      credentials,
      logger,
    })

    expect(calls).toHaveLength(0)
    expect(warns).toContain('workspace.cred_inject_missing_credential')
  })
})
