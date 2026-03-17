import { z } from 'zod'
import { readFile, writeFile, mkdir, unlink } from 'fs/promises'
import { resolve } from 'path'
import { newsCollectorSchema } from '../domain/news/config.js'

const CONFIG_DIR = resolve('data/config')

// ==================== Individual Schemas ====================

const engineSchema = z.object({
  pairs: z.array(z.string()).min(1).default(['BTC/USD', 'ETH/USD', 'SOL/USD']),
  interval: z.number().int().positive().default(5000),
  port: z.number().int().positive().default(3000),
})

export const aiProviderSchema = z.object({
  backend: z.enum(['claude-code', 'vercel-ai-sdk', 'agent-sdk']).default('claude-code'),
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-sonnet-4-6'),
  baseUrl: z.string().min(1).optional(),
  apiKeys: z.object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    google: z.string().optional(),
  }).default({}),
})

const agentSchema = z.object({
  maxSteps: z.number().int().positive().default(20),
  evolutionMode: z.boolean().default(false),
  claudeCode: z.object({
    allowedTools: z.array(z.string()).optional(),
    disallowedTools: z.array(z.string()).default([
      'Task', 'TaskOutput',
      'AskUserQuestion', 'TodoWrite',
      'NotebookEdit', 'Skill',
      'EnterPlanMode', 'ExitPlanMode',
      'mcp__claude_ai_Figma__*',
    ]),
    maxTurns: z.number().int().positive().default(20),
  }).default({
    disallowedTools: [
      'Task', 'TaskOutput',
      'AskUserQuestion', 'TodoWrite',
      'NotebookEdit', 'Skill',
      'EnterPlanMode', 'ExitPlanMode',
      'mcp__claude_ai_Figma__*',
    ],
    maxTurns: 20,
  }),
})

const cryptoSchema = z.object({
  provider: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('ccxt'),
      exchange: z.string(),
      apiKey: z.string().optional(),
      apiSecret: z.string().optional(),
      password: z.string().optional(),
      sandbox: z.boolean().default(false),
      demoTrading: z.boolean().default(false),
      defaultMarketType: z.enum(['spot', 'swap']).default('swap'),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
    z.object({
      type: z.literal('none'),
    }),
  ]).default({
    type: 'ccxt', exchange: 'binance', sandbox: false, demoTrading: true, defaultMarketType: 'swap',
  }),
  guards: z.array(z.object({
    type: z.string(),
    options: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
})

const securitiesSchema = z.object({
  provider: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('alpaca'),
      apiKey: z.string().optional(),
      secretKey: z.string().optional(),
      paper: z.boolean().default(true),
    }),
    z.object({
      type: z.literal('none'),
    }),
  ]).default({ type: 'alpaca', paper: true }),
  guards: z.array(z.object({
    type: z.string(),
    options: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
})

const marketDataSchema = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().default('http://localhost:6900'),
  providers: z.object({
    equity: z.string().default('yfinance'),
    crypto: z.string().default('yfinance'),
    currency: z.string().default('yfinance'),
  }).default({
    equity: 'yfinance',
    crypto: 'yfinance',
    currency: 'yfinance',
  }),
  providerKeys: z.object({
    fred: z.string().optional(),
    fmp: z.string().optional(),
    eia: z.string().optional(),
    bls: z.string().optional(),
    nasdaq: z.string().optional(),
    tradingeconomics: z.string().optional(),
    econdb: z.string().optional(),
    intrinio: z.string().optional(),
    benzinga: z.string().optional(),
    tiingo: z.string().optional(),
    biztoc: z.string().optional(),
  }).default({}),
  backend: z.enum(['typebb-sdk', 'openbb-api']).default('typebb-sdk'),
  apiServer: z.object({
    enabled: z.boolean().default(true),
    port: z.number().int().min(1024).max(65535).default(6901),
  }).default({ enabled: true, port: 6901 }),
})

const compactionSchema = z.object({
  maxContextTokens: z.number().default(200_000),
  maxOutputTokens: z.number().default(20_000),
  autoCompactBuffer: z.number().default(13_000),
  microcompactKeepRecent: z.number().default(3),
})

const activeHoursSchema = z.object({
  start: z.string().regex(/^\d{1,2}:\d{2}$/, 'Expected HH:MM format'),
  end: z.string().regex(/^\d{1,2}:\d{2}$/, 'Expected HH:MM format'),
  timezone: z.string().default('local'),
}).nullable().default(null)


const connectorsSchema = z.object({
  web: z.object({ port: z.number().int().positive().default(3002) }).default({ port: 3002 }),
  mcp: z.object({
    port: z.number().int().positive().default(3001),
  }).default({ port: 3001 }),
  mcpAsk: z.object({
    enabled: z.boolean().default(false),
    port: z.number().int().positive().optional(),
  }).default({ enabled: false }),
  telegram: z.object({
    enabled: z.boolean().default(false),
    botToken: z.string().optional(),
    botUsername: z.string().optional(),
    chatIds: z.array(z.number()).default([]),
  }).default({ enabled: false, chatIds: [] }),
})

const heartbeatSchema = z.object({
  enabled: z.boolean().default(false),
  every: z.string().default('30m'),
  prompt: z.string().default('Read data/brain/heartbeat.md (or data/default/heartbeat.default.md if not found) and follow the instructions inside.'),
  activeHours: activeHoursSchema,
})

export const toolsSchema = z.object({
  /** Tool names that are disabled. Tools not listed are enabled by default. */
  disabled: z.array(z.string()).default([]),
})

/** Vercel AI SDK model override — per-channel provider/model/key/endpoint. */
export const vercelAiSdkOverrideSchema = z.object({
  provider: z.string(),
  model: z.string(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
})

/** Agent SDK model override — per-channel model/key/endpoint. */
export const agentSdkOverrideSchema = z.object({
  model: z.string().optional(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
})

export const webSubchannelSchema = z.object({
  /** URL-safe identifier. Used as session path segment: data/sessions/web/{id}.jsonl */
  id: z.string().regex(/^[a-z0-9-_]+$/, 'id must be lowercase alphanumeric with hyphens/underscores'),
  label: z.string().min(1),
  /** System prompt override for this channel. */
  systemPrompt: z.string().optional(),
  /** AI backend override. Falls back to global config if omitted. */
  provider: z.enum(['claude-code', 'vercel-ai-sdk', 'agent-sdk']).optional(),
  /** Vercel AI SDK model override. Only used when provider is 'vercel-ai-sdk'. */
  vercelAiSdk: vercelAiSdkOverrideSchema.optional(),
  /** Agent SDK model override. Only used when provider is 'agent-sdk'. */
  agentSdk: agentSdkOverrideSchema.optional(),
  /** Tool names to disable in addition to the global disabled list. */
  disabledTools: z.array(z.string()).optional(),
})

export const webSubchannelsSchema = z.array(webSubchannelSchema)

export type WebChannel = z.infer<typeof webSubchannelSchema>

// ==================== Platform + Account Config ====================

const guardConfigSchema = z.object({
  type: z.string(),
  options: z.record(z.string(), z.unknown()).default({}),
})

const ccxtPlatformSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  type: z.literal('ccxt'),
  exchange: z.string(),
  sandbox: z.boolean().default(false),
  demoTrading: z.boolean().default(false),
  defaultMarketType: z.enum(['spot', 'swap']).default('swap'),
  options: z.record(z.string(), z.unknown()).optional(),
})

const alpacaPlatformSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  type: z.literal('alpaca'),
  paper: z.boolean().default(true),
})

export const platformConfigSchema = z.discriminatedUnion('type', [
  ccxtPlatformSchema,
  alpacaPlatformSchema,
])

export const platformsFileSchema = z.array(platformConfigSchema)

export const accountConfigSchema = z.object({
  id: z.string(),
  platformId: z.string(),
  label: z.string().optional(),
  apiKey: z.string().optional(),
  apiSecret: z.string().optional(),
  password: z.string().optional(),
  guards: z.array(guardConfigSchema).default([]),
})

export const accountsFileSchema = z.array(accountConfigSchema)

export type PlatformConfig = z.infer<typeof platformConfigSchema>
export type AccountConfig = z.infer<typeof accountConfigSchema>

// ==================== Unified Config Type ====================

export type Config = {
  engine: z.infer<typeof engineSchema>
  agent: z.infer<typeof agentSchema>
  crypto: z.infer<typeof cryptoSchema>
  securities: z.infer<typeof securitiesSchema>
  marketData: z.infer<typeof marketDataSchema>
  compaction: z.infer<typeof compactionSchema>
  aiProvider: z.infer<typeof aiProviderSchema>
  heartbeat: z.infer<typeof heartbeatSchema>
  connectors: z.infer<typeof connectorsSchema>
  news: z.infer<typeof newsCollectorSchema>
  tools: z.infer<typeof toolsSchema>
}

// ==================== Loader ====================

/** Read a JSON config file. Returns undefined if file does not exist. */
async function loadJsonFile(filename: string): Promise<unknown | undefined> {
  try {
    return JSON.parse(await readFile(resolve(CONFIG_DIR, filename), 'utf-8'))
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined
    }
    throw err
  }
}

/** Silently remove a config file (ignore if missing). */
async function removeJsonFile(filename: string): Promise<void> {
  try { await unlink(resolve(CONFIG_DIR, filename)) } catch { /* ENOENT ok */ }
}

/** Parse with Zod; if the file was missing, seed it to disk with defaults. */
async function parseAndSeed<T>(filename: string, schema: z.ZodType<T>, raw: unknown | undefined): Promise<T> {
  const parsed = schema.parse(raw ?? {})
  if (raw === undefined) {
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, filename), JSON.stringify(parsed, null, 2) + '\n')
  }
  return parsed
}

export async function loadConfig(): Promise<Config> {
  const files = ['engine.json', 'agent.json', 'crypto.json', 'securities.json', 'market-data.json', 'compaction.json', 'ai-provider-manager.json', 'heartbeat.json', 'connectors.json', 'news.json', 'tools.json'] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))

  // TODO: remove all migration blocks before v1.0 — no stable release yet, breaking changes are fine
  // ---------- Migration: consolidate old ai-provider + model + api-keys → ai-provider ----------
  const aiProviderRaw = raws[6] as Record<string, unknown> | undefined
  if (aiProviderRaw && !('backend' in aiProviderRaw)) {
    // Old format detected — merge model.json + api-keys.json into ai-provider-manager.json
    const oldModel = await loadJsonFile('model.json') as Record<string, unknown> | undefined
    const oldKeys = await loadJsonFile('api-keys.json') as Record<string, unknown> | undefined
    const migrated = {
      backend: aiProviderRaw.provider ?? 'claude-code',
      provider: oldModel?.provider ?? 'anthropic',
      model: oldModel?.model ?? 'claude-sonnet-4-6',
      ...(oldModel?.baseUrl ? { baseUrl: oldModel.baseUrl } : {}),
      apiKeys: oldKeys ?? {},
    }
    raws[6] = migrated
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(migrated, null, 2) + '\n')
    await removeJsonFile('model.json')
    await removeJsonFile('api-keys.json')
  }

  // ---------- Migration: consolidate old telegram.json + engine port fields ----------
  const connectorsRaw = raws[8] as Record<string, unknown> | undefined
  if (connectorsRaw === undefined) {
    const oldTelegram = await loadJsonFile('telegram.json')
    const oldEngine = raws[0] as Record<string, unknown> | undefined
    const migrated: Record<string, unknown> = {}
    if (oldTelegram && typeof oldTelegram === 'object') {
      migrated.telegram = { ...(oldTelegram as Record<string, unknown>), enabled: true }
    }
    if (oldEngine) {
      if (oldEngine.webPort !== undefined) migrated.web = { port: oldEngine.webPort }
      if (oldEngine.mcpPort !== undefined) migrated.mcp = { port: oldEngine.mcpPort }
      if (oldEngine.askMcpPort !== undefined) migrated.mcpAsk = { enabled: true, port: oldEngine.askMcpPort }
      const { mcpPort: _m, askMcpPort: _a, webPort: _w, ...cleanEngine } = oldEngine
      raws[0] = cleanEngine
      await mkdir(CONFIG_DIR, { recursive: true })
      await writeFile(resolve(CONFIG_DIR, 'engine.json'), JSON.stringify(cleanEngine, null, 2) + '\n')
    }
    raws[8] = Object.keys(migrated).length > 0 ? migrated : undefined
  }

  return {
    engine:        await parseAndSeed(files[0], engineSchema, raws[0]),
    agent:         await parseAndSeed(files[1], agentSchema, raws[1]),
    crypto:        await parseAndSeed(files[2], cryptoSchema, raws[2]),
    securities:    await parseAndSeed(files[3], securitiesSchema, raws[3]),
    marketData:    await parseAndSeed(files[4], marketDataSchema, raws[4]),
    compaction:    await parseAndSeed(files[5], compactionSchema, raws[5]),
    aiProvider:    await parseAndSeed(files[6], aiProviderSchema, raws[6]),
    heartbeat:     await parseAndSeed(files[7], heartbeatSchema, raws[7]),
    connectors:    await parseAndSeed(files[8], connectorsSchema, raws[8]),
    news:          await parseAndSeed(files[9], newsCollectorSchema, raws[9]),
    tools:         await parseAndSeed(files[10], toolsSchema, raws[10]),
  }
}

// ==================== Trading Config Loader ====================

/**
 * Load platform + account config.
 * Prefers platforms.json + accounts.json. Falls back to legacy crypto.json + securities.json.
 */
export async function loadTradingConfig(): Promise<{
  platforms: PlatformConfig[]
  accounts: AccountConfig[]
}> {
  const [rawPlatforms, rawAccounts] = await Promise.all([
    loadJsonFile('platforms.json'),
    loadJsonFile('accounts.json'),
  ])

  if (rawPlatforms !== undefined && rawAccounts !== undefined) {
    return {
      platforms: platformsFileSchema.parse(rawPlatforms),
      accounts: accountsFileSchema.parse(rawAccounts),
    }
  }

  // Migration: derive from legacy crypto.json + securities.json
  return migrateLegacyTradingConfig()
}

/** Derive platform+account config from old crypto.json + securities.json, then write to disk.
 *  TODO: remove before v1.0 — drop crypto.json/securities.json support entirely */
async function migrateLegacyTradingConfig(): Promise<{
  platforms: PlatformConfig[]
  accounts: AccountConfig[]
}> {
  const [rawCrypto, rawSecurities] = await Promise.all([
    loadJsonFile('crypto.json'),
    loadJsonFile('securities.json'),
  ])

  const crypto = cryptoSchema.parse(rawCrypto ?? {})
  const securities = securitiesSchema.parse(rawSecurities ?? {})

  const platforms: PlatformConfig[] = []
  const accounts: AccountConfig[] = []

  if (crypto.provider.type === 'ccxt') {
    const p = crypto.provider
    const platformId = `${p.exchange}-platform`
    platforms.push({
      id: platformId,
      type: 'ccxt',
      exchange: p.exchange,
      sandbox: p.sandbox,
      demoTrading: p.demoTrading,
      defaultMarketType: p.defaultMarketType,
      options: p.options,
    })
    accounts.push({
      id: `${p.exchange}-main`,
      platformId,
      apiKey: p.apiKey,
      apiSecret: p.apiSecret,
      password: p.password,
      guards: crypto.guards,
    })
  }

  if (securities.provider.type === 'alpaca') {
    const p = securities.provider
    const platformId = 'alpaca-platform'
    platforms.push({
      id: platformId,
      type: 'alpaca',
      paper: p.paper,
    })
    accounts.push({
      id: p.paper ? 'alpaca-paper' : 'alpaca-live',
      platformId,
      apiKey: p.apiKey,
      apiSecret: p.secretKey,
      guards: securities.guards,
    })
  }

  // Seed to disk so the user can edit the new format directly
  await mkdir(CONFIG_DIR, { recursive: true })
  await Promise.all([
    writeFile(resolve(CONFIG_DIR, 'platforms.json'), JSON.stringify(platforms, null, 2) + '\n'),
    writeFile(resolve(CONFIG_DIR, 'accounts.json'), JSON.stringify(accounts, null, 2) + '\n'),
  ])

  return { platforms, accounts }
}

// ==================== Platform / Account file helpers ====================

export async function readPlatformsConfig(): Promise<PlatformConfig[]> {
  const raw = await loadJsonFile('platforms.json')
  return platformsFileSchema.parse(raw ?? [])
}

export async function writePlatformsConfig(platforms: PlatformConfig[]): Promise<void> {
  const validated = platformsFileSchema.parse(platforms)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'platforms.json'), JSON.stringify(validated, null, 2) + '\n')
}

export async function readAccountsConfig(): Promise<AccountConfig[]> {
  const raw = await loadJsonFile('accounts.json')
  return accountsFileSchema.parse(raw ?? [])
}

export async function writeAccountsConfig(accounts: AccountConfig[]): Promise<void> {
  const validated = accountsFileSchema.parse(accounts)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'accounts.json'), JSON.stringify(validated, null, 2) + '\n')
}

// ==================== Hot-read helpers ====================

/** Read agent config from disk (called per-request for hot-reload). */
export async function readAgentConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'agent.json'), 'utf-8'))
    return agentSchema.parse(raw)
  } catch {
    return agentSchema.parse({})
  }
}

/** Read AI provider config from disk (called per-request for hot-reload). */
export async function readAIProviderConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), 'utf-8'))
    return aiProviderSchema.parse(raw)
  } catch {
    return aiProviderSchema.parse({})
  }
}

/** Read market data config from disk (called per-request for hot-reload). */
export async function readMarketDataConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'market-data.json'), 'utf-8'))
    return marketDataSchema.parse(raw)
  } catch {
    return marketDataSchema.parse({})
  }
}

/** Read tools config from disk (called per-request for hot-reload). */
export async function readToolsConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'tools.json'), 'utf-8'))
    return toolsSchema.parse(raw)
  } catch {
    return toolsSchema.parse({})
  }
}

// ==================== AI Backend Helpers ====================

export type AIBackend = 'claude-code' | 'vercel-ai-sdk' | 'agent-sdk'

/** Read the current AI backend from ai-provider-manager.json. */
export async function readAIBackend(): Promise<{ backend: AIBackend }> {
  const config = await readAIProviderConfig()
  return { backend: config.backend }
}

/** Switch the AI backend in ai-provider-manager.json (preserves other fields). */
export async function writeAIBackend(backend: AIBackend): Promise<void> {
  const current = await readAIProviderConfig()
  const updated = { ...current, backend }
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(updated, null, 2) + '\n')
}

// ==================== Writer ====================

export type ConfigSection = keyof Config

const sectionSchemas: Record<ConfigSection, z.ZodTypeAny> = {
  engine: engineSchema,
  agent: agentSchema,
  crypto: cryptoSchema,
  securities: securitiesSchema,
  marketData: marketDataSchema,
  compaction: compactionSchema,
  aiProvider: aiProviderSchema,
  heartbeat: heartbeatSchema,
  connectors: connectorsSchema,
  news: newsCollectorSchema,
  tools: toolsSchema,
}

const sectionFiles: Record<ConfigSection, string> = {
  engine: 'engine.json',
  agent: 'agent.json',
  crypto: 'crypto.json',
  securities: 'securities.json',
  marketData: 'market-data.json',
  compaction: 'compaction.json',
  aiProvider: 'ai-provider-manager.json',
  heartbeat: 'heartbeat.json',
  connectors: 'connectors.json',
  news: 'news.json',
  tools: 'tools.json',
}

/** All valid config section names (derived from sectionSchemas). */
export const validSections = Object.keys(sectionSchemas) as ConfigSection[]

/** Validate and write a config section to disk. Returns the validated config. */
export async function writeConfigSection(section: ConfigSection, data: unknown): Promise<unknown> {
  const schema = sectionSchemas[section]
  const validated = schema.parse(data)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, sectionFiles[section]), JSON.stringify(validated, null, 2) + '\n')
  return validated
}

/** Read web sub-channel definitions from disk. Returns empty array if file missing. */
export async function readWebSubchannels(): Promise<WebChannel[]> {
  const raw = await loadJsonFile('web-subchannels.json')
  return webSubchannelsSchema.parse(raw ?? [])
}

/** Write web sub-channel definitions to disk. */
export async function writeWebSubchannels(channels: WebChannel[]): Promise<void> {
  const validated = webSubchannelsSchema.parse(channels)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'web-subchannels.json'), JSON.stringify(validated, null, 2) + '\n')
}
