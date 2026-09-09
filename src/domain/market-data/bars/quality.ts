export interface BarQuality {
  scope: 'fetched_window_before_count'
  inspectedRows: number
  excludedRows: number
  latestExcludedRecordAt: string | null
  latestExcludedFields: string[]
  reason: 'missing_or_non_finite_ohlc' | null
}
const fields = ['open', 'high', 'low', 'close'] as const
export function invalidOhlcFields(row: Record<string, unknown>): string[] {
  return fields.filter(field => typeof row[field] !== 'number' || !Number.isFinite(row[field]))
}
export function inspectBarQuality(rows: Array<Record<string, unknown>>): BarQuality {
  const excluded = rows.filter(row => invalidOhlcFields(row).length > 0)
  const latest = excluded.filter(row => typeof row.date === 'string').sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1)
  return {
    scope: 'fetched_window_before_count', inspectedRows: rows.length, excludedRows: excluded.length,
    latestExcludedRecordAt: latest ? String(latest.date) : null,
    latestExcludedFields: latest ? invalidOhlcFields(latest) : [],
    reason: excluded.length ? 'missing_or_non_finite_ohlc' : null,
  }
}
