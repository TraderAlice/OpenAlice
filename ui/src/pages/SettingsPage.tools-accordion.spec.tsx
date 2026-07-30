// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  vi.clearAllMocks()
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

describe('Settings tool-group disclosures', () => {
  it('keeps collapsed tool controls out of the accessibility tree and tab order', async () => {
    render(<ToolsSection />)

    const disclosure = await screen.findByRole('button', { name: /Thinking Kit/ })
    const panelId = disclosure.getAttribute('aria-controls')
    const panel = panelId ? document.getElementById(panelId) : null

    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(disclosure.className).toContain('min-h-10')
    expect(disclosure.className).toContain('-my-2.5')
    expect(panel?.getAttribute('aria-hidden')).toBe('true')
    expect(panel?.hasAttribute('inert')).toBe(true)
    expect(screen.queryByRole('switch', { name: 'calculate' })).toBeNull()

    const groupToggle = screen.getByRole('switch', { name: 'Thinking Kit tools' })
    expect(groupToggle.className).toContain('size-10')
    fireEvent.click(groupToggle)
    expect(disclosure.getAttribute('aria-expanded')).toBe('false')
    expect(groupToggle.getAttribute('aria-checked')).toBe('false')

    fireEvent.click(disclosure)

    expect(disclosure.getAttribute('aria-expanded')).toBe('true')
    expect(panel?.getAttribute('aria-hidden')).toBe('false')
    expect(panel?.hasAttribute('inert')).toBe(false)
    expect(screen.getByRole('switch', { name: 'calculate' }).className).toContain('size-10')

    fireEvent.click(disclosure)

    expect(screen.queryByRole('switch', { name: 'calculate' })).toBeNull()
  })
})
