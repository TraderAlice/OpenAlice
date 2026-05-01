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

// ==================== Types ====================

export type BrokerEngine = 'ccxt' | 'alpaca' | 'ibkr'

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
  /** Stable id stored on disk in UTAConfig.presetId. */
  id: string
  /** User-facing label in the wizard. */
  label: string
  /** Short description shown under the label. */
  description: string
  /** Group in the picker UI. */
  category: 'crypto' | 'securities' | 'custom'
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
  category: 'crypto',
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
  category: 'custom',
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
  category: 'securities',
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
  category: 'securities',
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
  toEngineConfig: (d) => ({
    host: d.host,
    port: d.port,
    clientId: d.clientId,
    accountId: d.accountId,
  }),
  isPaper: (d) => Number(d.port) === 7497 || Number(d.port) === 4002,
}

// ==================== Catalog ====================

export const BROKER_PRESET_CATALOG: BrokerPresetDef[] = [
  // Crypto (tested with real API keys)
  OKX_PRESET,
  BYBIT_PRESET,
  HYPERLIQUID_PRESET,
  BITGET_PRESET,
  // Securities
  ALPACA_PRESET,
  IBKR_PRESET,
  // Escape hatch (untested exchanges)
  CCXT_CUSTOM_PRESET,
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
