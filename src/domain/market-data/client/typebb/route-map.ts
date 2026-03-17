/**
 * Route Map Builder
 *
 * Dynamically builds a path → model name mapping from OpenTypeBB's router system.
 * e.g. '/equity/price/quote' → 'EquityQuote'
 *
 * This mapping allows SDKBaseClient.request(path) to resolve which fetcher model
 * to call for each API path, providing a drop-in replacement for HTTP routing.
 */

import { loadAllRouters } from '@traderalice/opentypebb'

let _routeMap: Map<string, string> | null = null

export function buildRouteMap(): Map<string, string> {
  if (_routeMap) return _routeMap

  const root = loadAllRouters()
  const commands = root.getCommandMap() // Map<fullPath, CommandDef>
  const map = new Map<string, string>()

  for (const [path, cmd] of commands) {
    map.set(path, cmd.model)
  }

  _routeMap = map
  return map
}
