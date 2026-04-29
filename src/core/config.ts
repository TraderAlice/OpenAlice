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

// ==================== AI Provider: Legacy Schema (kept for migration) ====================

const legacyLoginMethodSchema = z.enum(['api-key', 'claudeai', 'codex-oauth'])

/** @deprecated Legacy flat schema — used only for migration detection. */
export const aiProviderLegacySchema = z.object({
  backend: z.enum(['claude-code', 'vercel-ai-sdk', 'agent-sdk', 'codex']).default('claude-code'),
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-opus-4-7'),
  baseUrl: z.string().min(1).optional(),
  loginMethod: legacyLoginMethodSchema.default('api-key'),
  apiKeys: z.object({
    anthropic: z.string().optional(),
    openai: z.string().optional(),
    google: z.string().optional(),
  }).default({}),
})

// ==================== AI Provider: Profile-based Schema ====================

export type AIBackend = 'agent-sdk' | 'codex' | 'vercel-ai-sdk'

const apiKeysSchema = z.object({
  anthropic: z.string().optional(),
  openai: z.string().optional(),
  google: z.string().optional(),
})

const baseProfileFields = {
  /** Preset ID this profile was created from (for constraint enforcement on edit). */
  preset: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
}

export const agentSdkProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('agent-sdk'),
  model: z.string().default('claude-opus-4-7'),
  loginMethod: z.enum(['api-key', 'claudeai']).default('api-key'),
})

export const codexProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('codex'),
  model: z.string().default('gpt-5.4'),
  loginMethod: z.enum(['api-key', 'codex-oauth']).default('codex-oauth'),
})

export const vercelProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('vercel-ai-sdk'),
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-opus-4-7'),
})

export const profileSchema = z.discriminatedUnion('backend', [
  agentSdkProfileSchema, codexProfileSchema, vercelProfileSchema,
])

export type Profile = z.infer<typeof profileSchema>

export const aiProviderSchema = z.object({
  apiKeys: apiKeysSchema.default({}),
  profiles: z.record(
    z.string(),
    profileSchema,
  ).default({
    default: { backend: 'agent-sdk', model: 'claude-opus-4-7', loginMethod: 'claudeai' },
  }),
  activeProfile: z.string().default('default'),
})

export type AIProviderConfig = z.infer<typeof aiProviderSchema>

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
      options: z.record(z.string(), z.unknown()).optional(),
    }).passthrough(),
    z.object({
      type: z.literal('none'),
    }),
  ]).default({ type: 'none' }),
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
  ]).default({ type: 'none' }),
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
    commodity: z.string().default('yfinance'),
  }).default({
    equity: 'yfinance',
    crypto: 'yfinance',
    currency: 'yfinance',
    commodity: 'yfinance',
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
  prompt: z.string().default('Read data/brain/heartbeat.md (or default/heartbeat.default.md if not found) and follow the instructions inside.'),
  activeHours: activeHoursSchema,
})

const snapshotSchema = z.object({
  enabled: z.boolean().default(true),
  every: z.string().default('15m'),
})

export const toolsSchema = z.object({
  /** Tool names that are disabled. Tools not listed are enabled by default. */
  disabled: z.array(z.string()).default([]),
})

const webhookTokenSchema = z.object({
  /** Human-readable label (used in logs / admin UI; not a secret). */
  id: z.string().min(1),
  /** The bearer secret. Opaque string — treat as high-entropy. */
  token: z.string().min(1),
  /** Epoch ms when created. Metadata only, used for rotation. */
  createdAt: z.number().int().nonnegative().default(() => Date.now()),
})

export const webhookSchema = z.object({
  /** List of accepted bearer tokens for POST /api/events/ingest. Empty = endpoint rejects everything (503). */
  tokens: z.array(webhookTokenSchema).default([]),
})

export type WebhookToken = z.infer<typeof webhookTokenSchema>
export type WebhookConfig = z.infer<typeof webhookSchema>

export const webSubchannelSchema = z.object({
  /** URL-safe identifier. Used as session path segment: data/sessions/web/{id}.jsonl */
  id: z.string().regex(/^[a-z0-9-_]+$/, 'id must be lowercase alphanumeric with hyphens/underscores'),
  label: z.string().min(1),
  /** System prompt override for this channel. */
  systemPrompt: z.string().optional(),
  /** AI provider profile slug. Falls back to global activeProfile if omitted. */
  profile: z.string().optional(),
  /** Tool names to disable in addition to the global disabled list. */
  disabledTools: z.array(z.string()).optional(),
})

export const webSubchannelsSchema = z.array(webSubchannelSchema)

export type WebChannel = z.infer<typeof webSubchannelSchema>

// ==================== Account Config ====================

const guardConfigSchema = z.object({
  type: z.string(),
  options: z.record(z.string(), z.unknown()).default({}),
})

export const accountConfigSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  /** Broker preset id — resolves to engine + form schema via BROKER_PRESET_CATALOG. */
  presetId: z.string(),
  enabled: z.boolean().default(true),
  guards: z.array(guardConfigSchema).default([]),
  /** User-filled form values, validated against the preset's own zodSchema. */
  presetConfig: z.record(z.string(), z.unknown()).default({}),
})

export const accountsFileSchema = z.array(accountConfigSchema)

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
  snapshot: z.infer<typeof snapshotSchema>
  connectors: z.infer<typeof connectorsSchema>
  news: z.infer<typeof newsCollectorSchema>
  tools: z.infer<typeof toolsSchema>
  webhook: z.infer<typeof webhookSchema>
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
  const files = ['engine.json', 'agent.json', 'crypto.json', 'securities.json', 'market-data.json', 'compaction.json', 'ai-provider-manager.json', 'heartbeat.json', 'snapshot.json', 'connectors.json', 'news.json', 'tools.json', 'webhook.json'] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))

  // TODO: remove all migration blocks before v1.0 — no stable release yet, breaking changes are fine
  // ---------- Migration: flat ai-provider config → profile-based ----------
  const aiProviderRaw = raws[6] as Record<string, unknown> | undefined
  if (aiProviderRaw && 'backend' in aiProviderRaw && !('profiles' in aiProviderRaw)) {
    // Legacy flat format detected — convert to profile-based

    // Step 1: handle very old format (model.json + api-keys.json)
    if (!('model' in aiProviderRaw)) {
      const oldModel = await loadJsonFile('model.json') as Record<string, unknown> | undefined
      const oldKeys = await loadJsonFile('api-keys.json') as Record<string, unknown> | undefined
      if (oldModel) Object.assign(aiProviderRaw, { provider: oldModel.provider, model: oldModel.model, ...(oldModel.baseUrl ? { baseUrl: oldModel.baseUrl } : {}) })
      if (oldKeys) aiProviderRaw.apiKeys = oldKeys
      await removeJsonFile('model.json')
      await removeJsonFile('api-keys.json')
    }

    // Step 2: handle claude-code → agent-sdk alias
    if (aiProviderRaw.backend === 'claude-code') {
      aiProviderRaw.backend = 'agent-sdk'
      aiProviderRaw.loginMethod = aiProviderRaw.loginMethod ?? 'claudeai'
    }

    // Step 3: build default profile from flat config
    const legacy = aiProviderLegacySchema.parse(aiProviderRaw)
    const defaultProfile: Record<string, unknown> = { label: 'Default' }
    if (legacy.backend === 'agent-sdk') {
      defaultProfile.backend = 'agent-sdk'
      defaultProfile.model = legacy.model
      defaultProfile.loginMethod = legacy.loginMethod === 'codex-oauth' ? 'api-key' : legacy.loginMethod
    } else if (legacy.backend === 'codex') {
      defaultProfile.backend = 'codex'
      defaultProfile.model = legacy.model
      defaultProfile.loginMethod = legacy.loginMethod === 'claudeai' ? 'codex-oauth' : legacy.loginMethod
    } else {
      defaultProfile.backend = 'vercel-ai-sdk'
      defaultProfile.provider = legacy.provider
      defaultProfile.model = legacy.model
    }
    if (legacy.baseUrl) defaultProfile.baseUrl = legacy.baseUrl

    // Step 4: migrate subchannel inline overrides → named profiles
    const oldSubchannels = await loadJsonFile('web-subchannels.json') as Array<Record<string, unknown>> | undefined
    const profiles: Record<string, unknown> = { default: defaultProfile }
    const newSubchannels: Array<Record<string, unknown>> = []

    if (oldSubchannels) {
      for (const ch of oldSubchannels) {
        const sub: Record<string, unknown> = { id: ch.id, label: ch.label }
        if (ch.systemPrompt) sub.systemPrompt = ch.systemPrompt
        if (ch.disabledTools) sub.disabledTools = ch.disabledTools

        const provider = ch.provider as string | undefined
        const override = provider === 'vercel-ai-sdk' ? ch.vercelAiSdk
          : provider === 'agent-sdk' ? ch.agentSdk
          : provider === 'codex' ? ch.codex
          : undefined

        if (provider && override) {
          const slug = `${ch.id}-${provider}`
          profiles[slug] = { backend: provider, label: `${ch.label}`, ...(override as object) }
          sub.profile = slug
        } else if (provider) {
          // Provider set but no override — create a profile with just the backend
          const slug = `${ch.id}-${provider}`
          profiles[slug] = { ...defaultProfile, backend: provider, label: `${ch.label}` }
          sub.profile = slug
        }

        newSubchannels.push(sub)
      }
      await writeFile(resolve(CONFIG_DIR, 'web-subchannels.json'), JSON.stringify(newSubchannels, null, 2) + '\n')
    }

    // Step 5: write new format
    const migrated = { apiKeys: legacy.apiKeys, profiles, activeProfile: 'default' }
    raws[6] = migrated
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(migrated, null, 2) + '\n')
  } else if (aiProviderRaw && !('backend' in aiProviderRaw) && !('profiles' in aiProviderRaw)) {
    // Very old format (no backend, no profiles) — handle model.json merge first
    const oldModel = await loadJsonFile('model.json') as Record<string, unknown> | undefined
    const oldKeys = await loadJsonFile('api-keys.json') as Record<string, unknown> | undefined
    const migrated = {
      apiKeys: oldKeys ?? {},
      profiles: {
        default: {
          backend: 'agent-sdk',
          label: 'Default',
          model: (oldModel?.model as string) ?? 'claude-opus-4-7',
          loginMethod: 'claudeai',
          provider: (oldModel?.provider as string) ?? 'anthropic',
        },
      },
      activeProfile: 'default',
    }
    raws[6] = migrated
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(migrated, null, 2) + '\n')
    await removeJsonFile('model.json')
    await removeJsonFile('api-keys.json')
  }

  // ---------- Migration: distribute global apiKeys into profiles ----------
  const aiConfigAfterMigration = raws[6] as Record<string, unknown> | undefined
  if (aiConfigAfterMigration && 'apiKeys' in aiConfigAfterMigration && 'profiles' in aiConfigAfterMigration) {
    const keys = aiConfigAfterMigration.apiKeys as Record<string, string> | undefined
    const profiles = aiConfigAfterMigration.profiles as Record<string, Record<string, unknown>>
    if (keys && Object.values(keys).some(Boolean)) {
      let changed = false
      for (const profile of Object.values(profiles)) {
        if (profile.apiKey) continue // already has a key, don't overwrite
        const vendor = profile.backend === 'codex' ? 'openai'
          : profile.backend === 'agent-sdk' ? 'anthropic'
          : (profile.provider as string) ?? 'anthropic'
        const globalKey = keys[vendor]
        if (globalKey) {
          profile.apiKey = globalKey
          changed = true
        }
      }
      if (changed) {
        delete aiConfigAfterMigration.apiKeys
        raws[6] = aiConfigAfterMigration
        await mkdir(CONFIG_DIR, { recursive: true })
        await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(aiConfigAfterMigration, null, 2) + '\n')
      }
    }
  }

  // ---------- Migration: consolidate old telegram.json + engine port fields ----------
  const connectorsRaw = raws[9] as Record<string, unknown> | undefined
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
    raws[9] = Object.keys(migrated).length > 0 ? migrated : undefined
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
    snapshot:      await parseAndSeed(files[8], snapshotSchema, raws[8]),
    connectors:    await parseAndSeed(files[9], connectorsSchema, raws[9]),
    news:          await parseAndSeed(files[10], newsCollectorSchema, raws[10]),
    tools:         await parseAndSeed(files[11], toolsSchema, raws[11]),
    webhook:       await parseAndSeed(files[12], webhookSchema, raws[12]),
  }
}

// ==================== Account Config Loader ====================

/** Single legacy record carries `type` (removed) without `presetId` (new). */
function isLegacyRecord(o: Record<string, unknown>): boolean {
  return typeof o['type'] === 'string' && typeof o['presetId'] !== 'string'
}

/**
 * Best-effort migration from the pre-preset shape ({type, brokerConfig})
 * to the preset shape ({presetId, presetConfig}).
 *
 * Returns null when the legacy record can't be mapped (unknown engine /
 * missing exchange) — caller logs and skips.
 *
 * TODO(v0.10 → v1.0): remove this migration once nobody is upgrading
 * from the pre-preset schema. Tracked alongside the AI-side migration
 * cleanup at the top of this file.
 */
function migrateLegacyAccount(raw: Record<string, unknown>): Record<string, unknown> | null {
  const id = String(raw['id'] ?? '')
  const label = raw['label'] as string | undefined
  const enabled = raw['enabled'] as boolean | undefined
  const guards = raw['guards'] as unknown[] | undefined
  const type = String(raw['type'] ?? '')
  const bc = (raw['brokerConfig'] ?? {}) as Record<string, unknown>

  const base = (presetId: string, presetConfig: Record<string, unknown>) => ({
    id,
    ...(label !== undefined && { label }),
    presetId,
    enabled: enabled ?? true,
    guards: guards ?? [],
    presetConfig,
  })

  // CCXT — derive preset from exchange + flags
  if (type === 'ccxt') {
    const exchange = String(bc['exchange'] ?? '').toLowerCase()
    const apiKey = bc['apiKey'] as string | undefined
    // Legacy used both `secret` and `apiSecret` (alias); new presets use `secret`.
    const secret = (bc['secret'] ?? bc['apiSecret']) as string | undefined
    const password = bc['password'] as string | undefined
    const sandbox = Boolean(bc['sandbox'])
    const demoTrading = Boolean(bc['demoTrading'])
    const walletAddress = bc['walletAddress'] as string | undefined
    const privateKey = bc['privateKey'] as string | undefined

    switch (exchange) {
      case 'okx':
        // OKX old configs that set demoTrading: true were broken (the engine
        // would set urls['api'] = undefined). We treat any non-live flag as
        // mode=demo so the migrated account actually works.
        return base('okx', {
          mode: (sandbox || demoTrading) ? 'demo' : 'live',
          ...(apiKey && { apiKey }),
          ...(secret && { secret }),
          ...(password && { password }),
        })
      case 'bybit':
        return base('bybit', {
          mode: sandbox ? 'testnet' : (demoTrading ? 'demo' : 'live'),
          ...(apiKey && { apiKey }),
          ...(secret && { secret }),
        })
      case 'hyperliquid':
        return base('hyperliquid', {
          mode: sandbox ? 'testnet' : 'live',
          ...(walletAddress && { walletAddress }),
          ...(privateKey && { privateKey }),
        })
      case 'bitget':
        return base('bitget', {
          mode: demoTrading ? 'demo' : 'live',
          ...(apiKey && { apiKey }),
          ...(secret && { secret }),
          ...(password && { password }),
        })
      default:
        // Unknown / untested exchange — keep functional via the escape hatch.
        if (!exchange) return null
        return base('ccxt-custom', {
          exchange,
          sandbox,
          demoTrading,
          ...(apiKey && { apiKey }),
          ...(secret && { secret }),
          ...(password && { password }),
          ...(walletAddress && { walletAddress }),
          ...(privateKey && { privateKey }),
        })
    }
  }

  if (type === 'alpaca') {
    return base('alpaca', {
      mode: bc['paper'] === false ? 'live' : 'paper',
      ...(bc['apiKey'] !== undefined && { apiKey: bc['apiKey'] }),
      ...(bc['apiSecret'] !== undefined && { apiSecret: bc['apiSecret'] }),
    })
  }

  if (type === 'ibkr') {
    return base('ibkr-tws', {
      ...(bc['host'] !== undefined && { host: bc['host'] }),
      ...(bc['port'] !== undefined && { port: bc['port'] }),
      ...(bc['clientId'] !== undefined && { clientId: bc['clientId'] }),
      ...(bc['accountId'] !== undefined && { accountId: bc['accountId'] }),
    })
  }

  return null
}

export async function readAccountsConfig(): Promise<AccountConfig[]> {
  const raw = await loadJsonFile('accounts.json')
  if (raw === undefined) {
    // Seed empty file on first run
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, 'accounts.json'), '[]\n')
    return []
  }

  // Auto-migrate the pre-preset shape ({type, brokerConfig}) into the
  // current shape ({presetId, presetConfig}). We back the original up
  // first (so a bad migration is never destructive) and write the
  // translated records to disk so subsequent reads skip this branch.
  if (Array.isArray(raw) && (raw as unknown[]).some((r) => isLegacyRecord(r as Record<string, unknown>))) {
    const backupPath = resolve(CONFIG_DIR, 'accounts.json.backup-pre-preset')
    await writeFile(backupPath, JSON.stringify(raw, null, 2) + '\n')

    const migrated: Record<string, unknown>[] = []
    const skipped: string[] = []
    for (const item of raw as Record<string, unknown>[]) {
      // Already in new shape — keep verbatim.
      if (!isLegacyRecord(item)) { migrated.push(item); continue }
      const next = migrateLegacyAccount(item)
      if (next) {
        migrated.push(next)
      } else {
        skipped.push(String(item['id'] ?? '<unknown>'))
      }
    }

    console.warn(
      `accounts.json: migrated ${migrated.length - skipped.length} legacy record(s) to preset shape ` +
      `(backup: ${backupPath}).` +
      (skipped.length ? ` Skipped (unknown engine, recreate manually): ${skipped.join(', ')}.` : ''),
    )

    const validated = accountsFileSchema.parse(migrated)
    await writeFile(resolve(CONFIG_DIR, 'accounts.json'), JSON.stringify(validated, null, 2) + '\n')
    return validated
  }

  return accountsFileSchema.parse(raw)
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

/** Read connectors config from disk (called per-request for hot-reload). */
export async function readConnectorsConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'connectors.json'), 'utf-8'))
    return connectorsSchema.parse(raw)
  } catch {
    return connectorsSchema.parse({})
  }
}

/** Read webhook config from disk (called per-request so token rotation
 *  takes effect without restart). */
export async function readWebhookConfig() {
  try {
    const raw = JSON.parse(await readFile(resolve(CONFIG_DIR, 'webhook.json'), 'utf-8'))
    return webhookSchema.parse(raw)
  } catch {
    return webhookSchema.parse({})
  }
}

// ==================== Profile Helpers ====================

/** Resolved profile — all fields needed by providers. */
export interface ResolvedProfile {
  backend: AIBackend
  model: string
  preset?: string
  apiKey?: string
  baseUrl?: string
  loginMethod?: string
  provider?: string
}

/** Resolve a profile by slug. API key comes from the profile directly. */
export async function resolveProfile(slug?: string): Promise<ResolvedProfile> {
  const config = await readAIProviderConfig()
  const key = slug ?? config.activeProfile
  const profile = config.profiles[key]
  if (!profile) throw new Error(`Unknown AI provider profile: "${key}"`)
  return { ...profile }
}

/** Get the active profile slug. */
export async function getActiveProfileSlug(): Promise<string> {
  const config = await readAIProviderConfig()
  return config.activeProfile
}

/** Set the active profile. */
export async function setActiveProfile(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  if (!config.profiles[slug]) throw new Error(`Unknown profile: "${slug}"`)
  const updated = { ...config, activeProfile: slug }
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(updated, null, 2) + '\n')
}

/** Write a single profile (create or update). */
export async function writeProfile(slug: string, profile: Profile): Promise<void> {
  const config = await readAIProviderConfig()
  config.profiles[slug] = profile
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
}

/** Delete a profile. Cannot delete the active profile. */
export async function deleteProfile(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  if (config.activeProfile === slug) throw new Error('Cannot delete the active profile')
  delete config.profiles[slug]
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
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
  snapshot: snapshotSchema,
  connectors: connectorsSchema,
  news: newsCollectorSchema,
  tools: toolsSchema,
  webhook: webhookSchema,
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
  snapshot: 'snapshot.json',
  connectors: 'connectors.json',
  news: 'news.json',
  tools: 'tools.json',
  webhook: 'webhook.json',
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
