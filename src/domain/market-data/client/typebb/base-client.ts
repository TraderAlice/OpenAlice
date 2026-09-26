/**
 * SDK Base Client
 *
 * Replaces HTTP fetch with in-process executor.execute() calls.
 * All 6 domain-specific SDK clients (equity, crypto, currency, news, economy, commodity)
 * extend this class and expose the same method signatures as their HTTP counterparts.
 *
 * Data flow:
 *   client.getQuote(params) → this.request('/price/quote', params)
 *     → resolve model via routeMap: '/equity/price/quote' → 'EquityQuote'
 *     → executor.execute('fmp', 'EquityQuote', params, credentials)
 */

import type { QueryExecutor } from '@traderalice/opentypebb'

/** Snapshot or per-request getter — Settings can add providerKeys without a restart. */
export type CredentialsSource = Record<string, string> | (() => Record<string, string>)

export class SDKBaseClient {
  constructor(
    protected executor: QueryExecutor,
    protected routePrefix: string, // 'equity' | 'crypto' | 'currency' | 'news' | 'economy' | 'commodity'
    protected defaultProvider: string | undefined,
    protected credentials: CredentialsSource,
    protected routeMap: Map<string, string>,
  ) {}

  protected resolveCredentials(): Record<string, string> {
    return typeof this.credentials === 'function' ? this.credentials() : this.credentials
  }

  protected async request<T = Record<string, unknown>>(
    path: string,
    params: Record<string, unknown> = {},
  ): Promise<T[]> {
    const fullPath = `/${this.routePrefix}${path}`
    const model = this.routeMap.get(fullPath)
    if (!model) {
      throw new Error(`No SDK route for: ${fullPath}`)
    }

    const provider = (params.provider as string) ?? this.defaultProvider
    if (!provider) {
      throw new Error(`No provider specified for: ${fullPath}`)
    }

    // Remove 'provider' from params — executor takes it as a separate argument
    const { provider: _, ...cleanParams } = params

    return this.executor.execute(provider, model, cleanParams, this.resolveCredentials()) as Promise<T[]>
  }
}
