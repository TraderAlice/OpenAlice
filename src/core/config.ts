import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

const CONFIG_DIR = resolve('data/config')

// ==================== Individual Schemas ====================

const engineSchema = z.object({
  pairs: z.array(z.string()).min(1).default(['BTC/USD', 'ETH/USD', 'SOL/USD']),
  interval: z.number().int().positive().default(5000),
  port: z.number().int().positive().default(3000),
  mcpPort: z.number().int().positive().optional(),
  askMcpPort: z.number().int().positive().optional(),
  webPort: z.number().int().positive().default(3002),
  timeframe: z.string().default('1h'),
  dataRefreshInterval: z.number().int().positive().default(600_000),
})

const modelSchema = z.object({
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-sonnet-4-5-20250929'),
})

const agentSchema = z.object({
  maxSteps: z.number().int().positive().default(20),
  evolutionMode: z.boolean().default(false),
  claudeCode: z.object({
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
      sandbox: z.boolean().default(false),
      demoTrading: z.boolean().default(false),
      defaultMarketType: z.enum(['spot', 'swap']).default('swap'),
      options: z.record(z.string(), z.unknown()).optional(),
    }),
    z.object({
      type: z.literal('none'),
    }),
  ]).default({ type: 'none' }),
})

const securitiesSchema = z.object({
  allowedSymbols: z.array(z.string()).default([]),
  provider: z.discriminatedUnion('type', [
    z.object({
      type: z.literal('alpaca'),
      paper: z.boolean().default(true),
    }),
    z.object({
      type: z.literal('none'),
    }),
  ]).default({ type: 'none' }),
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
  compaction: z.infer<typeof compactionSchema>
  heartbeat: z.infer<typeof heartbeatSchema>
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
  const files = ['engine.json', 'model.json', 'agent.json', 'crypto.json', 'securities.json', 'compaction.json', 'heartbeat.json'] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))

  return {
    engine:     await parseAndSeed(files[0], engineSchema, raws[0]),
    model:      await parseAndSeed(files[1], modelSchema, raws[1]),
    agent:      await parseAndSeed(files[2], agentSchema, raws[2]),
    crypto:     await parseAndSeed(files[3], cryptoSchema, raws[3]),
    securities: await parseAndSeed(files[4], securitiesSchema, raws[4]),
    compaction: await parseAndSeed(files[5], compactionSchema, raws[5]),
    heartbeat:  await parseAndSeed(files[6], heartbeatSchema, raws[6]),
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
  compaction: compactionSchema,
  heartbeat: heartbeatSchema,
}

const sectionFiles: Record<ConfigSection, string> = {
  engine: 'engine.json',
  model: 'model.json',
  agent: 'agent.json',
  crypto: 'crypto.json',
  securities: 'securities.json',
  compaction: 'compaction.json',
  heartbeat: 'heartbeat.json',
}

/** Validate and write a config section to disk. Returns the validated config. */
export async function writeConfigSection(section: ConfigSection, data: unknown): Promise<unknown> {
  const schema = sectionSchemas[section]
  const validated = schema.parse(data)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, sectionFiles[section]), JSON.stringify(validated, null, 2) + '\n')
  return validated
}
