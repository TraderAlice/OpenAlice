// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { BarFreshness } from './BarFreshness'
import type { BarMeta } from '../../api/market'
afterEach(() => { cleanup(); vi.useRealTimers() })
it('shows an absolute UTC record and an age, without calling age delay', () => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2026-09-08T08:00:00Z'))
  render(<BarFreshness meta={{ to: '2026-09-08T07:45:00Z', freshness: {
    fetchedAt: '2026-09-08T08:00:00Z', latestRecordAt: '2026-09-08T07:45:00Z',
    timestampKind: 'instant', recordAgeSeconds: 900, historical: false,
  } } as BarMeta} />)
  expect(screen.getByText(/Latest record:/).textContent).toContain('07:45:00 UTC')
  expect(screen.getByText(/Latest record:/).textContent).not.toContain('delay')
})
it('keeps legacy date-only responses readable without inventing midnight freshness', () => {
  render(<BarFreshness meta={{ to: '2026-09-08' } as BarMeta} />)
  expect(screen.getByText('Latest record: 2026-09-08')).toBeTruthy()
})
it('marks historical windows without presenting their age as a live signal', () => {
  render(<BarFreshness meta={{ freshness: {
    fetchedAt: '2026-09-08T08:00:00Z', latestRecordAt: '2024-01-02',
    timestampKind: 'date', recordAgeSeconds: null, historical: true,
  } } as BarMeta} />)
  expect(screen.getByText('Historical · Latest record: 2024-01-02')).toBeTruthy()
})
