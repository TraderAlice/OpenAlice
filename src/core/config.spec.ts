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
  readAIBackend,
  writeAIBackend,
  readToolsConfig,
  readAgentConfig,
  readMarketDataConfig,
  loadTradingConfig,
  writeConfigSection,
  readPlatformsConfig,
  readAccountsConfig,
  writePlatformsConfig,
  writeAccountsConfig,
  aiProviderSchema,
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
    expect(cfg.backend).toBe('claude-code')
    expect(cfg.provider).toBe('anthropic')
    expect(cfg.model).toBe('claude-sonnet-4-6')
  })

  it('parses valid file content', async () => {
    fileReturns({ backend: 'vercel-ai-sdk', provider: 'openai', model: 'gpt-4o' })
    const cfg = await readAIProviderConfig()
    expect(cfg.backend).toBe('vercel-ai-sdk')
    expect(cfg.provider).toBe('openai')
    expect(cfg.model).toBe('gpt-4o')
  })

  it('returns defaults when file contains invalid JSON (parse error)', async () => {
    fileReadError('Unexpected token')
    const cfg = await readAIProviderConfig()
    expect(cfg.backend).toBe('claude-code')
  })

  it('fills in missing fields with schema defaults', async () => {
    fileReturns({ backend: 'agent-sdk' })
    const cfg = await readAIProviderConfig()
    expect(cfg.backend).toBe('agent-sdk')
    expect(cfg.provider).toBe('anthropic')   // default
    expect(cfg.model).toBe('claude-sonnet-4-6') // default
  })
})

// ==================== readAIBackend ====================

describe('readAIBackend', () => {
  it('returns claude-code backend by default', async () => {
    fileNotFound()
    const { backend } = await readAIBackend()
    expect(backend).toBe('claude-code')
  })

  it('returns the backend stored in file', async () => {
    fileReturns({ backend: 'vercel-ai-sdk' })
    const { backend } = await readAIBackend()
    expect(backend).toBe('vercel-ai-sdk')
  })
})

// ==================== writeAIBackend ====================

describe('writeAIBackend', () => {
  it('reads current config and overwrites only the backend field', async () => {
    // First read: return existing config with custom model
    fileReturns({ backend: 'claude-code', provider: 'anthropic', model: 'my-custom-model' })

    await writeAIBackend('vercel-ai-sdk')

    expect(mockMkdir).toHaveBeenCalled()
    expect(mockWriteFile).toHaveBeenCalled()

    const written = JSON.parse((mockWriteFile.mock.calls[0][1] as string))
    expect(written.backend).toBe('vercel-ai-sdk')
    expect(written.model).toBe('my-custom-model') // preserved
    expect(written.provider).toBe('anthropic')    // preserved
  })

  it('writes to ai-provider-manager.json', async () => {
    fileReturns({ backend: 'agent-sdk' })
    await writeAIBackend('claude-code')

    const filePath = mockWriteFile.mock.calls[0][0] as string
    expect(filePath).toMatch(/ai-provider-manager\.json$/)
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
      writeConfigSection('aiProvider', { backend: 'invalid-backend-name' })
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

// ==================== readPlatformsConfig / writeAccountsConfig ====================

describe('readPlatformsConfig', () => {
  it('returns empty array when file is missing', async () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException
    enoent.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(enoent)
    const platforms = await readPlatformsConfig()
    expect(platforms).toEqual([])
  })

  it('parses platforms from file', async () => {
    fileReturns([{ id: 'bybit-platform', type: 'ccxt', exchange: 'bybit' }])
    const platforms = await readPlatformsConfig()
    expect(platforms).toHaveLength(1)
    expect(platforms[0].type).toBe('ccxt')
    expect((platforms[0] as any).exchange).toBe('bybit')
  })
})

describe('readAccountsConfig', () => {
  it('returns empty array when file is missing', async () => {
    const enoent = new Error('ENOENT') as NodeJS.ErrnoException
    enoent.code = 'ENOENT'
    mockReadFile.mockRejectedValueOnce(enoent)
    const accounts = await readAccountsConfig()
    expect(accounts).toEqual([])
  })

  it('parses accounts from file', async () => {
    fileReturns([{ id: 'bybit-main', platformId: 'bybit-platform', apiKey: 'key1', apiSecret: 'sec1' }])
    const accounts = await readAccountsConfig()
    expect(accounts).toHaveLength(1)
    expect(accounts[0].id).toBe('bybit-main')
    expect(accounts[0].platformId).toBe('bybit-platform')
  })
})

describe('writePlatformsConfig', () => {
  it('writes validated platforms to platforms.json', async () => {
    await writePlatformsConfig([{ id: 'alpaca-platform', type: 'alpaca', paper: true }])
    const filePath = mockWriteFile.mock.calls[0][0] as string
    expect(filePath).toMatch(/platforms\.json$/)
    const written = JSON.parse(mockWriteFile.mock.calls[0][1] as string)
    expect(written[0].type).toBe('alpaca')
  })

  it('throws ZodError for invalid platform type', async () => {
    await expect(
      writePlatformsConfig([{ id: 'bad', type: 'unknown-type' } as any])
    ).rejects.toThrow()
    expect(mockWriteFile).not.toHaveBeenCalled()
  })
})

describe('writeAccountsConfig', () => {
  it('writes validated accounts to accounts.json', async () => {
    await writeAccountsConfig([{ id: 'acc-1', platformId: 'plat-1', guards: [] }])
    const filePath = mockWriteFile.mock.calls[0][0] as string
    expect(filePath).toMatch(/accounts\.json$/)
  })
})

// ==================== loadTradingConfig ====================

describe('loadTradingConfig', () => {
  it('returns platforms + accounts directly when both files exist', async () => {
    // platforms.json
    fileReturns([{ id: 'bybit-p', type: 'ccxt', exchange: 'bybit' }])
    // accounts.json
    fileReturns([{ id: 'bybit-main', platformId: 'bybit-p' }])

    const { platforms, accounts } = await loadTradingConfig()
    expect(platforms).toHaveLength(1)
    expect(platforms[0].id).toBe('bybit-p')
    expect(accounts).toHaveLength(1)
    expect(accounts[0].id).toBe('bybit-main')
    // No migration write should occur
    expect(mockWriteFile).not.toHaveBeenCalled()
  })

  it('migrates from crypto.json + securities.json when platforms.json is missing', async () => {
    // platforms.json → ENOENT
    fileNotFound()
    // accounts.json → ENOENT
    fileNotFound()
    // crypto.json (loaded inside migrateLegacyTradingConfig)
    fileReturns({
      provider: {
        type: 'ccxt',
        exchange: 'binance',
        apiKey: 'k1',
        apiSecret: 's1',
        sandbox: false,
        demoTrading: false,
        defaultMarketType: 'spot',
      },
      guards: [],
    })
    // securities.json
    fileReturns({
      provider: { type: 'alpaca', paper: true, apiKey: 'alpk', secretKey: 'alps' },
      guards: [],
    })

    const { platforms, accounts } = await loadTradingConfig()

    expect(platforms.find(p => p.type === 'ccxt')).toBeDefined()
    expect(platforms.find(p => p.type === 'alpaca')).toBeDefined()
    expect(accounts.find(a => a.id === 'binance-main')).toBeDefined()
    expect(accounts.find(a => a.id === 'alpaca-paper')).toBeDefined()

    // Should have written platforms.json and accounts.json
    const writtenPaths = mockWriteFile.mock.calls.map(c => c[0] as string)
    expect(writtenPaths.some(p => p.endsWith('platforms.json'))).toBe(true)
    expect(writtenPaths.some(p => p.endsWith('accounts.json'))).toBe(true)
  })

  it('migrates from legacy with none providers → empty arrays', async () => {
    fileNotFound() // platforms.json
    fileNotFound() // accounts.json
    fileReturns({ provider: { type: 'none' }, guards: [] }) // crypto.json
    fileReturns({ provider: { type: 'none' }, guards: [] }) // securities.json

    const { platforms, accounts } = await loadTradingConfig()
    expect(platforms).toHaveLength(0)
    expect(accounts).toHaveLength(0)
  })

  it('falls back to defaults when legacy files are also missing', async () => {
    fileNotFound() // platforms.json
    fileNotFound() // accounts.json
    fileNotFound() // crypto.json
    fileNotFound() // securities.json

    const { platforms, accounts } = await loadTradingConfig()
    // Default crypto is ccxt/binance, default securities is alpaca/paper
    expect(platforms.find(p => p.type === 'ccxt')).toBeDefined()
    expect(platforms.find(p => p.type === 'alpaca')).toBeDefined()
  })
})

// ==================== aiProviderSchema (Zod schema validation) ====================

describe('aiProviderSchema', () => {
  it('accepts valid backends', () => {
    for (const backend of ['claude-code', 'vercel-ai-sdk', 'agent-sdk'] as const) {
      expect(() => aiProviderSchema.parse({ backend })).not.toThrow()
    }
  })

  it('rejects unknown backend', () => {
    expect(() => aiProviderSchema.parse({ backend: 'unknown-backend' })).toThrow()
  })

  it('uses defaults for missing fields', () => {
    const result = aiProviderSchema.parse({})
    expect(result.backend).toBe('claude-code')
    expect(result.provider).toBe('anthropic')
    expect(result.model).toBe('claude-sonnet-4-6')
    expect(result.apiKeys).toEqual({})
  })
})
