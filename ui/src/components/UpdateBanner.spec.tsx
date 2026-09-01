// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { VersionInfo } from '../api/types'

const mocks = vi.hoisted(() => ({
  getVersion: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    version: {
      get: mocks.getVersion,
    },
  },
}))

import { UpdateBanner } from './UpdateBanner'

const availableUpdate: VersionInfo = {
  current: '0.90.1',
  channel: 'stable',
  updateAuthority: 'source',
  latest: '0.90.2',
  hasUpdate: true,
  releaseUrl: 'https://example.test/v0.90.2',
  releaseNotes: null,
  publishedAt: '2026-09-01T00:00:00Z',
  error: null,
}

beforeEach(() => {
  localStorage.clear()
  mocks.getVersion.mockResolvedValue(availableUpdate)
})

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'openAlice')
  vi.clearAllMocks()
})

describe('UpdateBanner', () => {
  it('keeps source updates on the source-owned command', async () => {
    render(<UpdateBanner />)

    expect(await screen.findByText('git pull && pnpm build')).toBeTruthy()
    expect(screen.queryByText('openalice update')).toBeNull()
  })

  it('delegates installed CLI updates to the CLI', async () => {
    mocks.getVersion.mockResolvedValue({
      ...availableUpdate,
      updateAuthority: 'cli',
    })

    render(<UpdateBanner />)

    expect(await screen.findByText('openalice update')).toBeTruthy()
    expect(screen.queryByText('git pull && pnpm build')).toBeNull()
  })

  it('keeps desktop updates on the packaged updater', async () => {
    mocks.getVersion.mockResolvedValue({
      ...availableUpdate,
      updateAuthority: 'desktop',
    })

    render(<UpdateBanner />)

    expect(await screen.findByText('Desktop updater will prompt when the download is ready')).toBeTruthy()
  })

  it.each(['service', 'none'] as const)(
    'does not render a defensive banner for %s-owned updates',
    async (updateAuthority) => {
      mocks.getVersion.mockResolvedValue({
        ...availableUpdate,
        updateAuthority,
      })

      render(<UpdateBanner />)

      await waitFor(() => expect(mocks.getVersion).toHaveBeenCalledOnce())
      expect(screen.queryByText('v0.90.2')).toBeNull()
    },
  )
})
