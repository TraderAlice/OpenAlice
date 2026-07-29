// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MarketRotationPage } from './MarketRotationPage'

const mocks = vi.hoisted(() => ({
  sectorRotation: vi.fn(),
}))

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { sym?: string }) => {
      if (key === 'common.retry') return 'Retry'
      if (key === 'market.colVsBench') return `vs ${options?.sym ?? ''}`
      return key
    },
  }),
}))

vi.mock('../api/market', () => ({
  marketApi: {
    sectorRotation: mocks.sectorRotation,
  },
}))

vi.mock('../components/MeasuredChartFrame', () => ({
  MeasuredChartFrame: () => <div data-testid="rotation-chart" />,
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('MarketRotationPage recovery', () => {
  it('lets the user retry an initial board failure immediately', async () => {
    mocks.sectorRotation
      .mockRejectedValueOnce(new Error('Rotation board unavailable'))
      .mockResolvedValueOnce({
        asOf: '2026-07-29',
        benchmark: {
          symbol: 'SPY',
          returns: { '1D': 0, '1W': 0, '1M': 0, '3M': 0, '6M': 0 },
        },
        sectors: [],
        methodology: 'Recovered methodology',
      })

    render(<MarketRotationPage />)

    expect((await screen.findByRole('alert')).textContent).toContain('Rotation board unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await screen.findByText('Recovered methodology')
    await waitFor(() => expect(mocks.sectorRotation).toHaveBeenCalledTimes(2))
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
