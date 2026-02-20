import { z } from 'zod'
import { readFile, writeFile, mkdir } from 'fs/promises'
import { resolve } from 'path'

const CONFIG_DIR = resolve('data/config')

// ==================== Individual Schemas ====================

const engineSchema = z.object({
  pairs: z.array(z.string()).min(1),
  interval: z.number().int().positive().default(5000),
  port: z.number().int().positive().default(3000),
  mcpPort: z.number().int().positive().optional(),
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
  claudeCode: z.object({
    allowedTools: z.array(z.string()).default(['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch']),
    disallowedTools: z.array(z.string()).default([
      'Task', 'TaskOutput',
      'AskUserQuestion', 'TodoWrite',
      'NotebookEdit', 'Skill',
      'EnterPlanMode', 'ExitPlanMode',
      'mcp__claude_ai_Figma__*',
    ]),
    maxTurns: z.number().int().positive().default(20),
  }).default({
    allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep', 'WebSearch', 'WebFetch'],
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
  prompt: z.string().default('Check if anything needs attention. If nothing to report, reply HEARTBEAT_OK.'),
  ackToken: z.string().default('HEARTBEAT_OK'),
  ackMaxChars: z.number().default(300),
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

async function loadJsonFile(filename: string): Promise<unknown> {
  try {
    const raw = await readFile(resolve(CONFIG_DIR, filename), 'utf-8')
    return JSON.parse(raw)
  } catch (err: unknown) {
    if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return {} // File not found → use defaults from Zod schema
    }
    throw err
  }
}

export async function loadConfig(): Promise<Config> {
  const [engineRaw, modelRaw, agentRaw, cryptoRaw, securitiesRaw, compactionRaw, heartbeatRaw] = await Promise.all([
    loadJsonFile('engine.json'),
    loadJsonFile('model.json'),
    loadJsonFile('agent.json'),
    loadJsonFile('crypto.json'),
    loadJsonFile('securities.json'),
    loadJsonFile('compaction.json'),
    loadJsonFile('heartbeat.json'),
  ])

  return {
    engine: engineSchema.parse(engineRaw),
    model: modelSchema.parse(modelRaw),
    agent: agentSchema.parse(agentRaw),
    crypto: cryptoSchema.parse(cryptoRaw),
    securities: securitiesSchema.parse(securitiesRaw),
    compaction: compactionSchema.parse(compactionRaw),
    heartbeat: heartbeatSchema.parse(heartbeatRaw),
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
