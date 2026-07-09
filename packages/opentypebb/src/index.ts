/**
 * Internal provider-compatibility entry point for OpenAlice.
 *
 * This package is not a standalone OpenBB product or external SDK. New product
 * contracts belong to TraderHub, BarService, and OpenAlice's typed domain
 * services; this module carries the remaining provider/model/router adapters.
 */

// Core abstractions
export { Fetcher, type FetcherClass } from './core/provider/abstract/fetcher.js'
export { Provider, type ProviderConfig, type VendorMeta } from './core/provider/abstract/provider.js'
export { BaseQueryParamsSchema, type BaseQueryParams } from './core/provider/abstract/query-params.js'
export { BaseDataSchema, type BaseData, ForceInt } from './core/provider/abstract/data.js'

// Registry & execution
export { Registry } from './core/provider/registry.js'
export { QueryExecutor } from './core/provider/query-executor.js'

// App model
export { OBBject, type OBBjectData, type Warning } from './core/app/model/obbject.js'
export { type Credentials, buildCredentials } from './core/app/model/credentials.js'
export { type RequestMetadata, createMetadata } from './core/app/model/metadata.js'

// App
export { Query, type QueryConfig } from './core/app/query.js'
export { CommandRunner } from './core/app/command-runner.js'
export { Router, type CommandDef, type CommandHandler } from './core/app/router.js'

// Utilities
export { amakeRequest, applyAliases, replaceEmptyStrings, buildQueryString } from './core/provider/utils/helpers.js'
export { OpenBBError, EmptyDataError, UnauthorizedError, NetworkUnreachableError, RateLimitedError } from './core/provider/utils/errors.js'

// App loader — convenience functions to create a fully-loaded system
export { createRegistry, createExecutor, loadAllRouters } from './core/api/app-loader.js'

// Compatibility widget metadata used by the embedded HTTP mount
export { buildWidgetsJson } from './core/api/widgets.js'

// Standard models — data types for all asset classes
export * from './standard-models/index.js'

// Pre-built providers (for direct import if needed)
export { fmpProvider } from './providers/fmp/index.js'
export { yfinanceProvider } from './providers/yfinance/index.js'
export { deribitProvider } from './providers/deribit/index.js'
export { cboeProvider } from './providers/cboe/index.js'
export { multplProvider } from './providers/multpl/index.js'
export { oecdProvider } from './providers/oecd/index.js'
export { econdbProvider } from './providers/econdb/index.js'
export { imfProvider } from './providers/imf/index.js'
export { ecbProvider } from './providers/ecb/index.js'
export { federalReserveProvider } from './providers/federal_reserve/index.js'
export { intrinioProvider } from './providers/intrinio/index.js'
export { eastmoneyProvider } from './providers/eastmoney/index.js'
export { twseProvider } from './providers/twse/index.js'
export { tradingviewProvider } from './providers/tradingview/index.js'
export {
  TRADINGVIEW_BAR_CAPABILITY,
  TRADINGVIEW_PROVIDER_ID,
  supportsTradingViewInternalIntrabar,
} from './providers/tradingview/domain.js'
