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
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('Settings Tools loading', () => {
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
