import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { NewsStoryDetail } from '../../api/types'
import { i18n } from '../../i18n'
import { NewsAssociations } from './NewsAssociations'

const mocks = vi.hoisted(() => ({ open: vi.fn() }))
vi.mock('../../tabs/store', () => ({ useWorkspace: (select: (state: { openOrFocus: typeof mocks.open }) => unknown) => select({ openOrFocus: mocks.open }) }))
afterEach(() => { cleanup(); mocks.open.mockReset() })
it('separates sourced relevance from conditional analysis and routes exact evidence and source-specific assets', async () => {
  await i18n.changeLanguage('en')
  const onEvidence = vi.fn()
  const evidence = [{ reportId: 1, field: 'content' as const, sha256: '0'.repeat(64), excerpt: 'An attributed statement.' }]
  const view: NonNullable<NewsStoryDetail['associations']> = { status: 'current', current: { version: 1, storyId: 'policy', revision: 1, storyRevision: 1, preparedAt: '2026-10-27T00:00:00Z', preparedBy: 'Reviewer', protected: true, authority: 'operator', unresolved: [{ label: 'Apple', reason: 'An ambiguous name.' }], relations: [
    { id: 'country', country: 'CA', kind: 'mentioned', status: 'active', explanation: 'Canada is mentioned in the original.', evidence },
    { id: 'asset', asset: { barId: 'yfinance|AAPL', assetClass: 'equity' }, kind: 'conditional-transmission', condition: 'Only if implemented.', status: 'active', explanation: 'A possible channel.', evidence },
  ] } }
  const rendered = render(<NewsAssociations view={view} locale="en" onEvidence={onEvidence} />)
  expect(screen.getByText('Canada')).toBeTruthy()
  expect(screen.getByText('Mentioned')).toBeTruthy()
  expect(screen.getByText('Conditional analysis')).toBeTruthy()
  fireEvent.click(rendered.container.querySelector('summary')!)
  fireEvent.click(screen.getByRole('button', { name: 'View evidence for Canada' }))
  expect(onEvidence).toHaveBeenCalledWith([1])
  fireEvent.click(screen.getByRole('button', { name: 'Open asset' }))
  expect(mocks.open).toHaveBeenCalledWith({ kind: 'market-detail', params: { source: 'yfinance|AAPL', symbol: 'AAPL', assetClass: 'equity' } })
  rendered.rerender(<NewsAssociations view={{ ...view, status: 'needs-review' }} locale="en" onEvidence={onEvidence} />)
  expect(screen.getByRole('status').textContent).toContain('excluded from filters')
  expect(screen.queryByRole('button', { name: 'Open asset' })).toBeNull()
  expect(screen.getByText(/An ambiguous name/)).toBeTruthy()
})
