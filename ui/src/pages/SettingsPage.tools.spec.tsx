// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { ToolsSection } from './SettingsPage'

const mocks = vi.hoisted(() => ({
  loadTools: vi.fn(),
  updateTools: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    tools: {
      load: mocks.loadTools,
      update: mocks.updateTools,
    },
  },
}))

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
  mocks.loadTools.mockResolvedValue({
    inventory: [
      {
        name: 'calculate',
        group: 'thinking',
        description: 'Perform mathematical calculations with precision.',
      },
    ],
    disabled: [],
  })
})

afterEach(cleanup)

describe('Settings Tools', () => {
  it('toggles groups independently of disclosure and marks collapsed controls inert', async () => {
    render(<ToolsSection />)

    const disclosure = await screen.findByRole('button', { name: /Thinking Kit/ })
    const panelId = disclosure.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null

    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(panel?.getAttribute('aria-hidden')).toBe('true')
    expect(panel?.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('switch', { name: 'calculate' })).toBeNull()

    const groupToggle = screen.getByRole('switch', { name: 'Thinking Kit tools' })
    fireEvent.click(groupToggle)
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(groupToggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.getAttribute('aria-hidden')).toBe('false')
    expect(panel?.hasAttribute('inert')).toBe(false)
    expect(screen.getByRole('switch', { name: 'calculate' })).toBeTruthy()

    fireEvent.click(disclosure)

    expect(screen.queryByRole('switch', { name: 'calculate' })).toBeNull()
  })

  it('explains a failed catalog load and retries it', async () => {
    mocks.loadTools
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ inventory: [], disabled: [] })

    render(<ToolsSection />)

    expect((await screen.findByRole('alert')).textContent).toContain('Could not load the tool catalog.')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.loadTools).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('No tools registered.')).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
