import { expect, it } from 'vitest'
import { inspectBarQuality, invalidOhlcFields } from './quality.js'
it('retains zero and negative prices but diagnoses null, non-finite and non-number values', () => {
  expect(invalidOhlcFields({ open: 0, high: 0, low: -2, close: -1 })).toEqual([])
  expect(invalidOhlcFields({ open: null, high: Infinity, low: '1', close: NaN })).toEqual(['open', 'high', 'low', 'close'])
})
it('reports the latest excluded record even when input is unsorted or entirely invalid', () => {
  expect(inspectBarQuality([{ date: '2026-09-08', open: 1, high: 2, low: 1, close: null }, { date: '2026-09-07' }])).toMatchObject({ excludedRows: 2, latestExcludedRecordAt: '2026-09-08', latestExcludedFields: ['close'] })
  expect(inspectBarQuality([])).toMatchObject({ inspectedRows: 0, excludedRows: 0, latestExcludedRecordAt: null, reason: null })
})
