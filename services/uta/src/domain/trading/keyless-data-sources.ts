import type { KeylessDataSource, UTAConfig } from '@/core/config.js'

const LABELS: Record<KeylessDataSource, string> = {
  binance: 'Binance',
  okx: 'OKX',
  bybit: 'Bybit',
}

/**
 * Build optional keyless public-data UTAs for crypto K-line federation.
 *
 * These are not persisted to accounts.json and are opt-in via trading.json.
 * Treating public data venues as default broker accounts made fresh installs
 * connect to multiple crypto exchanges without consent; this keeps them as
 * explicit data-source choices.
 */
export function buildKeylessDataUTAs(
  sources: readonly KeylessDataSource[],
  existingIds: ReadonlySet<string>,
): UTAConfig[] {
  const unique = [...new Set(sources)]
  return unique
    .filter((ex) => !existingIds.has(`${ex}-readonly`))
    .map((ex) => ({
      id: `${ex}-readonly`,
      label: `${LABELS[ex]} (read-only data)`,
      presetId: 'ccxt-custom',
      enabled: true,
      guards: [],
      presetConfig: { exchange: ex },
      keyless: true,
      readOnly: true,
      asVendor: true,
      editable: false,
    }))
}
