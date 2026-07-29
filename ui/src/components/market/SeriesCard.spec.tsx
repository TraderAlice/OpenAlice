// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { MacroSeriesCard } from '../../api/reference'
import { SeriesCard } from './SeriesCard'

afterEach(cleanup)

describe('SeriesCard trend chart', () => {
  it('presents a non-interactive chart with a concise range summary', () => {
    const card: MacroSeriesCard = {
      id: 'pe_month',
      label: 'S&P 500 PE',
      unit: 'index',
      points: [
        { date: '2026-01-01', value: 25 },
        { date: '2026-04-01', value: 27.2 },
        { date: '2026-07-28', value: 28.6 },
      ],
      latest: 28.6,
      latestDate: '2026-07-28',
      change: -0.11,
    }

    render(<SeriesCard card={card} label="S&P 500 PE" emptyText="No data" />)

    expect(screen.getByRole('img', {
      name: 'S&P 500 PE: 25.0 → 28.6 (2026-01-01 – 2026-07-28)',
    })).toBeTruthy()
    expect(screen.queryByRole('application')).toBeNull()
  })
})
