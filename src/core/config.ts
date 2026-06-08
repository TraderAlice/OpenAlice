import { z } from 'zod'
import { readFile, writeFile, mkdir, unlink, rm } from 'fs/promises'
import { resolve } from 'path'
import { newsCollectorSchema } from '../domain/news/config.js'
import { runMigrations } from '../migrations/runner.js'
import { dataPath } from '@/core/paths.js'
import {
  inferVendor as inferVendorFromProfile,
  inferAuthType as inferAuthTypeFromProfile,
  hasExtractableCredential,
} from './credential-inference.js'

const CONFIG_DIR = dataPath('config')

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

// ==================== Credential layer (introduced by 0002) ====================

export const credentialVendorEnum = z.enum([
  'anthropic', 'openai', 'google',
  'minimax', 'glm', 'kimi', 'deepseek', 'custom',
])
export type CredentialVendor = z.infer<typeof credentialVendorEnum>

export const credentialAuthTypeEnum = z.enum(['api-key', 'subscription'])
export type CredentialAuthType = z.infer<typeof credentialAuthTypeEnum>

export const credentialSchema = z.object({
  vendor: credentialVendorEnum,
  authType: credentialAuthTypeEnum,
  /** Present for api-key credentials; absent for subscription credentials. */
  apiKey: z.string().optional(),
  /** Optional region / custom endpoint. */
  baseUrl: z.string().optional(),
})
export type Credential = z.infer<typeof credentialSchema>

const baseProfileFields = {
  /** Preset ID this profile was created from (for constraint enforcement on edit). */
  preset: z.string().optional(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  /**
   * Anthropic-shape only: which HTTP header carries the key. 'x-api-key' is
   * Anthropic first-party (default when absent); 'bearer' sends Authorization:
   * Bearer, required by anthropic-compatible gateways like MiniMax's
   * international endpoint. Currently consumed by the per-workspace AI config
   * "Apply from profile" path (surfaced via /agent-profiles); the in-process
   * GenerateRouter runtime does not yet honor it — see ANG follow-up.
   */
  authMode: z.enum(['x-api-key', 'bearer']).optional(),
  /**
   * Pointer into aiProviderSchema.credentials. When present, resolveProfile()
   * joins the credential's apiKey/baseUrl into the resolved shape (profile's
   * own inline values still win if set — transitional).
   */
  credentialSlug: z.string().optional(),
}

export const agentSdkProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('agent-sdk'),
  model: z.string().default('claude-opus-4-8'),
  loginMethod: z.enum(['api-key', 'claudeai']).default('api-key'),
})

export const codexProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('codex'),
  model: z.string().default('gpt-5.5'),
  loginMethod: z.enum(['api-key', 'codex-oauth']).default('codex-oauth'),
})

export const vercelProfileSchema = z.object({
  ...baseProfileFields,
  backend: z.literal('vercel-ai-sdk'),
  provider: z.string().default('anthropic'),
  model: z.string().default('claude-opus-4-8'),
})

export const profileSchema = z.discriminatedUnion('backend', [
  agentSdkProfileSchema, codexProfileSchema, vercelProfileSchema,
])

export type Profile = z.infer<typeof profileSchema>

export const aiProviderSchema = z.object({
  apiKeys: apiKeysSchema.default({}),
  /**
   * Credentials by slug — extracted from profiles by 0002_extract_credentials.
   * Profile's `credentialSlug` points here. Inline credential fields on the
   * profile remain as transitional fallback.
   */
  credentials: z.record(z.string(), credentialSchema).default({}),
  profiles: z.record(
    z.string(),
    profileSchema,
  ).default({
    default: { backend: 'agent-sdk', model: 'claude-opus-4-8', loginMethod: 'claudeai' },
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


/**
 * MCP server config — exposes OpenAlice's ToolCenter to external MCP
 * clients (Claude Desktop, codex inside workspaces, etc.). Lives at the
 * top level of Config rather than under `connectors:` because it's an
 * export direction (ToolCenter → outside), not a chat-input connector.
 * `connectors.mcpAsk` is the actual chat-shaped MCP-as-input flavour
 * and stays in connectors.
 */
const mcpSchema = z.object({
  port: z.number().int().positive().default(3001),
}).default({ port: 3001 })

const connectorsSchema = z.object({
  web: z.object({ port: z.number().int().positive().default(3002) }).default({ port: 3002 }),
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

// ==================== UTA Config ====================

const guardConfigSchema = z.object({
  type: z.string(),
  options: z.record(z.string(), z.unknown()).default({}),
})

/**
 * One Unified Trading Account. The user-facing concept — one preset
 * (OKX, Bybit, IBKR, …) plus credentials, guards, and an enabled flag.
 *
 * Distinct from `AccountInfo` (which is broker-side: cash, equity,
 * margin returned by `IBroker.getAccount()`). Two different "account"s.
 */
export const utaConfigSchema = z.object({
  id: z.string(),
  label: z.string().optional(),
  /** Broker preset id — resolves to engine + form schema via BROKER_PRESET_CATALOG. */
  presetId: z.string(),
  enabled: z.boolean().default(true),
  guards: z.array(guardConfigSchema).default([]),
  /** User-filled form values, validated against the preset's own zodSchema. */
  presetConfig: z.record(z.string(), z.unknown()).default({}),
  /**
   * Test/throwaway UTA — purged at every server startup (config entry
   * removed + `data/trading/<id>/` wiped) and dropped immediately when
   * deleted via the UTA-config DELETE endpoint. For fixture-based testing:
   * each session starts from a clean slate, no cross-session cost-basis
   * pollution. Only allowed on `mock-simulator` preset; setting it on a
   * real broker would silently destroy account history on next boot.
   */
  ephemeral: z.boolean().optional(),
}).refine((u) => u.ephemeral !== true || u.presetId === 'mock-simulator', {
  message: 'ephemeral: true is only allowed on mock-simulator UTAs (would destroy real broker history at next boot)',
  path: ['ephemeral'],
})

export const utasFileSchema = z.array(utaConfigSchema)

export type UTAConfig = z.infer<typeof utaConfigSchema>

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
  mcp: z.infer<typeof mcpSchema>
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
  // Run pending migrations before reading any section. Each migration is
  // recorded in data/config/_meta.json; the runner is a no-op when nothing
  // is pending. See src/migrations/INDEX.md for the full list.
  await runMigrations()

  const files = ['engine.json', 'agent.json', 'crypto.json', 'securities.json', 'market-data.json', 'compaction.json', 'ai-provider-manager.json', 'heartbeat.json', 'snapshot.json', 'mcp.json', 'connectors.json', 'news.json', 'tools.json', 'webhook.json'] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))

  const config: Config = {
    engine:        await parseAndSeed(files[0], engineSchema, raws[0]),
    agent:         await parseAndSeed(files[1], agentSchema, raws[1]),
    crypto:        await parseAndSeed(files[2], cryptoSchema, raws[2]),
    securities:    await parseAndSeed(files[3], securitiesSchema, raws[3]),
    marketData:    await parseAndSeed(files[4], marketDataSchema, raws[4]),
    compaction:    await parseAndSeed(files[5], compactionSchema, raws[5]),
    aiProvider:    await parseAndSeed(files[6], aiProviderSchema, raws[6]),
    heartbeat:     await parseAndSeed(files[7], heartbeatSchema, raws[7]),
    snapshot:      await parseAndSeed(files[8], snapshotSchema, raws[8]),
    mcp:           await parseAndSeed(files[9], mcpSchema, raws[9]),
    connectors:    await parseAndSeed(files[10], connectorsSchema, raws[10]),
    news:          await parseAndSeed(files[11], newsCollectorSchema, raws[11]),
    tools:         await parseAndSeed(files[12], toolsSchema, raws[12]),
    webhook:       await parseAndSeed(files[13], webhookSchema, raws[13]),
  }

  // Spawn-time-fixed channel: when guardian (Electron main) spawns the
  // backend, it injects the chosen ports as env. Env wins over the file
  // value because the file is user preference but the actual bound port
  // is decided by guardian at boot (may differ if the preferred port was
  // taken). In dev mode (no guardian) both env vars are unset and the
  // file value flows through unchanged.
  const envWebPort = parseEnvPort(process.env['OPENALICE_WEB_PORT'])
  if (envWebPort !== null) config.connectors.web.port = envWebPort
  const envMcpPort = parseEnvPort(process.env['OPENALICE_MCP_PORT'])
  if (envMcpPort !== null) config.mcp.port = envMcpPort

  return config
}

/** Parse a port from env. Returns null if unset, blank, or out of range. */
function parseEnvPort(raw: string | undefined): number | null {
  if (raw === undefined || raw === '') return null
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n <= 0 || n > 65535) return null
  return n
}

// ==================== UTA Config Loader ====================

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
function migrateLegacyUTA(raw: Record<string, unknown>): Record<string, unknown> | null {
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

// File name on disk stays `accounts.json` — internal-only, never
// user-visible. Renaming would require another migration block; cost
// outweighs benefit. The on-disk schema is the new UTA shape.
export async function readUTAsConfig(): Promise<UTAConfig[]> {
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
      const next = migrateLegacyUTA(item)
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

    const validated = utasFileSchema.parse(migrated)
    await writeFile(resolve(CONFIG_DIR, 'accounts.json'), JSON.stringify(validated, null, 2) + '\n')
    return validated
  }

  return utasFileSchema.parse(raw)
}

export async function writeUTAsConfig(utas: UTAConfig[]): Promise<void> {
  const validated = utasFileSchema.parse(utas)
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'accounts.json'), JSON.stringify(validated, null, 2) + '\n')
}

/**
 * Wipe a UTA's persistent trading state (`data/trading/<id>/`). Used when
 * destroying ephemeral UTAs — boot-time purge AND mid-session DELETE both
 * funnel here so commit history / snapshots don't outlive the UTA.
 *
 * No-op if the directory doesn't exist; never touches `data/config/`.
 */
export async function wipeUTATradingData(id: string): Promise<void> {
  const dir = resolve('data', 'trading', id)
  await rm(dir, { recursive: true, force: true })
}

/**
 * Purge ephemeral UTAs at server startup: remove their entries from
 * `accounts.json` AND wipe their `data/trading/<id>/` dirs. Called once
 * from the boot path before UTAManager starts initializing UTAs, so
 * ephemeral residue from the previous session never reaches the manager.
 *
 * Returns the surviving non-ephemeral UTAs (caller iterates these for
 * normal init).
 */
export async function purgeEphemeralUTAs(utas: UTAConfig[]): Promise<UTAConfig[]> {
  const ephemeral = utas.filter((u) => u.ephemeral === true)
  if (ephemeral.length === 0) return utas

  for (const u of ephemeral) {
    console.log(`startup: purging ephemeral UTA ${u.id}${u.label ? ` (${u.label})` : ''}`)
    await wipeUTATradingData(u.id)
  }
  const survivors = utas.filter((u) => u.ephemeral !== true)
  await writeUTAsConfig(survivors)
  return survivors
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
  /** Anthropic-shape only: which header carries the key (x-api-key vs Bearer).
   *  Consumed via resolveAnthropicAuthMode() at the auth-header construction
   *  sites (agent-sdk env, vercel anthropic client, test-path adapter). */
  authMode?: 'x-api-key' | 'bearer'
  /** Pointer into AIProviderConfig.credentials. Preserved on the resolved
   *  shape so callers can fetch the credential separately when needed. */
  credentialSlug?: string
}

/**
 * Resolve a profile by slug. When the profile carries a `credentialSlug`,
 * the referenced credential's apiKey/baseUrl are joined into the resolved
 * shape — but profile-level inline values still win when present, so the
 * 0002 migration can safely leave inline fields in place as transitional
 * fallback. The returned `ResolvedProfile` shape is unchanged.
 */
export async function resolveProfile(slug?: string): Promise<ResolvedProfile> {
  const config = await readAIProviderConfig()
  const key = slug ?? config.activeProfile
  const profile = config.profiles[key]
  if (!profile) throw new Error(`Unknown AI provider profile: "${key}"`)

  if (profile.credentialSlug) {
    const cred = config.credentials[profile.credentialSlug]
    if (!cred) {
      throw new Error(
        `Profile "${key}" references missing credential "${profile.credentialSlug}"`,
      )
    }
    return {
      ...profile,
      apiKey: profile.apiKey ?? cred.apiKey,
      baseUrl: profile.baseUrl ?? cred.baseUrl,
    }
  }
  return { ...profile }
}

// ==================== Credential Helpers ====================

/** Read a credential by slug. Throws if missing. */
export async function resolveCredential(slug: string): Promise<Credential> {
  const config = await readAIProviderConfig()
  const cred = config.credentials[slug]
  if (!cred) throw new Error(`Unknown credential: "${slug}"`)
  return { ...cred }
}

/** Read all credentials as a slug-keyed map. */
export async function readCredentials(): Promise<Record<string, Credential>> {
  const config = await readAIProviderConfig()
  return { ...config.credentials }
}

/** Write a single credential (create or update). */
export async function writeCredential(slug: string, credential: Credential): Promise<void> {
  const config = await readAIProviderConfig()
  const validated = credentialSchema.parse(credential)
  config.credentials[slug] = validated
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
}

/** Delete a credential. Errors if any profile still references it. */
export async function deleteCredential(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  const referencingProfiles = Object.entries(config.profiles)
    .filter(([, p]) => p.credentialSlug === slug)
    .map(([slug]) => slug)
  if (referencingProfiles.length > 0) {
    throw new Error(
      `Cannot delete credential "${slug}" — referenced by profile(s): ${referencingProfiles.join(', ')}`,
    )
  }
  delete config.credentials[slug]
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
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

/**
 * Eagerly extract a credential from a profile's inline fields and link
 * the profile to it. Dedupes against existing credentials (same vendor +
 * authType + apiKey + baseUrl reuses the existing slug). Returns the
 * possibly-updated profile and credentials map.
 *
 * Used by writeProfile (and the 0003 backfill migration) so new profiles
 * never land with inline-only credentials. Idempotent — profiles already
 * carrying credentialSlug are passed through unchanged.
 */
export function extractCredentialFromProfile(
  profile: Profile,
  existing: Record<string, Credential>,
): { profile: Profile; credentials: Record<string, Credential> } {
  if (profile.credentialSlug) return { profile, credentials: existing }
  if (!hasExtractableCredential(profile)) return { profile, credentials: existing }

  const vendor = inferVendorFromProfile(profile)
  const authType = inferAuthTypeFromProfile(profile)
  const cred: Credential = { vendor, authType }
  if (profile.apiKey) cred.apiKey = profile.apiKey
  if (profile.baseUrl) cred.baseUrl = profile.baseUrl

  // Dedupe against existing — same vendor/auth/apiKey/baseUrl reuses the slug
  const match = Object.entries(existing).find(([, c]) =>
    c.vendor === cred.vendor &&
    c.authType === cred.authType &&
    c.apiKey === cred.apiKey &&
    c.baseUrl === cred.baseUrl
  )
  if (match) {
    return {
      profile: { ...profile, credentialSlug: match[0] } as Profile,
      credentials: existing,
    }
  }

  // Generate a fresh slug
  const taken = new Set(Object.keys(existing))
  let n = 1
  while (taken.has(`${vendor}-${n}`)) n++
  const slug = `${vendor}-${n}`

  return {
    profile: { ...profile, credentialSlug: slug } as Profile,
    credentials: { ...existing, [slug]: cred },
  }
}

/**
 * Write a single profile (create or update). Eagerly extracts inline
 * credential fields into the credentials map and links via
 * credentialSlug — keeps the credentials map complete as new profiles
 * land via the wizard.
 */
export async function writeProfile(slug: string, profile: Profile): Promise<void> {
  const config = await readAIProviderConfig()
  const { profile: extractedProfile, credentials } = extractCredentialFromProfile(
    profile,
    config.credentials,
  )
  config.profiles[slug] = extractedProfile
  config.credentials = credentials
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
}

/**
 * Delete a profile. Cannot delete the active profile. If the deleted
 * profile was the last one referencing its credential, the credential
 * is garbage-collected too — keeps credentials map free of orphans.
 */
export async function deleteProfile(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  if (config.activeProfile === slug) throw new Error('Cannot delete the active profile')
  const removedCredSlug = config.profiles[slug]?.credentialSlug
  delete config.profiles[slug]

  // GC: if the removed profile's credential is no longer referenced, drop it
  if (removedCredSlug) {
    const stillReferenced = Object.values(config.profiles).some(
      (p) => p.credentialSlug === removedCredSlug,
    )
    if (!stillReferenced) {
      delete config.credentials[removedCredSlug]
    }
  }

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
  mcp: mcpSchema,
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
  mcp: 'mcp.json',
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
