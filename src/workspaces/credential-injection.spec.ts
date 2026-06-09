import { describe, it, expect, vi } from 'vitest'
import { credentialToWorkspaceAiCred, injectWorkspaceCredentials } from './credential-injection.js'
import { AdapterRegistry, type CliAdapter, type WorkspaceAiCred } from './cli-adapter.js'
import type { Credential } from '@/core/config.js'
import type { Logger } from './logger.js'

// Multi-wire credentials: one key, the shapes (→ endpoints) it can speak.
const anthropicKey: Credential = { vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-ant', wires: { anthropic: '' } }
const minimaxIntl: Credential = {
  vendor: 'minimax', authType: 'api-key', apiKey: 'mm-key',
  wires: { anthropic: 'https://api.minimax.io/anthropic', 'openai-chat': 'https://api.minimax.io/v1' },
}
const openaiKey: Credential = { vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-responses': '', 'openai-chat': '' } }
const chatOnlyGateway: Credential = { vendor: 'custom', authType: 'api-key', apiKey: 'k', wires: { 'openai-chat': 'https://gw.example.com/v1' } }

describe('credentialToWorkspaceAiCred', () => {
  it('picks the agent\'s wire (claude → anthropic) + apiKey; model from overrides', () => {
    const cred = credentialToWorkspaceAiCred(minimaxIntl, 'claude', { model: 'MiniMax-M3' })!
    expect(cred.apiKey).toBe('mm-key')
    expect(cred.baseUrl).toBe('https://api.minimax.io/anthropic')
    expect(cred.wireShape).toBe('anthropic')
    expect(cred.model).toBe('MiniMax-M3')
  })

  it('returns null when no wire the agent speaks (chat-only key → codex)', () => {
    expect(credentialToWorkspaceAiCred(chatOnlyGateway, 'codex', { model: 'gpt-5.5' })).toBeNull()
  })

  it('credential carries no model — model is null without an override', () => {
    const cred = credentialToWorkspaceAiCred(anthropicKey, 'claude')!
    expect(cred.model).toBeNull()
  })

  it('upgrades a legacy {baseUrl,wireShape} credential transparently', () => {
    const legacy: Credential = { vendor: 'minimax', authType: 'api-key', apiKey: 'm', baseUrl: 'https://api.minimax.io/anthropic', wireShape: 'anthropic' }
    const cred = credentialToWorkspaceAiCred(legacy, 'claude', { model: 'm' })!
    expect(cred.baseUrl).toBe('https://api.minimax.io/anthropic')
    expect(cred.wireShape).toBe('anthropic')
  })

  describe('claude → authMode', () => {
    it('defaults to x-api-key for first-party Anthropic', () => {
      expect(credentialToWorkspaceAiCred(anthropicKey, 'claude', { model: 'claude-opus-4-8' })!.authMode).toBe('x-api-key')
    })

    it('auto-promotes api.minimax.io to bearer', () => {
      expect(credentialToWorkspaceAiCred(minimaxIntl, 'claude', { model: 'MiniMax-M3' })!.authMode).toBe('bearer')
    })

    it('explicit override wins', () => {
      expect(credentialToWorkspaceAiCred(anthropicKey, 'claude', { authMode: 'bearer' })!.authMode).toBe('bearer')
    })
  })

  describe('codex → openai-responses wire', () => {
    it('picks the responses wire; wireApi undefined unless overridden (adapter forces responses)', () => {
      const cred = credentialToWorkspaceAiCred(openaiKey, 'codex', { model: 'gpt-5.5' })!
      expect(cred.wireShape).toBe('openai-responses')
      expect(cred.wireApi).toBeUndefined()
      expect(cred.authMode).toBeUndefined()
    })

    it('passes an explicit wireApi through', () => {
      expect(credentialToWorkspaceAiCred(openaiKey, 'codex', { model: 'gpt-5.5', wireApi: 'responses' })!.wireApi).toBe('responses')
    })
  })

  describe('opencode / pi → prefers chat, no adapter-specific knobs', () => {
    for (const agent of ['opencode', 'pi']) {
      it(`${agent}: picks openai-chat, sets neither authMode nor wireApi`, () => {
        const cred = credentialToWorkspaceAiCred(chatOnlyGateway, agent, { model: 'some-model' })!
        expect(cred.wireShape).toBe('openai-chat')
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

  it('skips (loud warn) when the credential has no wire the agent speaks', async () => {
    const calls: WriteCall[] = []
    const reg = new AdapterRegistry()
    reg.register(stubAdapter('codex', calls))
    const { logger, warns } = fakeLogger()

    await injectWorkspaceCredentials({
      dir: '/ws',
      agents: ['codex'],
      // chatOnlyGateway has only openai-chat; codex is Responses-only.
      agentCredentials: { codex: { credentialSlug: 'chat-only', model: 'gpt-5.5' } },
      adapterRegistry: reg,
      credentials: { 'chat-only': chatOnlyGateway },
      logger,
    })

    expect(calls).toHaveLength(0)
    expect(warns).toContain('workspace.cred_inject_incompatible_wire')
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
