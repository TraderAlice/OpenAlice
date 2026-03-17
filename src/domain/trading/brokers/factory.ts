/**
 * Broker Factory — creates broker instances from config.
 *
 * IPlatform defines HOW to connect (exchange type, sandbox, etc.).
 * Multiple accounts can share one platform, each with individual credentials.
 */

import type { IBroker } from './types.js'
import { CcxtPlatform } from './ccxt/CcxtPlatform.js'
import { AlpacaPlatform } from './alpaca/AlpacaPlatform.js'
import type { PlatformConfig, AccountConfig } from '../../../core/config.js'

// ==================== Platform ====================

/** Credentials passed to IPlatform.createAccount(). */
export interface PlatformCredentials {
  id: string
  label?: string
  apiKey?: string
  apiSecret?: string
  password?: string
}

export interface IPlatform {
  /** Unique platform id, e.g. "bybit-swap", "alpaca-paper". */
  readonly id: string

  /** Human-readable name, e.g. "Bybit USDT Perps". */
  readonly label: string

  /**
   * Provider class tag. Matches IBroker.provider on created accounts.
   * CcxtPlatform → exchange name (e.g. "bybit").
   * AlpacaPlatform → "alpaca".
   */
  readonly providerType: string

  /** Create a new IBroker instance from per-account credentials. */
  createAccount(credentials: PlatformCredentials): IBroker
}

// ==================== Config → Platform/Broker helpers ====================

/** Create an IPlatform from a parsed PlatformConfig. */
export function createPlatformFromConfig(config: PlatformConfig): IPlatform {
  switch (config.type) {
    case 'ccxt':
      return new CcxtPlatform({
        id: config.id,
        label: config.label,
        exchange: config.exchange,
        sandbox: config.sandbox,
        demoTrading: config.demoTrading,
        defaultMarketType: config.defaultMarketType,
        options: config.options,
      })
    case 'alpaca':
      return new AlpacaPlatform({
        id: config.id,
        label: config.label,
        paper: config.paper,
      })
  }
}

/** Create an IBroker from a platform + account config. */
export function createBrokerFromConfig(
  platform: IPlatform,
  accountConfig: AccountConfig,
): IBroker {
  const credentials: PlatformCredentials = {
    id: accountConfig.id,
    label: accountConfig.label,
    apiKey: accountConfig.apiKey,
    apiSecret: accountConfig.apiSecret,
    password: accountConfig.password,
  }
  return platform.createAccount(credentials)
}

/** Validate that all account platformId references resolve to a known platform. */
export function validatePlatformRefs(
  platforms: IPlatform[],
  accounts: AccountConfig[],
): void {
  const platformIds = new Set(platforms.map((p) => p.id))
  for (const acc of accounts) {
    if (!platformIds.has(acc.platformId)) {
      throw new Error(
        `Account "${acc.id}" references unknown platformId "${acc.platformId}". ` +
          `Available platforms: ${[...platformIds].join(', ')}`,
      )
    }
  }
}
