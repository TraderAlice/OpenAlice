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

  return Object.keys(mapped).length > 0 ? JSON.stringify(mapped) : undefined
}
