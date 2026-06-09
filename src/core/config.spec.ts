/**
 * config.ts unit tests.
 *
 * fs/promises is mocked so no real disk I/O occurs.
 * Tests cover: hot-read helpers, writeConfigSection, writeAIBackend,
 * loadTradingConfig (both new-format and legacy-migration paths).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock fs/promises BEFORE importing config
vi.mock('fs/promises', () => ({
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
}))

import { readFile, writeFile, mkdir } from 'fs/promises'
import {
  readAIProviderConfig,
  setActiveProfile,
  readToolsConfig,
  readAgentConfig,
  readMarketDataConfig,
  writeConfigSection,
  readUTAsConfig,
  writeUTAsConfig,
  aiProviderSchema,
  profileSchema,
  resolveProfile,
  resolveCredential,
  deleteCredential,
  credentialSchema,
  extractCredentialFromProfile,
  type Profile,
} from './config.js'

const mockReadFile = vi.mocked(readFile)
const mockWriteFile = vi.mocked(writeFile)
const mockMkdir = vi.mocked(mkdir)

/** Simulate a file read that returns JSON content. */
function fileReturns(content: unknown) {
  mockReadFile.mockResolvedValueOnce(JSON.stringify(content) as any)
}

/** Simulate ENOENT (file not found). */
function fileNotFound() {
  const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException
  err.code = 'ENOENT'
  mockReadFile.mockRejectedValueOnce(err)
}

/** Simulate a non-ENOENT read error. */
function fileReadError(message = 'Permission denied') {
  mockReadFile.mockRejectedValueOnce(new Error(message))
}

beforeEach(() => {
  vi.clearAllMocks()
  mockWriteFile.mockResolvedValue(undefined as any)
  mockMkdir.mockResolvedValue(undefined as any)
})

// ==================== readAIProviderConfig ====================

describe('readAIProviderConfig', () => {
  it('returns schema defaults when file is missing', async () => {
    fileNotFound()
    const cfg = await readAIProviderConfig()
    expect(cfg.activeProfile).toBe('default')
    expect(cfg.profiles.default).toBeDefined()
    expect(cfg.profiles.default.backend).toBe('agent-sdk')
  })

  it('parses valid profile-based content', async () => {
    fileReturns({
      apiKeys: { openai: 'sk-test' },
      profiles: { main: { backend: 'codex', label: 'GPT', model: 'gpt-5.4', loginMethod: 'codex-oauth' } },
      activeProfile: 'main',
    })
    const cfg = await readAIProviderConfig()
    expect(cfg.activeProfile).toBe('main')
    expect(cfg.profiles.main.backend).toBe('codex')
    expect(cfg.profiles.main.model).toBe('gpt-5.4')
  })

  it('returns defaults when file contains invalid JSON (parse error)', async () => {
    fileReadError('Unexpected token')
    const cfg = await readAIProviderConfig()
    expect(cfg.activeProfile).toBe('default')
  })
})

// ==================== setActiveProfile ====================

describe('setActiveProfile', () => {
  it('updates activeProfile and writes to disk', async () => {
    const config = {
      apiKeys: {},
      profiles: {
        a: { backend: 'agent-sdk', label: 'A', model: 'claude-sonnet-4-6', loginMethod: 'api-key' },
        b: { backend: 'codex', label: 'B', model: 'gpt-5.4', loginMethod: 'codex-oauth' },
      },
      activeProfile: 'a',
    }
    fileReturns(config)

    await setActiveProfile('b')

    expect(mockWriteFile).toHaveBeenCalled()
    const written = JSON.parse((mockWriteFile.mock.calls[0][1] as string))
    expect(written.activeProfile).toBe('b')
    expect(written.profiles.a).toBeDefined() // preserved
  })

  it('throws on unknown profile slug', async () => {
    fileReturns({ apiKeys: {}, profiles: { a: { backend: 'agent-sdk', label: 'A', model: 'x' } }, activeProfile: 'a' })
    await expect(setActiveProfile('nonexistent')).rejects.toThrow('Unknown profile')
  })
})

// ==================== readToolsConfig ====================

describe('readToolsConfig', () => {
  it('returns empty disabled list when file is missing', async () => {
    fileNotFound()
    const cfg = await readToolsConfig()
    expect(cfg.disabled).toEqual([])
  })

  it('returns disabled tools from file', async () => {
    fileReturns({ disabled: ['web_search', 'read_file'] })
    const cfg = await readToolsConfig()
    expect(cfg.disabled).toEqual(['web_search', 'read_file'])
  })

  it('returns defaults on read error', async () => {
    fileReadError()
    const cfg = await readToolsConfig()
    expect(cfg.disabled).toEqual([])
  })
})

// ==================== readAgentConfig ====================

describe('readAgentConfig', () => {
  it('returns defaults when file is missing', async () => {
    fileNotFound()
    const cfg = await readAgentConfig()
    expect(cfg.maxSteps).toBe(20)
    expect(cfg.evolutionMode).toBe(false)
  })

  it('parses maxSteps from file', async () => {
    fileReturns({ maxSteps: 50 })
    const cfg = await readAgentConfig()
    expect(cfg.maxSteps).toBe(50)
  })
})

// ==================== readOpenbbConfig ====================

describe('readMarketDataConfig', () => {
  it('returns defaults when file is missing', async () => {
    fileNotFound()
    const cfg = await readMarketDataConfig()
    expect(cfg.enabled).toBe(true)
    expect(cfg.backend).toBe('typebb-sdk')
  })

  it('parses enabled flag from file', async () => {
    fileReturns({ enabled: false })
    const cfg = await readMarketDataConfig()
    expect(cfg.enabled).toBe(false)
  })
})

// ==================== writeConfigSection ====================

describe('writeConfigSection', () => {
  it('validates and writes a section to the correct file', async () => {
    const result = await writeConfigSection('tools', { disabled: ['foo'] })

    expect(mockWriteFile).toHaveBeenCalledOnce()
    const filePath = mockWriteFile.mock.calls[0][0] as string
    expect(filePath).toMatch(/tools\.json$/)

    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written.disabled).toEqual(['foo'])
    expect(result).toMatchObject({ disabled: ['foo'] })
  })

  it('applies schema defaults when partial data is provided', async () => {
    const result = await writeConfigSection('tools', {}) as { disabled: string[] }
    expect(result.disabled).toEqual([])
  })

  it('throws ZodError for invalid data (does not write file)', async () => {
    await expect(
      writeConfigSection('aiProvider', { profiles: { bad: { backend: 'invalid-backend', label: 'X' } } })
    ).rejects.toThrow()
    // writeFile should not have been called
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('writes connectors section to connectors.json', async () => {
    await writeConfigSection('connectors', { web: { port: 3005 } })
    const filePath = mockWriteFile.mock.calls[0][0] as string
    expect(filePath).toMatch(/connectors\.json$/)
  })
})

// ==================== readUTAsConfig / writeUTAsConfig ====================

describe('readUTAsConfig', () => {
  it('returns empty array and seeds file when missing', async () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException
    enoent.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(enoent)
    const accounts = await readUTAsConfig()
    expect(accounts).toEqual([])
    // Should seed empty accounts.json
    expect(mockWriteFile).toHaveBeenCalledTimes(1)
  })

  it('parses preset-shaped accounts from file', async () => {
    fileReturns([
      { id: 'okx-main', presetId: 'okx', enabled: true, guards: [], presetConfig: { mode: 'live', apiKey: 'k', secret: 's', password: 'p' } },
      { id: 'alpaca-paper', presetId: 'alpaca', enabled: true, guards: [], presetConfig: { mode: 'paper', apiKey: 'k', apiSecret: 's' } },
    ])
    const accounts = await readUTAsConfig()
    expect(accounts).toHaveLength(2)
    expect(accounts[0].presetId).toBe('okx')
    expect(accounts[1].presetId).toBe('alpaca')
  })

  it('auto-migrates pre-preset (legacy) ccxt shape and backs up the original', async () => {
    fileReturns([
      { id: 'okx-live', type: 'ccxt', enabled: true, guards: [], brokerConfig: { exchange: 'okx', sandbox: false, apiKey: 'k', apiSecret: 's', password: 'p' } },
      { id: 'okx-demo', type: 'ccxt', enabled: true, guards: [], brokerConfig: { exchange: 'okx', sandbox: true, apiKey: 'k', apiSecret: 's', password: 'p' } },
      { id: 'bybit-test', type: 'ccxt', enabled: true, guards: [], brokerConfig: { exchange: 'bybit', sandbox: true, apiKey: 'k', apiSecret: 's' } },
    ])
    const accounts = await readUTAsConfig()
    expect(accounts).toHaveLength(3)
    expect(accounts[0]).toMatchObject({ id: 'okx-live', presetId: 'okx', presetConfig: { mode: 'live' } })
    expect(accounts[1]).toMatchObject({ id: 'okx-demo', presetId: 'okx', presetConfig: { mode: 'demo' } })
    expect(accounts[2]).toMatchObject({ id: 'bybit-test', presetId: 'bybit', presetConfig: { mode: 'testnet' } })
    // CCXT secret alias (apiSecret → secret)
    expect(accounts[0].presetConfig.secret).toBe('s')
    // Backup + rewritten accounts.json both written
    const writePaths = mockWriteFile.mock.calls.map((c) => c[0] as string)
    expect(writePaths.some((p) => p.endsWith('accounts.json.backup-pre-preset'))).toBe(true)
    expect(writePaths.some((p) => p.endsWith('accounts.json'))).toBe(true)
  })

  it('migrates legacy alpaca + ibkr accounts', async () => {
    fileReturns([
      { id: 'alp', type: 'alpaca', enabled: true, guards: [], brokerConfig: { paper: true, apiKey: 'k', apiSecret: 's' } },
      { id: 'ibk', type: 'ibkr', enabled: true, guards: [], brokerConfig: { host: '127.0.0.1', port: 7497, clientId: 0 } },
    ])
    const accounts = await readUTAsConfig()
    expect(accounts[0]).toMatchObject({ presetId: 'alpaca', presetConfig: { mode: 'paper' } })
    expect(accounts[1]).toMatchObject({ presetId: 'ibkr-tws', presetConfig: { host: '127.0.0.1', port: 7497 } })
  })

  it('falls back to ccxt-custom for unknown ccxt exchanges', async () => {
    fileReturns([
      { id: 'kc', type: 'ccxt', enabled: true, guards: [], brokerConfig: { exchange: 'kucoin', apiKey: 'k', apiSecret: 's', password: 'p' } },
    ])
    const accounts = await readUTAsConfig()
    expect(accounts[0]).toMatchObject({ presetId: 'ccxt-custom', presetConfig: { exchange: 'kucoin', secret: 's' } })
  })
})

describe('writeUTAsConfig', () => {
  it('writes validated accounts to accounts.json', async () => {
    await writeUTAsConfig([{
      id: 'acc-1', presetId: 'alpaca', enabled: true, guards: [],
      presetConfig: { mode: 'paper', apiKey: 'k', apiSecret: 's' },
    }])
    const filePath = mockWriteFile.mock.calls[0][0] as string
    expect(filePath).toMatch(/accounts\.json$/)
  })

  it('throws ZodError for missing required fields', async () => {
    await expect(
      writeUTAsConfig([{ presetId: 'alpaca' } as any])
    ).rejects.toThrow()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

// ==================== aiProviderSchema (Zod schema validation) ====================

describe('aiProviderSchema (profile-based)', () => {
  it('uses defaults for empty object', () => {
    const result = aiProviderSchema.parse({})
    expect(result.activeProfile).toBe('default')
    expect(result.profiles.default).toBeDefined()
    expect(result.apiKeys).toEqual({})
  })

  it('accepts valid profile-based config', () => {
    expect(() => aiProviderSchema.parse({
      profiles: { test: { backend: 'codex', label: 'Test', model: 'gpt-5.4', loginMethod: 'codex-oauth' } },
      activeProfile: 'test',
    })).not.toThrow()
  })
})

describe('profileSchema', () => {
  it('validates agent-sdk profile', () => {
    const result = profileSchema.parse({ backend: 'agent-sdk', label: 'Claude', model: 'claude-opus-4-6', loginMethod: 'claudeai' })
    expect(result.backend).toBe('agent-sdk')
  })

  it('validates codex profile', () => {
    const result = profileSchema.parse({ backend: 'codex', label: 'GPT', model: 'gpt-5.4' })
    expect(result.backend).toBe('codex')
    if (result.backend === 'codex') expect(result.loginMethod).toBe('codex-oauth') // default
  })

  it('validates vercel profile', () => {
    const result = profileSchema.parse({ backend: 'vercel-ai-sdk', label: 'Gemini', provider: 'google', model: 'gemini-2.5-flash' })
    expect(result.backend).toBe('vercel-ai-sdk')
  })

  it('rejects unknown backend', () => {
    expect(() => profileSchema.parse({ backend: 'unknown', label: 'X', model: 'y' })).toThrow()
  })

  it('accepts credentialSlug', () => {
    const result = profileSchema.parse({
      backend: 'agent-sdk', model: 'claude-opus-4-7', loginMethod: 'api-key',
      credentialSlug: 'anthropic-1',
    })
    if (result.backend === 'agent-sdk') {
      expect(result.credentialSlug).toBe('anthropic-1')
    }
  })
})

// ==================== credentialSchema ====================

describe('credentialSchema', () => {
  it('validates api-key credential', () => {
    const result = credentialSchema.parse({ vendor: 'anthropic', authType: 'api-key', apiKey: 'sk-x' })
    expect(result.vendor).toBe('anthropic')
    expect(result.authType).toBe('api-key')
  })

  it('validates subscription credential without apiKey', () => {
    const result = credentialSchema.parse({ vendor: 'anthropic', authType: 'subscription' })
    expect(result.apiKey).toBeUndefined()
  })

  it('rejects unknown vendor', () => {
    expect(() => credentialSchema.parse({ vendor: 'fake', authType: 'api-key' })).toThrow()
  })

  it('normalizes empty / whitespace baseUrl to undefined (dedup invariant)', () => {
    // The dedup predicate compares baseUrl with ===, so '' must collapse to
    // undefined or a default-endpoint cred would duplicate. See
    // feedback_optional_empty_string.
    expect(credentialSchema.parse({ vendor: 'glm', authType: 'api-key', apiKey: 'k', baseUrl: '' }).baseUrl).toBeUndefined()
    expect(credentialSchema.parse({ vendor: 'glm', authType: 'api-key', apiKey: 'k', baseUrl: '   ' }).baseUrl).toBeUndefined()
  })

  it('trims and keeps a real baseUrl (region stays distinct)', () => {
    expect(credentialSchema.parse({ vendor: 'glm', authType: 'api-key', apiKey: 'k', baseUrl: '  https://api.z.ai/api/anthropic ' }).baseUrl)
      .toBe('https://api.z.ai/api/anthropic')
  })

  it('persists wireShape (disambiguates same-baseUrl shapes, e.g. OpenAI chat vs responses)', () => {
    expect(credentialSchema.parse({ vendor: 'openai', authType: 'api-key', apiKey: 'k', wireShape: 'openai-responses' }).wireShape)
      .toBe('openai-responses')
    expect(credentialSchema.parse({ vendor: 'anthropic', authType: 'api-key', apiKey: 'k' }).wireShape).toBeUndefined()
    expect(() => credentialSchema.parse({ vendor: 'openai', authType: 'api-key', apiKey: 'k', wireShape: 'bogus' })).toThrow()
  })
})

// ==================== resolveProfile (with credential join) ====================

describe('resolveProfile', () => {
  it('returns inline shape when credentialSlug is absent', async () => {
    fileReturns({
      profiles: { default: { backend: 'agent-sdk', model: 'claude-opus-4-7', loginMethod: 'api-key', apiKey: 'inline-key' } },
      activeProfile: 'default',
    })
    const r = await resolveProfile()
    expect(r.apiKey).toBe('inline-key')
    expect(r.baseUrl).toBeUndefined()
  })

  it('joins credential when credentialSlug is set and inline is absent', async () => {
    fileReturns({
      credentials: { 'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'cred-key', baseUrl: 'https://api.example/' } },
      profiles: { default: { backend: 'agent-sdk', model: 'm', loginMethod: 'api-key', credentialSlug: 'anthropic-1' } },
      activeProfile: 'default',
    })
    const r = await resolveProfile()
    expect(r.apiKey).toBe('cred-key')
    expect(r.baseUrl).toBe('https://api.example/')
  })

  it('inline value wins over credential value (transitional fallback semantics)', async () => {
    fileReturns({
      credentials: { 'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'cred-key' } },
      profiles: {
        default: {
          backend: 'agent-sdk', model: 'm', loginMethod: 'api-key',
          apiKey: 'inline-wins',
          credentialSlug: 'anthropic-1',
        },
      },
      activeProfile: 'default',
    })
    const r = await resolveProfile()
    expect(r.apiKey).toBe('inline-wins')
  })

  it('throws when credentialSlug references missing credential', async () => {
    fileReturns({
      credentials: {},
      profiles: { default: { backend: 'agent-sdk', model: 'm', loginMethod: 'api-key', credentialSlug: 'ghost' } },
      activeProfile: 'default',
    })
    await expect(resolveProfile()).rejects.toThrow(/missing credential/)
  })
})

// ==================== resolveCredential / deleteCredential ====================

describe('resolveCredential', () => {
  it('returns the credential by slug', async () => {
    fileReturns({
      credentials: { 'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa' } },
      profiles: { default: { backend: 'agent-sdk', model: 'm', loginMethod: 'claudeai' } },
      activeProfile: 'default',
    })
    const c = await resolveCredential('openai-1')
    expect(c.vendor).toBe('openai')
    expect(c.apiKey).toBe('sk-oa')
  })

  it('throws when slug is unknown', async () => {
    fileReturns({
      credentials: {},
      profiles: { default: { backend: 'agent-sdk', model: 'm', loginMethod: 'claudeai' } },
      activeProfile: 'default',
    })
    await expect(resolveCredential('nope')).rejects.toThrow(/Unknown credential/)
  })
})

describe('deleteCredential', () => {
  it('errors when a profile still references the credential', async () => {
    fileReturns({
      credentials: { 'anthropic-1': { vendor: 'anthropic', authType: 'api-key', apiKey: 'k' } },
      profiles: {
        default: { backend: 'agent-sdk', model: 'm', loginMethod: 'api-key', credentialSlug: 'anthropic-1' },
      },
      activeProfile: 'default',
    })
    await expect(deleteCredential('anthropic-1')).rejects.toThrow(/referenced by profile/)
  })

  it('deletes when no profile references it', async () => {
    fileReturns({
      credentials: { 'orphan-1': { vendor: 'openai', authType: 'api-key', apiKey: 'k' } },
      profiles: { default: { backend: 'agent-sdk', model: 'm', loginMethod: 'claudeai' } },
      activeProfile: 'default',
    })
    await expect(deleteCredential('orphan-1')).resolves.toBeUndefined()
    expect(mockWriteFile).toHaveBeenCalled()
  })
})

// ==================== extractCredentialFromProfile ====================

describe('extractCredentialFromProfile', () => {
  it('passes through profile when credentialSlug already set', () => {
    const profile = { backend: 'agent-sdk', model: 'm', loginMethod: 'api-key', apiKey: 'k', credentialSlug: 'existing' } as Profile
    const out = extractCredentialFromProfile(profile, {})
    expect(out.profile).toBe(profile)
    expect(out.credentials).toEqual({})
  })

  it('passes through profile when nothing extractable (no apiKey, not subscription)', () => {
    const profile = { backend: 'agent-sdk', model: 'm', loginMethod: 'api-key' } as Profile
    const out = extractCredentialFromProfile(profile, {})
    expect(out.profile.credentialSlug).toBeUndefined()
    expect(out.credentials).toEqual({})
  })

  it('creates a new credential and links via slug when no match exists', () => {
    const profile = {
      backend: 'agent-sdk', model: 'm', loginMethod: 'api-key',
      apiKey: 'sk-deep', baseUrl: 'https://api.deepseek.com/anthropic',
    } as Profile
    const out = extractCredentialFromProfile(profile, {})
    expect(out.profile.credentialSlug).toBe('deepseek-1')
    expect(out.credentials['deepseek-1']).toEqual({
      vendor: 'deepseek',
      authType: 'api-key',
      apiKey: 'sk-deep',
      baseUrl: 'https://api.deepseek.com/anthropic',
    })
  })

  it('reuses existing credential slug when fields match (dedup)', () => {
    const existing = {
      'deepseek-1': { vendor: 'deepseek' as const, authType: 'api-key' as const, apiKey: 'sk-d', baseUrl: 'https://api.deepseek.com/anthropic' },
    }
    const profile = {
      backend: 'agent-sdk', model: 'm', loginMethod: 'api-key',
      apiKey: 'sk-d', baseUrl: 'https://api.deepseek.com/anthropic',
    } as Profile
    const out = extractCredentialFromProfile(profile, existing)
    expect(out.profile.credentialSlug).toBe('deepseek-1')
    expect(out.credentials).toBe(existing) // reference equality — no new entry
  })

  it('generates next available slug when vendor matches but fields differ', () => {
    const existing = {
      'anthropic-1': { vendor: 'anthropic' as const, authType: 'api-key' as const, apiKey: 'sk-1' },
    }
    const profile = {
      backend: 'agent-sdk', model: 'm', loginMethod: 'api-key', apiKey: 'sk-2',
    } as Profile
    const out = extractCredentialFromProfile(profile, existing)
    expect(out.profile.credentialSlug).toBe('anthropic-2')
    expect(out.credentials['anthropic-2'].apiKey).toBe('sk-2')
  })
})
