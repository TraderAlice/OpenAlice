/**
 * Broker Registry — maps type strings to broker classes.
 *
 * Each broker self-registers via static configSchema + configFields + fromConfig.
 * Adding a new broker: import it here and add one entry to the registry.
 */

import type { z } from 'zod'
import type { IBroker, BrokerConfigField } from './types.js'
import type { AccountConfig } from '../../../core/config.js'
import { CcxtBroker } from './ccxt/CcxtBroker.js'
import { AlpacaBroker } from './alpaca/AlpacaBroker.js'
import { IbkrBroker } from './ibkr/IbkrBroker.js'
import { IolBroker } from './iol/IolBroker.js'

// ==================== Subtitle field descriptor ====================

export interface SubtitleField {
  field: string
  /** Text to show when boolean field is true */
  label?: string
  /** Text to show when boolean field is false (omitted = don't show) */
  falseLabel?: string
  /** Prefix before the value (e.g. "TWS ") */
  prefix?: string
}

// ==================== Registry entry ====================

export interface BrokerRegistryEntry {
  /** Zod schema for validating brokerConfig fields */
  configSchema: z.ZodType
  /** UI field descriptors for dynamic form rendering */
  configFields: BrokerConfigField[]
  /** Construct a broker instance from AccountConfig */
  fromConfig: (config: AccountConfig) => IBroker
  /** Display name */
  name: string
  /** Short description */
  description: string
  /** Badge text (2-3 chars) */
  badge: string
  /** Tailwind badge color class */
  badgeColor: string
  /** Fields to show in account card subtitle */
  subtitleFields: SubtitleField[]
  /** Guard category — determines which guard types are available */
  guardCategory: 'crypto' | 'securities'
  /** Multi-line setup guide shown in the New Account wizard. Paragraphs separated by `\n\n`. */
  setupGuide?: string
}

// ==================== Registry ====================

export const BROKER_REGISTRY: Record<string, BrokerRegistryEntry> = {
  ccxt: {
    configSchema: CcxtBroker.configSchema,
    configFields: CcxtBroker.configFields,
    fromConfig: CcxtBroker.fromConfig,
    name: 'CCXT (Crypto)',
    description: 'Unified API for 100+ crypto exchanges. Supports Binance, Bybit, OKX, Coinbase, and more.',
    badge: 'CC',
    badgeColor: 'text-accent',
    subtitleFields: [
      { field: 'exchange' },
      { field: 'demoTrading', label: 'Demo' },
      { field: 'sandbox', label: 'Sandbox' },
    ],
    guardCategory: 'crypto',
    setupGuide: `CCXT is a unified library that connects to 100+ cryptocurrency exchanges through a single API. After picking a specific exchange below, the form will auto-load the credential fields that exchange requires.

Most exchanges (Binance, Bybit, OKX, etc.) use API key + secret — you can create them in your exchange account's API settings. OKX additionally requires a passphrase you set when creating the key.

Wallet-based exchanges like Hyperliquid use a wallet address + private key instead. For Hyperliquid, you can generate a dedicated API wallet at app.hyperliquid.xyz/API to avoid exposing your main wallet's private key.

Make sure to grant only the permissions you need (read + trade), and never enable withdrawal permissions on automated trading keys.`,
  },
  alpaca: {
    configSchema: AlpacaBroker.configSchema,
    configFields: AlpacaBroker.configFields,
    fromConfig: AlpacaBroker.fromConfig,
    name: 'Alpaca (Securities)',
    description: 'Commission-free US equities and ETFs with fractional share support.',
    badge: 'AL',
    badgeColor: 'text-green',
    subtitleFields: [
      { field: 'paper', label: 'Paper Trading', falseLabel: 'Live Trading' },
    ],
    guardCategory: 'securities',
    setupGuide: `Alpaca is a commission-free US equities broker with a clean REST API. It supports paper trading (free, simulated) and live trading.

Sign up at alpaca.markets, then create API keys from the dashboard. Toggle "Paper" on this form to use the paper trading endpoint with your paper keys, or off for live trading with your live keys (different key sets).`,
  },
  ibkr: {
    configSchema: IbkrBroker.configSchema,
    configFields: IbkrBroker.configFields,
    fromConfig: IbkrBroker.fromConfig,
    name: 'IBKR (Interactive Brokers)',
    description: 'Professional-grade trading via TWS or IB Gateway. Stocks, options, futures, bonds.',
    badge: 'IB',
    badgeColor: 'text-orange-400',
    subtitleFields: [
      { field: 'host', prefix: 'TWS ' },
      { field: 'port' },
    ],
    guardCategory: 'securities',
    setupGuide: `Interactive Brokers requires a local TWS (Trader Workstation) or IB Gateway process running on your machine. OpenAlice connects to it over a TCP socket — no API key needed, authentication happens via TWS login.

Before connecting:
1. Open TWS / IB Gateway and log in to your paper or live account
2. Enable API access: File → Global Configuration → API → Settings → "Enable ActiveX and Socket Clients"
3. Note the socket port (paper: 7497, live: 7496)
4. Add 127.0.0.1 to "Trusted IPs" if running locally

Paper trading requires a separate paper account login in TWS.`,
  },
  iol: {
    configSchema: IolBroker.configSchema,
    configFields: IolBroker.configFields,
    fromConfig: IolBroker.fromConfig,
    name: 'InvertirOnline (IOL)',
    description: 'Argentine broker — BYMA equities, CEDEARs, sovereign bonds, FCIs, and US markets.',
    badge: 'IO',
    badgeColor: 'text-blue-400',
    subtitleFields: [
      { field: 'market' },
      { field: 'sandbox', label: 'Dry-run' },
    ],
    guardCategory: 'securities',
    setupGuide: `InvertirOnline (IOL) is an Argentine retail broker with a REST API at api.invertironline.com. Authentication uses your IOL username and password via OAuth2 password grant — the same credentials you use to log in at invertironline.com.

Credentials can be supplied in three ways (checked in order):

1. Literal values in the Username / Password fields below — stored in data/config/accounts.json (gitignored).
2. Environment-variable references like "$env:MY_IOL_PASSWORD" in either field — OpenAlice reads process.env at init time.
3. Leave both fields blank and export IOL_USERNAME and IOL_PASSWORD in your shell (or a .env file loaded by your process manager).

The third pattern keeps credentials entirely out of config files and out of any agent context — useful when the agent itself should never see them.

Default Market controls where quotes and orders go when a contract does not specify one. "Dry-run" mode short-circuits placeOrder so you can verify the wiring without sending real orders.`,
  },
}
