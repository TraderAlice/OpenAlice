import { describe, it, expect, vi } from 'vitest'
import {
  credentialToWorkspaceAiCred,
  injectWorkspaceCredentials,
  compatibleCredentials,
  matchCredentialByApiKey,
  resolveInjectionModel,
} from './credential-injection.js'
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
const googleKey: Credential = {
  vendor: 'google', authType: 'api-key', apiKey: 'AQ.google',
  wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
}
const longcatKey: Credential = {
  vendor: 'longcat', authType: 'api-key', apiKey: 'lc-key',
  wires: { 'openai-chat': 'https://api.longcat.chat/openai' },
}

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

  describe('opencode / pi → supports selectable provider wires', () => {
    for (const agent of ['opencode', 'pi']) {
      it(`${agent}: leaves an unknown model's context to the native runtime`, () => {
        const cred = credentialToWorkspaceAiCred(chatOnlyGateway, agent, { model: 'some-model' })!
        expect(cred.wireShape).toBe('openai-chat')
        expect(cred.authMode).toBeUndefined()
        expect(cred.wireApi).toBeUndefined()
        expect(cred.contextWindow).toBeUndefined()
        expect(cred.apiKey).toBe('k')
        expect(cred.baseUrl).toBe('https://gw.example.com/v1')
      })

      it(`${agent}: uses the complete registered context instead of a cross-model cap`, () => {
        const cred = credentialToWorkspaceAiCred(openaiKey, agent, { model: 'gpt-5.6' })!
        expect(cred.contextWindow).toBe(1_050_000)
      })

      it(`${agent}: defaults MiniMax to its Anthropic coding-agent wire`, () => {
        const cred = credentialToWorkspaceAiCred(minimaxIntl, agent, { model: 'MiniMax-M2.5' })!
        expect(cred).toMatchObject({
          wireShape: 'anthropic',
          baseUrl: 'https://api.minimax.io/anthropic',
          authMode: 'bearer',
          contextWindow: 204_800,
          reasoning: true,
        })
      })

      it(`${agent}: upgrades an old official MiniMax OpenAI-only credential`, () => {
        const legacyOpenAIOnly: Credential = {
          vendor: 'minimax',
          authType: 'api-key',
          apiKey: 'old-mm-key',
          wires: { 'openai-chat': 'https://api.minimaxi.com/v1' },
        }
        expect(credentialToWorkspaceAiCred(legacyOpenAIOnly, agent, {
          model: 'MiniMax-M2.5',
          wireShape: 'openai-chat',
        })).toMatchObject({
          wireShape: 'anthropic',
          baseUrl: 'https://api.minimaxi.com/anthropic',
          authMode: 'bearer',
        })
      })
    }
  })

  it('repairs legacy MiniMax OpenAI selections and rejects other incompatible wires', () => {
    for (const agent of ['opencode', 'pi']) {
      const repaired = credentialToWorkspaceAiCred(minimaxIntl, agent, {
        model: 'MiniMax-M3',
        wireShape: 'openai-chat',
      })!
      expect(repaired).toMatchObject({
        wireShape: 'anthropic',
        baseUrl: 'https://api.minimax.io/anthropic',
        authMode: 'bearer',
      })
    }
    expect(credentialToWorkspaceAiCred(minimaxIntl, 'codex', { wireShape: 'anthropic' })).toBeNull()
  })

  it('lets unknown opencode/Pi models override reasoning and context explicitly', () => {
    const cred = credentialToWorkspaceAiCred(chatOnlyGateway, 'pi', {
      model: 'some-model',
      contextWindow: 256_000,
      reasoning: true,
    })!
    expect(cred.contextWindow).toBe(256_000)
    expect(cred.reasoning).toBe(true)
    expect(credentialToWorkspaceAiCred(chatOnlyGateway, 'opencode', { reasoning: true })?.reasoning)
      .toBe(true)
  })

  it('auto-registers known model reasoning and caps context at the provider limit', () => {
    expect(credentialToWorkspaceAiCred(googleKey, 'pi', {
      model: 'gemini-3.1-flash-lite',
      contextWindow: 1_000_000,
      reasoning: false,
    })).toMatchObject({
      contextWindow: 1_000_000,
      reasoning: true,
      reasoningEffort: 'minimal',
    })

    expect(credentialToWorkspaceAiCred(minimaxIntl, 'opencode', {
      model: 'MiniMax-M2.7',
      contextWindow: 1_000_000,
    })).toMatchObject({
      contextWindow: 204_800,
      reasoning: true,
    })
  })

  it('projects a known model default effort into every compatible runtime', () => {
    for (const agent of ['claude', 'opencode', 'pi']) {
      expect(credentialToWorkspaceAiCred(anthropicKey, agent, {
        model: 'claude-sonnet-4-6',
      })).toMatchObject({ reasoningEffort: 'high' })
    }
    expect(credentialToWorkspaceAiCred(openaiKey, 'codex', {
      model: 'gpt-5.6',
    })).toMatchObject({ reasoningEffort: 'medium' })
  })

  it('does not fabricate an effort tier for a provider with only a thinking switch', () => {
    expect(credentialToWorkspaceAiCred(longcatKey, 'pi', {
      model: 'LongCat-2.0',
    })).not.toHaveProperty('reasoningEffort')
  })

  it('injects Google through the native wire for opencode and Pi only', () => {
    for (const agent of ['opencode', 'pi']) {
      expect(credentialToWorkspaceAiCred(googleKey, agent, { model: 'gemini-3.1-flash-lite' })).toMatchObject({
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
        apiKey: 'AQ.google',
        model: 'gemini-3.1-flash-lite',
        wireShape: 'google-generative-ai',
      })
    }
    expect(credentialToWorkspaceAiCred(googleKey, 'claude')).toBeNull()
    expect(credentialToWorkspaceAiCred(googleKey, 'codex')).toBeNull()
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

  it('resolves the credential model when a creation default does not pin one', async () => {
    const calls: WriteCall[] = []
    const reg = new AdapterRegistry()
    reg.register(stubAdapter('opencode', calls))
    const { logger } = fakeLogger()

    await injectWorkspaceCredentials({
      dir: '/ws',
      agents: ['opencode'],
      agentCredentials: { opencode: { credentialSlug: 'openai-1' } },
      adapterRegistry: reg,
      credentials: {
        'openai-1': { ...openaiKey, lastModel: 'gpt-5.5' },
      },
      logger,
    })

    expect(calls[0]?.cred).toMatchObject({ model: 'gpt-5.5', reasoning: true })
  })

  it('applies an unknown-model override only to the model it was decided for', async () => {
    const calls: WriteCall[] = []
    const reg = new AdapterRegistry()
    reg.register(stubAdapter('pi', calls))
    const { logger } = fakeLogger()
    const custom = { ...chatOnlyGateway, lastModel: 'current-model' }

    await injectWorkspaceCredentials({
      dir: '/ws',
      agents: ['pi'],
      agentCredentials: {
        pi: {
          credentialSlug: 'custom-1',
          reasoning: false,
          reasoningModel: 'previous-model',
        },
      },
      adapterRegistry: reg,
      credentials: { 'custom-1': custom },
      logger,
    })

    expect(calls[0]?.cred).toMatchObject({ model: 'current-model' })
    expect(calls[0]?.cred.reasoning).toBeUndefined()
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

describe('compatibleCredentials', () => {
  const vault: Record<string, Credential> = {
    'anthropic-1': anthropicKey,
    'openai-1': openaiKey,
    'custom-1': chatOnlyGateway,
    'google-1': googleKey,
  }

  it('opencode/pi accept every supported wire including native Google', () => {
    expect(compatibleCredentials(vault, 'opencode').map(([s]) => s)).toEqual(['anthropic-1', 'openai-1', 'custom-1', 'google-1'])
    expect(compatibleCredentials(vault, 'pi').map(([s]) => s)).toEqual(['anthropic-1', 'openai-1', 'custom-1', 'google-1'])
  })

  it('claude needs an anthropic wire — only the anthropic key qualifies', () => {
    expect(compatibleCredentials(vault, 'claude').map(([s]) => s)).toEqual(['anthropic-1'])
  })

  it('codex needs openai-responses — chat-only / anthropic keys are excluded', () => {
    expect(compatibleCredentials(vault, 'codex').map(([s]) => s)).toEqual(['openai-1'])
  })

  it('preserves input order', () => {
    const ordered: Record<string, Credential> = { z: openaiKey, a: anthropicKey }
    expect(compatibleCredentials(ordered, 'opencode').map(([s]) => s)).toEqual(['z', 'a'])
  })
})

describe('matchCredentialByApiKey', () => {
  const vault: Record<string, Credential> = { 'anthropic-1': anthropicKey, 'openai-1': openaiKey }

  it('maps an on-disk apiKey back to its vault slug', () => {
    expect(matchCredentialByApiKey(vault, 'sk-oa')).toBe('openai-1')
  })

  it('returns null for an unknown / hand-edited key', () => {
    expect(matchCredentialByApiKey(vault, 'sk-unknown')).toBeNull()
  })

  it('returns null for empty / missing input', () => {
    expect(matchCredentialByApiKey(vault, null)).toBeNull()
    expect(matchCredentialByApiKey(vault, undefined)).toBeNull()
    expect(matchCredentialByApiKey(vault, '')).toBeNull()
  })
})

describe('resolveInjectionModel', () => {
  it('prefers the credential\'s remembered lastModel', () => {
    expect(resolveInjectionModel({ vendor: 'openai', lastModel: 'gpt-5.5-custom' })).toBe('gpt-5.5-custom')
    expect(resolveInjectionModel({ vendor: 'openai', lastModel: 'gpt-5.5' })).toBe('gpt-5.5')
  })

  it('falls back to the vendor recommendation when no lastModel', () => {
    expect(resolveInjectionModel({ vendor: 'anthropic' })).toBe('claude-opus-4-8')
    expect(resolveInjectionModel({ vendor: 'openai' })).toBe('gpt-5.6')
    expect(resolveInjectionModel({ vendor: 'glm' })).toBe('glm-5.2')
    expect(resolveInjectionModel({ vendor: 'longcat' })).toBe('LongCat-2.0')
  })

  it('returns null for a vendor with no catalog default (custom)', () => {
    expect(resolveInjectionModel({ vendor: 'custom' })).toBeNull()
  })
})
