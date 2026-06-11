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
  rm: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  chmod: vi.fn().mockResolvedValue(undefined),
}))

// Identity-mock the sealing layer: it's unit-tested in sealing.spec.ts (and
// round-tripped against real disk in config-accounts.spec.ts). Identity keeps
// this file's on-disk JSON assertions readable, and spares the mocked
// fs/promises from having to simulate the key file.
vi.mock('./sealing.js', () => ({
  isSealedEnvelope: () => false,
  seal: async (v: unknown) => v,
  unseal: async (v: unknown) => v,
}))

import { readFile, writeFile, mkdir } from 'fs/promises'
import {
  readAIProviderConfig,
  readToolsConfig,
  readAgentConfig,
  readMarketDataConfig,
  writeConfigSection,
  readUTAsConfig,
  writeUTAsConfig,
  aiProviderSchema,
  resolveCredential,
  deleteCredential,
  credentialSchema,
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
  it('returns schema defaults (empty vault) when file is missing', async () => {
    fileNotFound()
    const cfg = await readAIProviderConfig()
    expect(cfg.credentials).toEqual({})
    expect(cfg.apiKeys).toEqual({})
  })

  it('parses a credential vault', async () => {
    fileReturns({
      apiKeys: { openai: 'sk-test' },
      credentials: { 'glm-1': { vendor: 'glm', authType: 'api-key', apiKey: 'k', wires: { anthropic: 'https://open.bigmodel.cn/api/anthropic' } } },
    })
    const cfg = await readAIProviderConfig()
    expect(cfg.credentials['glm-1'].vendor).toBe('glm')
    expect(cfg.apiKeys.openai).toBe('sk-test')
  })

  it('returns defaults when file contains invalid JSON (parse error)', async () => {
    fileReadError('Unexpected token')
    const cfg = await readAIProviderConfig()
    expect(cfg.credentials).toEqual({})
  })

  it('ignores legacy profiles/activeProfile fields (stripped by the schema)', async () => {
    fileReturns({ profiles: { default: { backend: 'agent-sdk' } }, activeProfile: 'default', credentials: {} })
    const cfg = await readAIProviderConfig()
    expect('profiles' in cfg).toBe(false)
    expect('activeProfile' in cfg).toBe(false)
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
    expect(cfg.hub).toEqual({ enabled: true, baseUrl: 'https://traderhub.openalice.ai' })
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
      writeConfigSection('aiProvider', { credentials: { bad: { vendor: 'not-a-vendor', authType: 'api-key' } } })
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
      keyless: false, readOnly: false, editable: true,
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

describe('aiProviderSchema (credential vault)', () => {
  it('uses defaults for empty object (empty vault)', () => {
    const result = aiProviderSchema.parse({})
    expect(result.credentials).toEqual({})
    expect(result.apiKeys).toEqual({})
  })

  it('accepts a credentials map', () => {
    expect(() => aiProviderSchema.parse({
      credentials: { 'openai-1': { vendor: 'openai', authType: 'api-key', apiKey: 'sk' } },
    })).not.toThrow()
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
  it('removes the credential from the vault', async () => {
    fileReturns({
      credentials: { 'orphan-1': { vendor: 'openai', authType: 'api-key', apiKey: 'k' } },
    })
    await expect(deleteCredential('orphan-1')).resolves.toBeUndefined()
    expect(mockWriteFile).toHaveBeenCalled()
  })
})

