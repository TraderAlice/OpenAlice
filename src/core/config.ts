import { z } from 'zod'
import { readFile, writeFile, mkdir, unlink, rm, rename, chmod } from 'fs/promises'
import { resolve, join, dirname } from 'path'
import { homedir } from 'os'
import { newsCollectorSchema } from '../domain/news/config.js'
import { runMigrations } from '../migrations/runner.js'
import { dataPath } from '@/core/paths.js'
import { isSealedEnvelope, seal, unseal } from './sealing.js'

const CONFIG_DIR = dataPath('config')

// ==================== Global provider keys (cross-checkout) ====================
// Data-vendor API keys (FRED / FMP / EIA / BLS / …) are USER-level, not
// instance-level: a fresh checkout or worktree starts with an empty
// data/config and would otherwise ask for every key again. They live in
// ~/.openalice/provider-keys.json (the same user-global root the workspace
// launcher uses) and merge UNDER the instance file — a local value always
// wins. Broker credentials deliberately stay instance-local: data/ next to
// the source tree is the audit boundary for anything money-capable.

/** Resolved per call (not module-const) so tests / portable installs can
 *  point it elsewhere via OPENALICE_GLOBAL_DIR. */
function globalProviderKeysFile(): string {
  const root = process.env['OPENALICE_GLOBAL_DIR'] ?? join(homedir(), '.openalice')
  return join(root, 'provider-keys.json')
}

async function readGlobalProviderKeys(): Promise<Record<string, string>> {
  try {
    const raw: unknown = JSON.parse(await readFile(globalProviderKeysFile(), 'utf-8'))
    if (typeof raw !== 'object' || raw === null) return {}
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => typeof v === 'string' && v !== ''),
    ) as Record<string, string>
  } catch {
    return {}
  }
}

/** Fill providerKeys gaps from the user-global file (local wins per key). */
async function applyGlobalProviderKeys<T extends { providerKeys: object }>(parsed: T): Promise<T> {
  const keys = parsed.providerKeys as Record<string, string | undefined>
  const global = await readGlobalProviderKeys()
  for (const [k, v] of Object.entries(global)) {
    if (!keys[k]) keys[k] = v
  }
  return parsed
}

/** Mirror a Settings save back to the user-global file so every future
 *  checkout starts with the keys. An EXPLICIT empty string clears the key
 *  globally too — otherwise a deleted key resurrects in each new worktree;
 *  keys absent from the payload are left untouched. */
async function mirrorProviderKeysToGlobal(keys: Record<string, string | undefined>): Promise<void> {
  const global = await readGlobalProviderKeys()
  for (const [k, v] of Object.entries(keys)) {
    if (typeof v === 'string' && v.trim() !== '') global[k] = v
    else if (v === '') delete global[k]
  }
  const file = globalProviderKeysFile()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, JSON.stringify(global, null, 2) + '\n')
}

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

/**
 * The wire protocol the credential's endpoint speaks. Load-bearing, NOT
 * derivable from baseUrl alone — OpenAI Chat Completions and Responses share
 * one base URL (api.openai.com/v1), so only this field distinguishes them. Also
 * tells injection how to configure the consuming adapter. Mirrors the
 * `WireShape` union in ai-providers/preset-catalog.ts (kept in sync by hand —
 * 3 stable values; core must not depend on the ai-providers layer).
 */
export const credentialWireShapeEnum = z.enum(['anthropic', 'openai-chat', 'openai-responses'])
export type CredentialWireShape = z.infer<typeof credentialWireShapeEnum>

export const credentialSchema = z.object({
  vendor: credentialVendorEnum,
  authType: credentialAuthTypeEnum,
  /** Present for api-key credentials; absent for subscription credentials. */
  apiKey: z.string().optional(),
  /**
   * The wire shapes this key can speak, each with its endpoint baseUrl (''/absent
   * = the shape's official endpoint). A provider exposes the SAME key behind
   * several incompatible shapes that differ only by endpoint (GLM: anthropic at
   * /api/anthropic, openai-chat at /api/paas/v4), so one credential declares all
   * of them — "wire capabilities" — and injection picks the one the target agent
   * speaks. Fill the key once.
   */
  wires: z.partialRecord(credentialWireShapeEnum, z.string()).optional(),
  /** @deprecated legacy single-endpoint fields — read via `credentialWires()`. */
  baseUrl: z.string().trim().transform((s) => s || undefined).optional(),
  /** @deprecated legacy single wire shape — superseded by `wires`. */
  wireShape: credentialWireShapeEnum.optional(),
  /**
   * The last model run against this key — a credential carries no model of its
   * own (model is always a per-use choice), so quick-chat and the per-workspace
   * config remember the user's last pick here to spare them re-typing it. Set on
   * every config write that knows the slug; read as the injection default
   * (falling back to the vendor's catalog flagship when absent). Optional ⇒ no
   * migration; an old cred just has no remembered model until next write.
   */
  lastModel: z.string().optional(),
})
export type Credential = z.infer<typeof credentialSchema>

/**
 * The wire→baseUrl map for a credential, tolerating legacy creds that still
 * carry the flat `{baseUrl, wireShape}` instead of `wires`. No migration needed:
 * old creds are upgraded transparently on read.
 */
export function credentialWires(cred: Credential): Partial<Record<CredentialWireShape, string>> {
  if (cred.wires && Object.keys(cred.wires).length > 0) return cred.wires
  if (cred.wireShape) return { [cred.wireShape]: cred.baseUrl ?? '' }
  return {}
}

/**
 * A user-level default that seeds a freshly-created workspace's per-agent AI
 * config from a vault credential — the "inject my usual key on every launch"
 * setting. Keyed by agentId (`claude` / `codex` / `opencode` / `pi`).
 * `credentialSlug` points into `credentials`; `model` is the optional run model
 * (absent ⇒ resolved from the cred's `lastModel`, then the vendor flagship).
 * Structurally a superset-compatible mirror of the workspaces layer's
 * `AgentCredentialDecl`, so the creator can merge the two and feed
 * `injectWorkspaceCredentials` directly.
 */
export const workspaceCredentialDefaultSchema = z.object({
  credentialSlug: z.string(),
  model: z.string().optional(),
})
export type WorkspaceCredentialDefault = z.infer<typeof workspaceCredentialDefaultSchema>

export const aiProviderSchema = z.object({
  apiKeys: apiKeysSchema.default({}),
  /**
   * The central credential vault: api-key credentials by slug, each declaring
   * its wire capabilities (`wires`). Injected into workspaces by template; the
   * model loop itself runs in the native CLI. (The pre-0.40 `profiles` /
   * `activeProfile` fields — for the deleted in-process provider — are gone;
   * existing files keep them on disk until rewritten, where they're ignored.)
   */
  credentials: z.record(z.string(), credentialSchema).default({}),
  /**
   * Per-agent default credential seeded into EVERY new workspace at create time
   * (agentId → {credentialSlug, model?}). The user-level counterpart to a
   * template's `agentCredentials`: set a default cred per agent once and skip the
   * per-workspace AI-config modal on each launch. References slugs in
   * `credentials`; a dangling slug is loud-skipped at injection, never fatal.
   */
  workspaceCredentialDefaults: z.record(z.string(), workspaceCredentialDefaultSchema).default({}),
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
  /** Hosted reference-data hub (TraderHub). Enabled by default: anonymous
   *  GETs of public boards, no user data attached; one switch to opt out.
   *  Self-hosters point baseUrl at their own instance. */
  hub: z.object({
    enabled: z.boolean().default(true),
    baseUrl: z.string().default('https://traderhub.openalice.ai'),
  }).default({ enabled: true, baseUrl: 'https://traderhub.openalice.ai' }),
})

const compactionSchema = z.object({
  maxContextTokens: z.number().default(200_000),
  maxOutputTokens: z.number().default(20_000),
  autoCompactBuffer: z.number().default(13_000),
  microcompactKeepRecent: z.number().default(3),
})

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

const snapshotSchema = z.object({
  enabled: z.boolean().default(true),
  every: z.string().default('15m'),
})

const tradingSchema = z.object({
  /**
   * External-order observation cadence — how often UTA lists the broker's
   * open orders to catch ones placed outside Alice (exchange app, direct
   * API). Duration string ('1m' / '5m' / '10m' / '15m'); 'off' disables.
   * Default 15m: untracked orders are a narrative-fidelity feature, not a
   * primary flow — keep the standing request rate negligible (96/day per
   * account). Fill/cancel detection for KNOWN pending orders is separate
   * (10s fast lane) and unaffected by this knob.
   */
  observeExternalOrdersEvery: z.string().default('15m'),
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
  /** No API key required to create/connect. A keyless UTA serves only public
   *  market data (quote/bars/search) — it has no account/positions and is
   *  excluded from portfolio equity aggregation. keyless ⟹ readOnly. */
  keyless: z.boolean().default(false),
  /** Read-only — write operations (stage/commit/push of orders) are refused.
   *  Implied by keyless; can also be set on a keyed account for a watch-only view. */
  readOnly: z.boolean().default(false),
  /** Whether this UTA can be edited/removed via the config UI. The built-in
   *  keyless data UTAs (binance/okx/bybit-readonly) are non-editable. */
  editable: z.boolean().default(true),
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
  snapshot: z.infer<typeof snapshotSchema>
  trading: z.infer<typeof tradingSchema>
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

  const files = ['engine.json', 'agent.json', 'crypto.json', 'securities.json', 'market-data.json', 'compaction.json', 'ai-provider-manager.json', 'snapshot.json', 'mcp.json', 'connectors.json', 'news.json', 'tools.json', 'webhook.json', 'trading.json'] as const
  const raws = await Promise.all(files.map((f) => loadJsonFile(f)))

  const config: Config = {
    engine:        await parseAndSeed(files[0], engineSchema, raws[0]),
    agent:         await parseAndSeed(files[1], agentSchema, raws[1]),
    crypto:        await parseAndSeed(files[2], cryptoSchema, raws[2]),
    securities:    await parseAndSeed(files[3], securitiesSchema, raws[3]),
    marketData:    await applyGlobalProviderKeys(await parseAndSeed(files[4], marketDataSchema, raws[4])),
    compaction:    await parseAndSeed(files[5], compactionSchema, raws[5]),
    aiProvider:    await parseAndSeed(files[6], aiProviderSchema, raws[6]),
    snapshot:      await parseAndSeed(files[7], snapshotSchema, raws[7]),
    mcp:           await parseAndSeed(files[8], mcpSchema, raws[8]),
    connectors:    await parseAndSeed(files[9], connectorsSchema, raws[9]),
    news:          await parseAndSeed(files[10], newsCollectorSchema, raws[10]),
    tools:         await parseAndSeed(files[11], toolsSchema, raws[11]),
    webhook:       await parseAndSeed(files[12], webhookSchema, raws[12]),
    trading:       await parseAndSeed(files[13], tradingSchema, raws[13]),
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

/**
 * Write the accounts file sealed (AES-256-GCM envelope, see sealing.ts) and
 * owner-only. Every accounts.json write funnels here so no code path can
 * regress to plaintext credentials at rest.
 */
async function writeAccountsFile(validated: UTAConfig[]): Promise<void> {
  await mkdir(CONFIG_DIR, { recursive: true })
  const path = resolve(CONFIG_DIR, 'accounts.json')
  await writeFile(path, JSON.stringify(await seal(validated), null, 2) + '\n', { mode: 0o600 })
  await chmod(path, 0o600).catch(() => { /* noop — platform without chmod */ })
}

// File name on disk stays `accounts.json` — internal-only, never
// user-visible. Renaming would require another migration block; cost
// outweighs benefit. The on-disk schema is the new UTA shape.
export async function readUTAsConfig(): Promise<UTAConfig[]> {
  let raw = await loadJsonFile('accounts.json')
  if (raw === undefined) {
    // Seed empty (sealed) file on first run — also materializes sealing.key
    // early, so later credential writes never race key creation.
    await writeAccountsFile([])
    return []
  }

  // Sealed envelope — the normal at-rest shape. A plain array is the legacy
  // plaintext form: still readable (migration 0009 reseals it at boot).
  if (isSealedEnvelope(raw)) {
    try {
      raw = await unseal(raw)
    } catch (err) {
      // Recoverable, loudly: quarantine the unreadable file (never delete —
      // it's the user's broker config, the key may resurface) and continue
      // with an empty store so the app still boots.
      const quarantine = resolve(CONFIG_DIR, `accounts.json.sealed-unreadable-${Date.now()}`)
      await rename(resolve(CONFIG_DIR, 'accounts.json'), quarantine)
      console.error(
        `accounts.json could not be unsealed: ${err instanceof Error ? err.message : String(err)}\n` +
        `The file was preserved at ${quarantine}. Starting with an empty account store — ` +
        `re-enter broker credentials in Settings → Trading.`,
      )
      await writeAccountsFile([])
      return []
    }
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
    await writeAccountsFile(validated)
    return validated
  }

  return utasFileSchema.parse(raw)
}

export async function writeUTAsConfig(utas: UTAConfig[]): Promise<void> {
  const validated = utasFileSchema.parse(utas)
  await writeAccountsFile(validated)
}

/**
 * Wipe a UTA's persistent trading state (`data/trading/<id>/`). Used when
 * destroying ephemeral UTAs — boot-time purge AND mid-session DELETE both
 * funnel here so commit history / snapshots don't outlive the UTA.
 *
 * No-op if the directory doesn't exist; never touches `data/config/`.
 */
export async function wipeUTATradingData(id: string): Promise<void> {
  const dir = dataPath('trading', id)
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
    return applyGlobalProviderKeys(marketDataSchema.parse(raw))
  } catch {
    return applyGlobalProviderKeys(marketDataSchema.parse({}))
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

/**
 * Add a credential to the central store. Dedups by {vendor, authType, apiKey} —
 * one key is one account, regardless of how many wires/endpoints it can drive —
 * so re-adding a key you already have (even with a different/newer wire set)
 * reuses the slug and UPGRADES its wires in place rather than duplicating.
 * Returns the slug.
 *
 * Standalone counterpart to `extractCredentialFromProfile` for credentials that
 * don't come from a profile — e.g. the workspace AI-config modal's "save to
 * Alice" path.
 */
export async function addCredential(credential: Credential): Promise<string> {
  const config = await readAIProviderConfig()
  const validated = credentialSchema.parse(credential)
  const match = Object.entries(config.credentials).find(([, c]) =>
    c.vendor === validated.vendor &&
    c.authType === validated.authType &&
    c.apiKey === validated.apiKey,
  )
  if (match) {
    // Upgrade the existing record's wires/endpoint in place (don't duplicate).
    config.credentials[match[0]] = validated
    await mkdir(CONFIG_DIR, { recursive: true })
    await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
    return match[0]
  }
  const taken = new Set(Object.keys(config.credentials))
  let n = 1
  while (taken.has(`${validated.vendor}-${n}`)) n++
  const slug = `${validated.vendor}-${n}`
  config.credentials[slug] = validated
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
  return slug
}

/**
 * Remember the model last run against a credential (see `lastModel`). No-ops
 * silently when the slug is gone or the model is unchanged — it's a convenience
 * memory, never load-bearing, so a miss must not break the caller's flow.
 */
export async function setCredentialLastModel(slug: string, model: string): Promise<void> {
  if (!model) return
  const config = await readAIProviderConfig()
  const cred = config.credentials[slug]
  if (!cred || cred.lastModel === model) return
  config.credentials[slug] = { ...cred, lastModel: model }
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
}

/** Delete a credential from the vault. */
export async function deleteCredential(slug: string): Promise<void> {
  const config = await readAIProviderConfig()
  delete config.credentials[slug]
  // Drop any workspace-default that pointed at the now-gone slug, so the
  // Settings dropdown never shows a dangling default (injection would skip it
  // anyway, but a stale default reads as "still configured").
  for (const [agentId, def] of Object.entries(config.workspaceCredentialDefaults)) {
    if (def.credentialSlug === slug) delete config.workspaceCredentialDefaults[agentId]
  }
  await mkdir(CONFIG_DIR, { recursive: true })
  await writeFile(resolve(CONFIG_DIR, 'ai-provider-manager.json'), JSON.stringify(config, null, 2) + '\n')
}

/**
 * Read the per-agent default credentials seeded into new workspaces
 * (agentId → {credentialSlug, model?}). Empty map when unset.
 */
export async function readWorkspaceCredentialDefaults(): Promise<Record<string, WorkspaceCredentialDefault>> {
  const config = await readAIProviderConfig()
  return { ...config.workspaceCredentialDefaults }
}

/**
 * Replace the per-agent workspace-default credential map. Entries with an empty
 * `credentialSlug` are dropped (the UI's "don't seed this agent" choice).
 */
export async function writeWorkspaceCredentialDefaults(
  defaults: Record<string, WorkspaceCredentialDefault>,
): Promise<void> {
  const config = await readAIProviderConfig()
  const cleaned: Record<string, WorkspaceCredentialDefault> = {}
  for (const [agentId, def] of Object.entries(defaults)) {
    const parsed = workspaceCredentialDefaultSchema.parse(def)
    if (parsed.credentialSlug) cleaned[agentId] = parsed
  }
  config.workspaceCredentialDefaults = cleaned
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
  snapshot: snapshotSchema,
  trading: tradingSchema,
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
  snapshot: 'snapshot.json',
  trading: 'trading.json',
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
  if (section === 'marketData') {
    const keys = (validated as { providerKeys?: Record<string, string | undefined> }).providerKeys
    if (keys) await mirrorProviderKeysToGlobal(keys)
  }
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
