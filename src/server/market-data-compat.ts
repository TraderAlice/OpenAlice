/**
 * Embedded market-data compatibility mount.
 *
 * Mounts the remaining provider/model/router adapters into Alice's Hono app.
 * This is an internal bridge for existing typed clients and compatibility HTTP
 * routes, not a standalone OpenTypeBB server or a new product contract.
 */

import type { Hono } from 'hono'
import {
  loadAllRouters,
  buildWidgetsJson,
  createRegistry,
  type QueryExecutor,
} from '@traderalice/opentypebb'

export interface DefaultProviders {
  /** Also used for etf/index/derivatives, matching main.ts client construction. */
  equity: string
  crypto: string
  currency: string
  commodity: string
}

export interface MountMarketDataCompatOptions {
  /** URL prefix to mount routes under (e.g. `/api/market-data-v1`). */
  basePath: string
  /**
   * Credentials injected into every request that does not supply its own
   * `X-OpenBB-Credentials` header — typically the server-side provider keys.
   * Pass a getter to have it evaluated per-request (config changes take
   * effect without remounting / restarting).
   */
  defaultCredentials: Record<string, string> | (() => Record<string, string>)
  /**
   * Per-asset-class default provider, used when the request omits `?provider=`.
   * The asset class is the first path segment after `basePath`.
   * Pass a getter for live config updates.
   */
  defaultProviders: DefaultProviders | (() => DefaultProviders)
}

function makeProviderResolver(
  basePath: string,
  getProviders: () => DefaultProviders,
): (path: string) => string | undefined {
  return (path: string) => {
    const providers = getProviders()
    const sub = path.slice(basePath.length).replace(/^\/+/, '').split('/')[0]
    switch (sub) {
      case 'equity':
      case 'etf':
      case 'index':
      case 'derivatives':
        return providers.equity
      case 'crypto':
        return providers.crypto
      case 'currency':
        return providers.currency
      case 'commodity':
        return providers.commodity
      default:
        return undefined
    }
  }
}

export function mountMarketDataCompat(
  app: Hono,
  executor: QueryExecutor,
  opts: MountMarketDataCompatOptions,
): void {
  const rootRouter = loadAllRouters()
  const registry = createRegistry()

  const getProviders =
    typeof opts.defaultProviders === 'function'
      ? opts.defaultProviders
      : () => opts.defaultProviders as DefaultProviders
  const getCredentials =
    typeof opts.defaultCredentials === 'function'
      ? opts.defaultCredentials
      : () => opts.defaultCredentials as Record<string, string>

  const resolveProvider = makeProviderResolver(opts.basePath, getProviders)
  rootRouter.mountToHono(app, executor, opts.basePath, getCredentials, resolveProvider)

  const widgetsJson = buildWidgetsJson(rootRouter, registry)
  app.get(`${opts.basePath}/widgets.json`, (c) => c.json(widgetsJson))

  console.log(
    `[market-data-compat] mounted on ${opts.basePath} (${Object.keys(widgetsJson).length} entries)`,
  )
}
