/**
 * Maps OpenAlice provider key names to OpenBB credential field names.
 *
 * OpenAlice config (openbb.json):   { "fred": "abc123" }
 * OpenBB expects:                   { "fred_api_key": "abc123" }
 */

const keyMapping: Record<string, string> = {
  fred: 'fred_api_key',
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

/**
 * Build the JSON string for the X-OpenBB-Credentials header.
 * Returns undefined if no keys are configured.
 */
export function buildCredentialsHeader(
  providerKeys: Record<string, string | undefined> | undefined,
): string | undefined {
  if (!providerKeys) return undefined

  const mapped: Record<string, string> = {}
  for (const [k, v] of Object.entries(providerKeys)) {
    if (v && keyMapping[k]) mapped[keyMapping[k]] = v
  }

  // Same api_key alias for federal_reserve provider (see buildSDKCredentials)
  if (mapped.fred_api_key && !mapped.api_key) {
    mapped.api_key = mapped.fred_api_key
  }

  return Object.keys(mapped).length > 0 ? JSON.stringify(mapped) : undefined
}

/**
 * Build credentials object for OpenTypeBB SDK executor.
 * Same mapping as buildCredentialsHeader, but returns a plain object
 * instead of a JSON string (executor.execute() accepts Record<string, string>).
 */
export function buildSDKCredentials(
  providerKeys: Record<string, string | undefined> | undefined,
): Record<string, string> {
  if (!providerKeys) return {}

  const mapped: Record<string, string> = {}
  for (const [k, v] of Object.entries(providerKeys)) {
    if (v && keyMapping[k]) mapped[keyMapping[k]] = v
  }

  // federal_reserve provider declares credentials: ['api_key'] but getFredApiKey
  // looks for fred_api_key first. Emit both so filterCredentials passes api_key
  // through and getFredApiKey can resolve via either field.
  if (mapped.fred_api_key && !mapped.api_key) {
    mapped.api_key = mapped.fred_api_key
  }

  return mapped
}
