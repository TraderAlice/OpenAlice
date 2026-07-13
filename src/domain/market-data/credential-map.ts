/**
 * Maps OpenAlice provider key names to the SDK's credential field names.
 *
 * Field names follow the provider's auto-prefixed credential
 * (`Provider` constructor at packages/opentypebb/src/core/provider/abstract/provider.ts:54-59
 * prepends the provider name to declared credentials, so e.g.
 * `federal_reserve` provider with `credentials: ['api_key']` ends up
 * requiring `federal_reserve_api_key`). Only `fred` (user-key) ↔
 * `federal_reserve` (provider-name) diverges from the 1:1 pattern.
 *
 * (The HTTP header path — X-OpenBB-Credentials for the external Python
 * sidecar — died with the openbb-api backend.)
 */

const sdkKeyMapping: Record<string, string> = {
  fred: 'federal_reserve_api_key',  // user-key ≠ provider-name; SDK path needs provider-prefixed name
  fmp: 'fmp_api_key',
  eia: 'eia_api_key',
  bls: 'bls_api_key',
  nasdaq: 'nasdaq_api_key',
  tradingeconomics: 'tradingeconomics_api_key',
  econdb: 'econdb_api_key',
  intrinio: 'intrinio_api_key',
  benzinga: 'benzinga_api_key',
  tiingo: 'tiingo_token',
  biztoc: 'biztoc_api_key',
}

function applyMapping(
  providerKeys: Record<string, string | undefined> | undefined,
  table: Record<string, string>,
): Record<string, string> {
  if (!providerKeys) return {}
  const mapped: Record<string, string> = {}
  for (const [k, v] of Object.entries(providerKeys)) {
    if (v && table[k]) mapped[table[k]] = v
  }
  return mapped
}

/**
 * Build credentials for the embedded provider executor.
 * Field names follow the SDK's auto-prefixed credential convention
 * (provider name + cred name) — see file header for why this differs
 * from the HTTP header path.
 */
export function buildSDKCredentials(
  providerKeys: Record<string, string | undefined> | undefined,
  hub?: { enabled: boolean; baseUrl: string },
): Record<string, string> {
  const mapped = applyMapping(providerKeys, sdkKeyMapping)
  // Hub-proxy sentinel: for origin-centralized keyed providers, a missing
  // user key becomes `hub:<baseUrl>` — the SDK fetcher swaps the upstream
  // origin for the TraderHub keyed proxy (which injects its own key) and
  // keeps its own transforms. User keys always win over the hub.
  if (hub?.enabled && hub.baseUrl) {
    for (const field of ['federal_reserve_api_key', 'eia_api_key', 'bls_api_key']) {
      if (!mapped[field]) mapped[field] = `hub:${hub.baseUrl}`
    }
  }
  return mapped
}
