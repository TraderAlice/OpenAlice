import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'
import { newsCollectorSchema } from '../extension/news-collector/config.js'

const CONFIG_DIR = resolve('data/config')

// ==================== Individual Schemas ====================

const engineSchema = z.object({
  pairs: z.array(z.string()).min(1).default(['BTC/USD', 'ETH/USD', 'SOL/USD']),
  interval: z.number().int().positive().default(5000),
  port: z.number().int().positive().default(3000),
})

const modelSchema = z.object({
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-sonnet-4-6'),
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
  allowedSymbols: z.array(z.string()).min(1).default([
    'BTC/USD', 'ETH/USD', 'SOL/USD', 'BNB/USD', 'APT/USD',
    'SUI/USD', 'HYPE/USD', 'DOGE/USD', 'XRP/USD',
  ]),
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
    type: 'ccxt', exchange: 'bybit', sandbox: false, demoTrading: true, defaultMarketType: 'swap',
    // Only load linear (USDT-margined) markets from ccxt.
    // Default is ['spot', 'linear', 'inverse', 'option'] — the extra categories
    // add unnecessary parallel requests during loadMarkets(), and any single failure
    // (common on bybit demo API) aborts the entire init.
    options: { fetchMarkets: { types: ['linear'] } },
  }),
  guards: z.array(z.object({
    type: z.string(),
    options: z.record(z.string(), z.unknown()).default({}),
  })).default([]),
})

const securitiesSchema = z.object({
  allowedSymbols: z.array(z.string()).default([
    'AAPL', 'MSFT', 'GOOGL', 'AMZN', 'NVDA', 'META', 'TSLA',
    'SPY', 'QQQ',
  ]),
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

const openbbSchema = z.object({
  enabled: z.boolean().default(true),
  apiUrl: z.string().default('http://localhost:6900'),
  providers: z.object({
    equity: z.string().default('yfinance'),
    crypto: z.string().default('yfinance'),
    currency: z.string().default('yfinance'),
    newsCompany: z.string().default('yfinance'),
    newsWorld: z.string().default('fmp'),
  }).default({
    equity: 'yfinance',
    crypto: 'yfinance',
    currency: 'yfinance',
    newsCompany: 'yfinance',
    newsWorld: 'fmp',
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

export const aiProviderSchema = z.object({
  provider: z.enum(['claude-code', 'vercel-ai-sdk']).default('claude-code'),
})

const apiKeysSchema = z.object({
  anthropic: z.string().optional(),
  openai: z.string().optional(),
  google: z.string().optional(),
})

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

// ==================== Unified Config Type ====================

export type Config = {
  engine: z.infer<typeof engineSchema>
  model: z.infer<typeof modelSchema>
  agent: z.infer<typeof agentSchema>
  crypto: z.infer<typeof cryptoSchema>
  securities: z.infer<typeof securitiesSchema>
  openbb: z.infer<typeof openbbSchema>
  compaction: z.infer<typeof compactionSchema>
  aiProvider: z.infer<typeof aiProviderSchema>
  heartbeat: z.infer<typeof heartbeatSchema>
  apiKeys: z.infer<typeof apiKeysSchema>
  connectors: z.infer<typeof connectorsSchema>
  newsCollector: z.infer<typeof newsCollectorSchema>
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
  const files = ['engine.json', 'model.json', 'agent.json', 'crypto.json', 'securities.json', 'openbb.json', 'compaction.json', 'ai-provider.json', 'heartbeat.json', 'api-keys.json', 'connectors.json', 'news-collector.json'] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))

  // ---------- Migration: consolidate old telegram.json + engine port fields ----------
  const connectorsRaw = raws[10] as Record<string, unknown> | undefined
  if (connectorsRaw === undefined) {
    // First load after upgrade — migrate from old locations
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
      // Strip migrated fields from engine.json
      const { mcpPort: _m, askMcpPort: _a, webPort: _w, ...cleanEngine } = oldEngine
      raws[0] = cleanEngine
      await mkdir(CONFIG_DIR, { recursive: true })
      await writeFile(resolve(CONFIG_DIR, 'engine.json'), JSON.stringify(cleanEngine, null, 2) + '\n')
    }
    raws[10] = Object.keys(migrated).length > 0 ? migrated : undefined
  }

  return {
    engine:     await parseAndSeed(files[0], engineSchema, raws[0]),
    model:      await parseAndSeed(files[1], modelSchema, raws[1]),
    agent:      await parseAndSeed(files[2], agentSchema, raws[2]),
    crypto:     await parseAndSeed(files[3], cryptoSchema, raws[3]),
    securities: await parseAndSeed(files[4], securitiesSchema, raws[4]),
    openbb:     await parseAndSeed(files[5], openbbSchema, raws[5]),
    compaction: await parseAndSeed(files[6], compactionSchema, raws[6]),
    aiProvider: await parseAndSeed(files[7], aiProviderSchema, raws[7]),
    heartbeat:  await parseAndSeed(files[8], heartbeatSchema, raws[8]),
    apiKeys:    await parseAndSeed(files[9], apiKeysSchema, raws[9]),
    connectors: await parseAndSeed(files[10], connectorsSchema, raws[10]),
    newsCollector: await parseAndSeed(files[11], newsCollectorSchema, raws[11]),
  }
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

/** Read model config from disk (called per-request for hot-reload). */
export async function readModelConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'model.json'), 'utf-8'))
    return modelSchema.parse(raw)
  } catch {
    return modelSchema.parse({})
  }
}

/** Read OpenBB config from disk (called per-request for hot-reload). */
export async function readOpenbbConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'openbb.json'), 'utf-8'))
    return openbbSchema.parse(raw)
  } catch {
    return openbbSchema.parse({})
  }
}

/** Read API keys config from disk (called per-request for hot-reload). */
export async function readApiKeysConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'api-keys.json'), 'utf-8'))
    return apiKeysSchema.parse(raw)
  } catch {
    return apiKeysSchema.parse({})
  }
}

// ==================== Writer ====================

export type ConfigSection = keyof Config

const sectionSchemas: Record<ConfigSection, z.ZodTypeAny> = {
  engine: engineSchema,
  model: modelSchema,
  agent: agentSchema,
  crypto: cryptoSchema,
  securities: securitiesSchema,
  openbb: openbbSchema,
  compaction: compactionSchema,
  aiProvider: aiProviderSchema,
  heartbeat: heartbeatSchema,
  apiKeys: apiKeysSchema,
  connectors: connectorsSchema,
  newsCollector: newsCollectorSchema,
}

const sectionFiles: Record<ConfigSection, string> = {
  engine: 'engine.json',
  model: 'model.json',
  agent: 'agent.json',
  crypto: 'crypto.json',
  securities: 'securities.json',
  openbb: 'openbb.json',
  compaction: 'compaction.json',
  aiProvider: 'ai-provider.json',
  heartbeat: 'heartbeat.json',
  apiKeys: 'api-keys.json',
  connectors: 'connectors.json',
  newsCollector: 'news-collector.json',
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
