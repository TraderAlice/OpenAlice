// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PortfolioPage, SnapshotSettings } from './PortfolioPage'

const mocks = vi.hoisted(() => ({
  configLoad: vi.fn(),
  updateSection: vi.fn(),
  openOrFocus: vi.fn(),
  setSidebar: vi.fn(),
}))

vi.mock('../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api')>()
  return {
    ...actual,
    api: {
      ...actual.api,
      config: {
        ...actual.api.config,
        load: mocks.configLoad,
        updateSection: mocks.updateSection,
      },
      trading: {
        ...actual.api.trading,
        equity: vi.fn(async () => null),
        listUTASummaries: vi.fn(async () => ({ utas: [] })),
        fxRates: vi.fn(async () => ({ rates: [] })),
        equityCurve: vi.fn(async () => ({ points: [] })),
      },
    },
  }
})

vi.mock('../hooks/useAccountHealth', () => ({
  useAccountHealth: () => ({}),
}))

vi.mock('../live/trading-mode', () => ({
  ensureTradingModePolling: vi.fn(),
  useTradingMode: (selector: (state: { status: { mode: string }; loading: boolean }) => unknown) =>
    selector({ status: { mode: 'pro' }, loading: false }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: {
    openOrFocus: typeof mocks.openOrFocus
    setSidebar: typeof mocks.setSidebar
  }) => unknown) => selector({
    openOrFocus: mocks.openOrFocus,
    setSidebar: mocks.setSidebar,
  }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.configLoad.mockResolvedValue({
    snapshot: { enabled: false, every: '1h' },
  })
  mocks.updateSection.mockImplementation(async (_section, data) => data)
})

afterEach(cleanup)

describe('Portfolio snapshot settings', () => {
  it('shows an existing custom interval after configuration loads', () => {
    const { rerender } = render(
      <SnapshotSettings
        enabled
        every="1h"
        onEnabledChange={vi.fn()}
        onEveryChange={vi.fn()}
        saveStatus="idle"
      />,
    )

    expect(screen.queryByRole('textbox', { name: 'Custom portfolio snapshot interval' })).toBeNull()

    rerender(
      <SnapshotSettings
        enabled
        every="2h"
        onEnabledChange={vi.fn()}
        onEveryChange={vi.fn()}
        saveStatus="idle"
      />,
    )

    const input = screen.getByRole('textbox', { name: 'Custom portfolio snapshot interval' })
    expect((input as HTMLInputElement).value).toBe('2h')
    expect(screen.getByRole('button', { name: 'Custom' }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps invalid custom intervals local and explains the accepted format', () => {
    const onEveryChange = vi.fn()
    render(
      <SnapshotSettings
        enabled
        every="1h"
        onEnabledChange={vi.fn()}
        onEveryChange={onEveryChange}
        saveStatus="idle"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const input = screen.getByRole('textbox', { name: 'Custom portfolio snapshot interval' })
    fireEvent.change(input, { target: { value: 'nonsense' } })

    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(screen.getByRole('alert').textContent).toContain('Use a positive duration')
    expect(onEveryChange).not.toHaveBeenCalled()

    fireEvent.change(input, { target: { value: ' 2h15m ' } })

    expect(input.getAttribute('aria-invalid')).toBe('false')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(onEveryChange).toHaveBeenCalledWith('2h15m')
  })
})

describe('Portfolio snapshot persistence', () => {
  it('does not restart UTA just by loading the page, then saves the first user edit', async () => {
    render(<PortfolioPage />)

    const enabledToggle = await screen.findByRole('switch', {
      name: 'Enable portfolio snapshots',
    })
    await new Promise((resolve) => setTimeout(resolve, 700))

    expect(mocks.updateSection).not.toHaveBeenCalled()

    fireEvent.click(enabledToggle)

    await waitFor(() => expect(mocks.updateSection).toHaveBeenCalledWith('snapshot', {
      enabled: true,
      every: '1h',
    }))
  })
})
