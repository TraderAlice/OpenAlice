// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { MCPPage } from './MCPPage'

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  updateSection: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    config: {
      load: mocks.loadConfig,
      updateSection: mocks.updateSection,
    },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('MCPPage configuration loading', () => {
  it('retries a failed configuration read', async () => {
    mocks.loadConfig
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({
        mcp: {
          enabled: false,
          port: 3003,
        },
      })

    render(<MCPPage />)

    expect(await screen.findByRole('alert')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    await waitFor(() => expect(mocks.loadConfig).toHaveBeenCalledTimes(2))
    expect(await screen.findByRole('heading', { name: 'HTTP Server' })).toBeTruthy()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})
