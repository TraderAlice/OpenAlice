/**
 * Provider class.
 * Maps to: openbb_core/provider/abstract/provider.py
 *
 * Serves as the provider extension entry point. Each data provider
 * (yfinance, fmp, sec, etc.) creates a Provider instance with its
 * name, description, credentials, and a fetcher_dict mapping model
 * names to Fetcher classes.
 */

import type { FetcherClass } from './fetcher.js'

/**
 * Agent-facing self-description for a user-toggleable market-data vendor.
 *
 * Its PRESENCE is the signal that this provider is a "chart vendor" the user
 * can switch on/off (yfinance / eastmoney / twse) — internal providers (fmp,
 * deribit, fred, …) leave it undefined and stay out of the vendor picker.
 * Carries only prose: everything structural (keyless ← credentials, always-on
 * ← primary, enabled ← extraVendors) is derived elsewhere, not duplicated here.
 */
export interface VendorMeta {
  /** What markets / instruments this vendor covers — one line. */
  coverage: string
  /**
   * How an agent should drive it: symbol convention, search-language quirks
   * (e.g. "search 繁体中文, not simplified"), any gotcha worth knowing before
   * the first query. Written for the AI that will call it via the CLI.
   */
  howToUse: string
}

export interface ProviderConfig {
  /** Short name of the provider (e.g., "fmp", "yfinance"). */
  name: string
  /** Description of the provider. */
  description: string
  /** Website URL of the provider. */
  website?: string
  /**
   * Self-description for user-toggleable chart vendors. Define it to opt this
   * provider into the vendor picker (`alice market vendors`); leave it off for
   * internal/back-end providers. See {@link VendorMeta}.
   */
  vendorMeta?: VendorMeta
  /**
   * List of required credential names (without provider prefix).
   * Will be auto-prefixed with the provider name.
   * Example: ["api_key"] → ["fmp_api_key"]
   */
  credentials?: string[]
  /**
   * Dictionary mapping model names to Fetcher classes.
   * Example: { "EquityHistorical": FMPEquityHistoricalFetcher }
   */
  fetcherDict: Record<string, FetcherClass>
  /** Full display name of the provider. */
  reprName?: string
  /** Instructions on how to set up the provider (e.g., how to get an API key). */
  instructions?: string
}

export class Provider {
  readonly name: string
  readonly description: string
  readonly website?: string
  readonly credentials: string[]
  readonly fetcherDict: Record<string, FetcherClass>
  readonly reprName?: string
  readonly instructions?: string
  readonly vendorMeta?: VendorMeta

  constructor(config: ProviderConfig) {
    this.name = config.name
    this.description = config.description
    this.website = config.website
    this.fetcherDict = config.fetcherDict
    this.reprName = config.reprName
    this.instructions = config.instructions
    this.vendorMeta = config.vendorMeta

    // Auto-prefix credentials with provider name (matches Python behavior)
    // Example: credentials=["api_key"], name="fmp" → ["fmp_api_key"]
    if (config.credentials) {
      this.credentials = config.credentials.map(
        (c) => `${this.name.toLowerCase()}_${c}`,
      )
    } else {
      this.credentials = []
    }
  }
}
