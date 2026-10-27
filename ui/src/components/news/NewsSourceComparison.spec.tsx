import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { i18n } from '../../i18n'
import { NewsSourceComparison } from './NewsSourceComparison'
import type { NewsStoryDetail } from '../../api/types'

afterEach(cleanup)
it('orders only comparable publication times and keeps prepared annotations linked to exact originals', async () => {
  await i18n.changeLanguage('en')
  const report = (id: number, time: string, timeBasis?: 'collection') => ({ id, time, timeBasis, source: `Source ${id}`, title: `Report ${id}`, content: '', link: null, categories: null, image: null })
  const reports = [report(4, '2026-10-27T08:00:00Z', 'collection'), report(3, 'unknown'), report(2, '2026-10-27T10:00:00Z'), report(1, '2026-10-27T10:00:00Z')]
  const onEvidence = vi.fn()
  const comparisons: NewsStoryDetail['comparisons'] = [{ kind: 'correction', summary: 'The later report corrected the total.', reportIds: [1, 2] }]
  render(<NewsSourceComparison reports={reports} comparisons={comparisons} onEvidence={onEvidence} time={value => value} />)
  fireEvent.click(screen.getByText('Compare sources'))
  expect(screen.getAllByRole('row').slice(1).map(row => row.textContent)).toEqual([
    expect.stringContaining('Report 1'), expect.stringContaining('Report 2'), expect.stringContaining('Report 3'), expect.stringContaining('Report 4'),
  ])
  expect(screen.getAllByText('Earliest among collected reports')).toHaveLength(2)
  expect(screen.getByText('Publication time unknown')).toBeTruthy()
  expect(screen.getByText(/Collected .*publication time unavailable/)).toBeTruthy()
  fireEvent.click(within(screen.getByRole('group', { name: 'Prepared source notes' })).getByRole('button'))
  expect(onEvidence).toHaveBeenCalledWith([1, 2])
  fireEvent.click(screen.getByRole('button', { name: 'Read original: Report 4' }))
  expect(onEvidence).toHaveBeenLastCalledWith([4])
})
