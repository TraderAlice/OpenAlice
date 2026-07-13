/**
 * App Loader — load providers and mount extension routers.
 * Maps to: openbb_core/api/app_loader.py
 *
 * In Python, RegistryLoader uses entry_points for dynamic discovery.
 * In TypeScript, providers and routers are explicitly imported
 * (simpler, tree-shake friendly, easier to debug).
 */

import { Registry } from '../provider/registry.js'
import { QueryExecutor } from '../provider/query-executor.js'
import { Router } from '../app/router.js'

// --- Providers (explicit imports replace entry_points) ---
import { fmpProvider } from '../../providers/fmp/index.js'
import { yfinanceProvider } from '../../providers/yfinance/index.js'
import { deribitProvider } from '../../providers/deribit/index.js'
import { cboeProvider } from '../../providers/cboe/index.js'
import { multplProvider } from '../../providers/multpl/index.js'
import { oecdProvider } from '../../providers/oecd/index.js'
import { econdbProvider } from '../../providers/econdb/index.js'
import { imfProvider } from '../../providers/imf/index.js'
import { ecbProvider } from '../../providers/ecb/index.js'
import { federalReserveProvider } from '../../providers/federal_reserve/index.js'
import { intrinioProvider } from '../../providers/intrinio/index.js'
import { blsProvider } from '../../providers/bls/index.js'
import { eiaProvider } from '../../providers/eia/index.js'
import { secProvider } from '../../providers/sec/index.js'
import { eastmoneyProvider } from '../../providers/eastmoney/index.js'
import { twseProvider } from '../../providers/twse/index.js'

// --- Extension routers ---
import { equityRouter } from '../../extensions/equity/equity-router.js'
import { cryptoRouter } from '../../extensions/crypto/crypto-router.js'
import { currencyRouter } from '../../extensions/currency/currency-router.js'
import { newsRouter } from '../../extensions/news/news-router.js'
import { economyRouter } from '../../extensions/economy/economy-router.js'
import { etfRouter } from '../../extensions/etf/etf-router.js'
import { indexRouter } from '../../extensions/index/index-router.js'
import { derivativesRouter } from '../../extensions/derivatives/derivatives-router.js'
import { commodityRouter } from '../../extensions/commodity/commodity-router.js'

/**
 * Create and populate a Registry with all available providers.
 * Maps to: RegistryLoader.from_extensions() in registry_loader.py
 */
export function createRegistry(): Registry {
  const registry = new Registry()
  registry.includeProvider(fmpProvider)
  registry.includeProvider(yfinanceProvider)
  registry.includeProvider(deribitProvider)
  registry.includeProvider(cboeProvider)
  registry.includeProvider(multplProvider)
  registry.includeProvider(oecdProvider)
  registry.includeProvider(econdbProvider)
  registry.includeProvider(imfProvider)
  registry.includeProvider(ecbProvider)
  registry.includeProvider(federalReserveProvider)
  registry.includeProvider(intrinioProvider)
  registry.includeProvider(blsProvider)
  registry.includeProvider(eiaProvider)
  registry.includeProvider(secProvider)
  registry.includeProvider(eastmoneyProvider)
  registry.includeProvider(twseProvider)
  return registry
}

/**
 * Create a QueryExecutor with all providers loaded.
 */
export function createExecutor(): QueryExecutor {
  const registry = createRegistry()
  return new QueryExecutor(registry)
}

/**
 * Load all extension routers and return a root router.
 * Maps to: RouterLoader in app_loader.py
 */
export function loadAllRouters(): Router {
  const root = new Router({ description: 'OpenTypeBB API' })
  root.includeRouter(equityRouter)
  root.includeRouter(cryptoRouter)
  root.includeRouter(currencyRouter)
  root.includeRouter(newsRouter)
  root.includeRouter(economyRouter)
  root.includeRouter(etfRouter)
  root.includeRouter(indexRouter)
  root.includeRouter(derivativesRouter)
  root.includeRouter(commodityRouter)
  return root
}
