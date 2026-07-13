/**
 * Broker Preset Catalog — Zod-defined preset declarations.
 *
 * Single source of truth for every broker preset the wizard offers.
 * Each preset is one user-facing "account type" (e.g., OKX, Bybit, Alpaca).
 * Multiple presets map to a small set of engine implementations
 * (CcxtBroker, AlpacaBroker, IbkrBroker) — same many-to-few pattern as
 * the AI provider preset system in src/ai-providers/preset-catalog.ts.
 *
 * To add a new preset: add an entry below + register in BROKER_PRESET_CATALOG.
 */

import { z } from 'zod'
import { createHash, randomBytes } from 'node:crypto'

// ==================== Types ====================

export type BrokerEngine = 'ccxt' | 'alpaca' | 'ibkr' | 'leverup' | 'longbridge' | 'mock'

export interface ModeOption {
  id: string
  label: string
}

/** Field shown on an account card under the account name (e.g., "OKX · Demo Trading"). */
export interface SubtitleSegment {
  /** Field path inside presetConfig (e.g., "mode"). */
  field: string
  /** Static text rendered when the field is truthy. */
  label?: string
  /** Static text rendered when the field is falsy (boolean fields only). */
  falseLabel?: string
  /** Prefix prepended to the value (text fields). */
  prefix?: string
}

export interface BrokerPresetDef {
  /** Stable id stored on disk in UTAConfig.presetId. Used as the prefix
   * of derived UTA ids — e.g. an OKX preset → `okx-a3f2b1c4`. Renaming
   * this is a breaking change for existing UTA ids on disk. */
  id: string
  /** User-facing label in the wizard. */
  label: string
  /** Short description shown under the label. */
  description: string
  /**
   * Group in the picker UI. Wizard renders 'recommended' first, then
   * 'crypto', then 'testing'. Securities + Longbridge HK + Hyperliquid sit
   * in 'recommended' (Hyperliquid grandfathered for product-history reasons,
   * not because it's not crypto). Everything else crypto-native — incl.
   * CCXT Custom — lands in 'crypto'. The Simulator preset (mock engine)
   * lives alone in 'testing' so users can't conflate it with real-money brokers.
   */
  category: 'recommended' | 'crypto' | 'testing'
  /** Optional explanatory text rendered with the form (mode-specific gotchas, etc.). */
  hint?: string
  /** Default account id suggested in the wizard (e.g., "okx-main"). */
  defaultName: string
  /** 2–3-char badge text for the account card. */
  badge: string
  /** Tailwind text color for the badge. */
  badgeColor: string
  /** Engine class invoked after preset resolution. */
  engine: BrokerEngine
  /** Guard category for the guards UI. */
  guardCategory: 'crypto' | 'securities'
  /** Zod schema for presetConfig — validates only the fields this preset uses. */
  zodSchema: z.ZodType
  /** Optional "Mode" dropdown (Live/Demo/Testnet/Paper/etc.). */
  modes?: ModeOption[]
  /** Account-card subtitle layout. */
  subtitleFields: SubtitleSegment[]
  /** Field names that should render as password inputs. */
  writeOnlyFields?: string[]
  /**
   * presetConfig field names that determine broker physical identity.
   * `deriveUtaId` reads these (and only these) from validated presetConfig
   * to compute a deterministic UTA id. Two configs with the same values
   * across these fields → same id → same on-disk commit log inheritance.
   *
   * Pick fields that uniquely identify a broker account: API key for
   * centralized exchanges, wallet address for DEX, mode for paper/live
   * separation, etc. Don't include cosmetic fields (label, etc.).
   */
  fingerprintFields: string[]
  /**
   * Translate validated preset form data into the engine's internal
   * config dict. This is where preset-specific knowledge (e.g., "OKX
   * demo mode = sandbox=true") lives.
   */
  toEngineConfig: (presetData: Record<string, unknown>) => Record<string, unknown>
  /**
   * Whether a given preset config represents a paper/demo/testnet
   * account. Used by E2E test setup to filter out live accounts.
   * Default: true if presetData.mode is one of demo/testnet/paper.
   */
  isPaper?: (presetData: Record<string, unknown>) => boolean
}

// ==================== Helpers ====================

/** Default isPaper: any non-live mode counts as paper. */
function defaultIsPaper(data: Record<string, unknown>): boolean {
  const mode = String(data['mode'] ?? '').toLowerCase()
  return mode === 'demo' || mode === 'testnet' || mode === 'paper'
}

// ==================== CCXT-engine presets ====================

export const BINANCE_PRESET: BrokerPresetDef = {
  id: 'binance',
  label: 'Binance',
  description: 'Binance — spot, USDⓈ-M & COIN-M futures. The world\'s largest crypto exchange.',
  category: 'crypto',
  // Paper trading uses Binance Demo Trading (mode 'demo' → demoTrading →
  // enableDemoTrading): the unified simulator at demo-*.binance.com covering
  // spot + futures with virtual funds. We deliberately do NOT expose Binance's
  // legacy Testnet (setSandboxMode):
  //   - Futures testnet (testnet.binancefuture.com) is DEAD — CCXT 4.5.38 hard
  //     -throws NotSupported on any private futures call there ("not supported
  //     for futures anymore … use demo trading instead").
  //   - Spot testnet (testnet.binance.vision) is alive but spot-only, and the
  //     engine's getAccount/getPositions unconditionally call fetchPositions()
  //     (futures) — which would hit the dead futures testnet. Supporting a
  //     spot-only account means breaking the full-spectrum-load invariant;
  //     tracked as a separate engine change (Linear), not worth it for a
  //     dev-oriented sandbox inside a trading product. Demo covers the need.
  hint: '**Demo Trading** is Binance\'s risk-free simulator — virtual funds, spot + futures in one place. It runs on isolated demo servers, so prices and fills are simulated and can differ from live. Generate a dedicated Demo API key at demo.binance.com → API Management; your live keys are rejected here (and demo keys are rejected on live).\n\n**Live** places real orders on real money — grant trade-only permissions and never enable withdrawals.',
  defaultName: 'binance-main',
  badge: 'BN',
  badgeColor: 'text-yellow-400',
  engine: 'ccxt',
  guardCategory: 'crypto',
  modes: [
    { id: 'live', label: 'Live' },
    { id: 'demo', label: 'Demo Trading' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'demo']).default('live').describe('Mode'),
    apiKey: z.string().min(1).describe('API Key'),
    secret: z.string().min(1).describe('API Secret'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'Binance · ' },
  ],
  writeOnlyFields: ['apiKey', 'secret'],
  fingerprintFields: ['mode', 'apiKey'],
  toEngineConfig: (d) => ({
    exchange: 'binance',
    demoTrading: d.mode === 'demo',
    apiKey: d.apiKey,
    secret: d.secret,
  }),
}

export const OKX_PRESET: BrokerPresetDef = {
  id: 'okx',
  label: 'OKX',
  description: 'OKX Unified Trading Account — spot, perps, futures, options.',
  category: 'crypto',
  hint: 'Demo Trading uses the same domain as live but routes orders to a simulated matching engine. **You must generate a separate set of API keys from OKX\'s demo trading mode** — your live API keys will be rejected in demo. Live keys give the bot real money access; double-check trade-only permissions and never enable withdrawals.',
  defaultName: 'okx-main',
  badge: 'OKX',
  badgeColor: 'text-accent',
  engine: 'ccxt',
  guardCategory: 'crypto',
  modes: [
    { id: 'live', label: 'Live' },
    { id: 'demo', label: 'Demo Trading' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'demo']).default('live').describe('Mode'),
    apiKey: z.string().min(1).describe('API Key'),
    secret: z.string().min(1).describe('API Secret'),
    password: z.string().min(1).describe('Passphrase'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'OKX · ' },
  ],
  writeOnlyFields: ['apiKey', 'secret', 'password'],
  fingerprintFields: ['mode', 'apiKey'],
  toEngineConfig: (d) => ({
    exchange: 'okx',
    sandbox: d.mode === 'demo',
    apiKey: d.apiKey,
    secret: d.secret,
    password: d.password,
  }),
}

export const BYBIT_PRESET: BrokerPresetDef = {
  id: 'bybit',
  label: 'Bybit',
  description: 'Bybit Unified Trading — spot, perps, USDC options.',
  category: 'crypto',
  hint: 'Bybit ships **two** non-live environments: Testnet (separate domain api-testnet.bybit.com, fake market data, fake matching) and Demo Trading (production domain, **real** market data, simulated matching). Each requires its own API keys generated in the matching environment.',
  defaultName: 'bybit-main',
  badge: 'BY',
  badgeColor: 'text-accent',
  engine: 'ccxt',
  guardCategory: 'crypto',
  modes: [
    { id: 'live', label: 'Live' },
    { id: 'testnet', label: 'Testnet (api-testnet.bybit.com)' },
    { id: 'demo', label: 'Demo Trading (real market data, fake fills)' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'testnet', 'demo']).default('live').describe('Mode'),
    apiKey: z.string().min(1).describe('API Key'),
    secret: z.string().min(1).describe('API Secret'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'Bybit · ' },
  ],
  writeOnlyFields: ['apiKey', 'secret'],
  fingerprintFields: ['mode', 'apiKey'],
  toEngineConfig: (d) => ({
    exchange: 'bybit',
    sandbox: d.mode === 'testnet',
    demoTrading: d.mode === 'demo',
    apiKey: d.apiKey,
    secret: d.secret,
  }),
}

export const HYPERLIQUID_PRESET: BrokerPresetDef = {
  id: 'hyperliquid',
  label: 'Hyperliquid',
  description: 'Hyperliquid perp DEX. Uses wallet auth, not API keys.',
  category: 'recommended',
  hint: 'Hyperliquid authenticates via wallet signatures. Generate a **dedicated API wallet** at app.hyperliquid.xyz/API and use its private key here — never paste your main wallet\'s key. The wallet address can be either the main wallet (vault owner) or the API wallet itself.',
  defaultName: 'hyperliquid-main',
  badge: 'HL',
  badgeColor: 'text-accent',
  engine: 'ccxt',
  guardCategory: 'crypto',
  modes: [
    { id: 'live', label: 'Mainnet' },
    { id: 'testnet', label: 'Testnet' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'testnet']).default('live').describe('Network'),
    walletAddress: z.string().min(1).describe('Wallet Address (0x...)'),
    privateKey: z.string().min(1).describe('API Wallet Private Key'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'Hyperliquid · ' },
  ],
  writeOnlyFields: ['privateKey'],
  fingerprintFields: ['mode', 'walletAddress'],
  toEngineConfig: (d) => ({
    exchange: 'hyperliquid',
    sandbox: d.mode === 'testnet',
    walletAddress: d.walletAddress,
    privateKey: d.privateKey,
  }),
}

export const BITGET_PRESET: BrokerPresetDef = {
  id: 'bitget',
  label: 'Bitget',
  description: 'Bitget — spot and USDT-M perpetuals.',
  category: 'crypto',
  hint: 'Bitget requires API key + secret + passphrase (set when creating the key). Demo Trading routes orders to a simulated environment using the production domain.',
  defaultName: 'bitget-main',
  badge: 'BG',
  badgeColor: 'text-accent',
  engine: 'ccxt',
  guardCategory: 'crypto',
  modes: [
    { id: 'live', label: 'Live' },
    { id: 'demo', label: 'Demo Trading' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'demo']).default('live').describe('Mode'),
    apiKey: z.string().min(1).describe('API Key'),
    secret: z.string().min(1).describe('API Secret'),
    password: z.string().min(1).describe('Passphrase'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'Bitget · ' },
  ],
  writeOnlyFields: ['apiKey', 'secret', 'password'],
  fingerprintFields: ['mode', 'apiKey'],
  toEngineConfig: (d) => ({
    exchange: 'bitget',
    demoTrading: d.mode === 'demo',
    apiKey: d.apiKey,
    secret: d.secret,
    password: d.password,
  }),
}

export const CCXT_CUSTOM_PRESET: BrokerPresetDef = {
  id: 'ccxt-custom',
  label: 'CCXT Custom (any exchange)',
  description: 'Power-user escape hatch — connect to any of CCXT\'s 100+ exchanges with the raw credential field set. Untested; expect rough edges.',
  category: 'crypto',
  hint: 'This preset exposes every CCXT credential field. Use it only for exchanges without a dedicated preset. Read the exchange\'s CCXT page (docs.ccxt.com) to know which fields it actually requires — sandbox/demoTrading semantics vary per exchange.',
  defaultName: 'ccxt-custom',
  badge: 'CC',
  badgeColor: 'text-text-muted',
  engine: 'ccxt',
  guardCategory: 'crypto',
  zodSchema: z.object({
    exchange: z.string().min(1).describe('Exchange ID (e.g., kucoin, gate, mexc)'),
    sandbox: z.boolean().default(false).describe('Sandbox / Testnet'),
    demoTrading: z.boolean().default(false).describe('Demo Trading (per-exchange semantics; usually opens fake matching on prod URL)'),
    apiKey: z.string().optional().describe('API Key'),
    secret: z.string().optional().describe('API Secret'),
    password: z.string().optional().describe('Passphrase'),
    uid: z.string().optional().describe('User ID'),
    walletAddress: z.string().optional().describe('Wallet Address (DEX exchanges)'),
    privateKey: z.string().optional().describe('Private Key (DEX exchanges)'),
  }),
  subtitleFields: [
    { field: 'exchange', prefix: 'CCXT · ' },
    { field: 'sandbox', label: 'Sandbox' },
    { field: 'demoTrading', label: 'Demo' },
  ],
  writeOnlyFields: ['apiKey', 'secret', 'password', 'privateKey'],
  fingerprintFields: ['exchange', 'sandbox', 'demoTrading', 'apiKey', 'walletAddress'],
  toEngineConfig: (d) => {
    // Pass through every defined field — engine's CcxtBroker.configSchema
    // will accept whatever subset the user supplies.
    const out: Record<string, unknown> = { exchange: d.exchange }
    for (const k of ['sandbox', 'demoTrading', 'apiKey', 'secret', 'password', 'uid', 'walletAddress', 'privateKey']) {
      if (d[k] !== undefined && d[k] !== '') out[k] = d[k]
    }
    return out
  },
  isPaper: (d) => Boolean(d.sandbox || d.demoTrading),
}

// ==================== Native-engine presets ====================

export const ALPACA_PRESET: BrokerPresetDef = {
  id: 'alpaca',
  label: 'Alpaca (US Equities)',
  description: 'Commission-free US stocks and ETFs with fractional shares.',
  category: 'recommended',
  hint: 'Paper and Live use **separate** API keys — generate from the matching dashboard at alpaca.markets. Paper is free and unlimited; Live places real orders on real money.',
  defaultName: 'alpaca-paper',
  badge: 'AL',
  badgeColor: 'text-green',
  engine: 'alpaca',
  guardCategory: 'securities',
  modes: [
    { id: 'paper', label: 'Paper Trading' },
    { id: 'live', label: 'Live Trading' },
  ],
  zodSchema: z.object({
    mode: z.enum(['paper', 'live']).default('paper').describe('Mode'),
    apiKey: z.string().min(1).describe('API Key'),
    apiSecret: z.string().min(1).describe('Secret Key'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'Alpaca · ' },
  ],
  writeOnlyFields: ['apiKey', 'apiSecret'],
  fingerprintFields: ['mode', 'apiKey'],
  toEngineConfig: (d) => ({
    paper: d.mode === 'paper',
    apiKey: d.apiKey,
    apiSecret: d.apiSecret,
  }),
}

export const IBKR_PRESET: BrokerPresetDef = {
  id: 'ibkr-tws',
  label: 'IBKR (TWS / IB Gateway)',
  description: 'Interactive Brokers via local TWS or IB Gateway socket — stocks, options, futures, FX, bonds.',
  category: 'recommended',
  hint: 'IBKR auth happens via your TWS/Gateway login — no API keys here. Make sure TWS is running and "Enable ActiveX and Socket Clients" is on (File → Global Configuration → API → Settings). Default ports: 7496 (live) / 7497 (paper). For IB Gateway: 4001 (live) / 4002 (paper).',
  defaultName: 'ibkr',
  badge: 'IB',
  badgeColor: 'text-orange-400',
  engine: 'ibkr',
  guardCategory: 'securities',
  zodSchema: z.object({
    host: z.string().default('127.0.0.1').describe('Host'),
    port: z.coerce.number().int().default(7497).describe('Port'),
    clientId: z.coerce.number().int().default(0).describe('Client ID'),
    accountId: z.string().optional().describe('Account ID (auto-detected from TWS if blank)'),
  }),
  subtitleFields: [
    { field: 'host', prefix: 'TWS ' },
    { field: 'port' },
  ],
  fingerprintFields: ['host', 'port', 'clientId'],
  toEngineConfig: (d) => ({
    host: d.host,
    port: d.port,
    clientId: d.clientId,
    accountId: d.accountId,
  }),
  isPaper: (d) => Number(d.port) === 7497 || Number(d.port) === 4002,
}

export const LONGBRIDGE_PRESET: BrokerPresetDef = {
  id: 'longbridge',
  label: 'Longbridge (HK / US / CN / SG)',
  description: 'Longbridge OpenAPI — multi-region broker for HK, US, CN A-shares (via Stock Connect), and SG equities under one account.',
  category: 'recommended',
  hint: 'Longbridge uses **appKey + appSecret + accessToken** from open.longbridge.com. The access token is long-lived (~90 days) but **does not auto-refresh** — when it expires you must regenerate it in the LB dashboard and update this config. Paper and live use separate credentials; generate from the matching environment.',
  defaultName: 'longbridge-main',
  badge: 'LB',
  badgeColor: 'text-accent',
  engine: 'longbridge',
  guardCategory: 'securities',
  modes: [
    { id: 'live', label: 'Live Trading' },
    { id: 'paper', label: 'Paper Trading' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'paper']).default('live').describe('Mode'),
    appKey: z.string().min(1).describe('App Key'),
    appSecret: z.string().min(1).describe('App Secret'),
    accessToken: z.string().min(1).describe('Access Token'),
  }),
  subtitleFields: [
    { field: 'mode', prefix: 'Longbridge · ' },
  ],
  writeOnlyFields: ['appKey', 'appSecret', 'accessToken'],
  fingerprintFields: ['mode', 'appKey'],
  toEngineConfig: (d) => ({
    appKey: d.appKey,
    appSecret: d.appSecret,
    accessToken: d.accessToken,
    paper: d.mode === 'paper',
  }),
  isPaper: (d) => d.mode === 'paper',
}

// ==================== Other ecosystem brokers (lower-tier, isolated) ====================

export const LEVERUP_PRESET: BrokerPresetDef = {
  id: 'leverup-monad',
  label: 'LeverUp (Monad)',
  description: 'LeverUp perp DEX on Monad. EIP-712 signed orders relayed via One-Click Trading; relayer pays gas + Pyth oracle fees.',
  category: 'crypto',
  hint: `Setup at app.leverup.xyz before filling this form:

1. Approve USDC spending to the LeverUp contract (one-time, required to open positions)
2. Authorize the wallet you'll paste below as a **Trader Agent** on the OneClickAgent contract

Paste the **private key of the authorized wallet** below. LeverUp's team confirmed a main wallet works directly here — anything pasted below has full control over its funds. Use a wallet whose balance you're comfortable with this app touching.`,
  defaultName: 'leverup-main',
  badge: 'LU',
  badgeColor: 'text-accent',
  engine: 'leverup',
  guardCategory: 'crypto',
  modes: [
    { id: 'live', label: 'Mainnet' },
    { id: 'testnet', label: 'Testnet' },
  ],
  zodSchema: z.object({
    mode: z.enum(['live', 'testnet']).default('testnet').describe('Network'),
    privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe('Wallet Private Key'),
  }),
  subtitleFields: [{ field: 'mode', prefix: 'LeverUp · ' }],
  writeOnlyFields: ['privateKey'],
  fingerprintFields: ['mode', 'privateKey'],
  toEngineConfig: (d) => ({
    network: d.mode,
    privateKey: d.privateKey,
  }),
}

// ==================== Testing presets ====================

export const SIMULATOR_PRESET: BrokerPresetDef = {
  id: 'mock-simulator',
  label: 'Simulator (testing only)',
  description: 'In-memory mock broker with manual撮合. No real money, no exchange — use the Dev → Simulator panel to drive prices, fills, and external balance events.',
  category: 'testing',
  hint: 'For UI/AI repro testing only. Positions and orders live in process memory; **everything is wiped on dev server restart**. Connect via the Dev → Simulator panel to inject prices, manually撮合 limit orders, and simulate external transfers / off-platform trades.',
  defaultName: 'simulator',
  badge: 'SM',
  badgeColor: 'text-text-muted',
  engine: 'mock',
  guardCategory: 'crypto',
  zodSchema: z.object({
    cash: z.coerce.number().default(100_000).describe('Starting cash (USD)'),
  }),
  subtitleFields: [
    { field: 'cash', prefix: '$' },
  ],
  // Mock has no real broker identity. The route layer mints a random
  // _instanceId into presetConfig on POST when it's missing; the
  // fingerprint then derives off that, giving each sim a unique id.
  fingerprintFields: ['_instanceId'],
  toEngineConfig: (d) => ({ cash: d.cash }),
  isPaper: () => true,
}

// ==================== Catalog ====================

// Order matters — the wizard renders presets top-down within each
// category section, and `category` itself is split into Recommended →
// Crypto sections in that order. See ui/src/pages/TradingPage.tsx for
// the actual section-grouping logic.
export const BROKER_PRESET_CATALOG: BrokerPresetDef[] = [
  // ---- Recommended ----
  // Real-money-grade brokers first, then Hyperliquid (grandfathered into
  // Recommended out of product history — Alice's earliest paper-trading
  // prototype was modeled on its API).
  IBKR_PRESET,
  ALPACA_PRESET,
  LONGBRIDGE_PRESET,
  HYPERLIQUID_PRESET,
  // ---- Crypto ----
  BINANCE_PRESET,
  OKX_PRESET,
  BYBIT_PRESET,
  BITGET_PRESET,
  LEVERUP_PRESET,
  // Escape hatch — untested CCXT exchanges; lives at the end of Crypto.
  CCXT_CUSTOM_PRESET,
  // ---- Testing ----
  SIMULATOR_PRESET,
]

/** Lookup by id. Throws if unknown. */
export function getBrokerPreset(presetId: string): BrokerPresetDef {
  const preset = BROKER_PRESET_CATALOG.find(p => p.id === presetId)
  if (!preset) {
    throw new Error(`Unknown broker preset: "${presetId}". Known presets: ${BROKER_PRESET_CATALOG.map(p => p.id).join(', ')}`)
  }
  return preset
}

/** Returns true if presetId resolves to a paper/demo/testnet account. */
export function isPaperPreset(presetId: string, presetConfig: Record<string, unknown>): boolean {
  const preset = getBrokerPreset(presetId)
  return preset.isPaper ? preset.isPaper(presetConfig) : defaultIsPaper(presetConfig)
}

// ==================== Derived UTA id ====================

/**
 * Recursively sort object keys so JSON.stringify is deterministic across
 * field-order variations from the wizard / API. Arrays preserve order.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize)
  if (value && typeof value === 'object') {
    const sorted: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key])
    }
    return sorted
  }
  return value
}

/**
 * Derive a stable, broker-identity-anchored UTA id from a preset and its
 * presetConfig. Reads only the fields listed in `preset.fingerprintFields`
 * — missing keys fill as null so identity is stable across optional-field
 * presence variations.
 *
 * Format: `${preset.id}-${8 hex}` (8 hex = 32 bits, ~4 billion buckets;
 * collision risk is negligible for typical user UTA counts).
 *
 * Stability guarantees:
 *   - Same preset + same fingerprint-field values → byte-identical id.
 *   - Object key order doesn't matter (canonical JSON sorts).
 *   - Renaming preset.id breaks all derived ids for that preset (treat
 *     preset id as a stable on-disk identifier; same as we already do).
 */
export function deriveUtaId(preset: BrokerPresetDef, presetConfig: Record<string, unknown>): string {
  const filtered: Record<string, unknown> = {}
  for (const field of preset.fingerprintFields) {
    filtered[field] = presetConfig[field] ?? null
  }
  const payload = `${preset.id}:${JSON.stringify(canonicalize(filtered))}`
  const hash = createHash('sha256').update(payload).digest('hex').slice(0, 8)
  return `${preset.id}-${hash}`
}

/**
 * Mint a random short hex token. Used by the create route to seed
 * `_instanceId` on Mock presets so each sim UTA gets a unique fingerprint.
 */
export function mintInstanceId(): string {
  return randomBytes(4).toString('hex')
}
