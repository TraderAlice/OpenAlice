// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { harnessSurfaceFailureKind } from '../lib/harness-surface-failure'
import { HarnessSurfacePage } from './HarnessSurfacePage'

const mocks = vi.hoisted(() => ({
  getHarnessSurface: vi.fn(),
  startHarnessSurface: vi.fn(),
  restartHarnessSurface: vi.fn(),
  openOrFocus: vi.fn(),
}))

vi.mock('../api/harness-surfaces', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/harness-surfaces')>()
  return {
    ...actual,
    getHarnessSurface: mocks.getHarnessSurface,
    startHarnessSurface: mocks.startHarnessSurface,
    restartHarnessSurface: mocks.restartHarnessSurface,
  }
})

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) => (
    selector({ openOrFocus: mocks.openOrFocus })
  ),
}))

const failedSurface = {
  surface: {
    workspaceId: 'prediction-1',
    capability: 'studio' as const,
    manifestVersion: 1,
    harnessVersion: '0.1.1',
    phase: 'failed' as const,
    generation: 1,
    error: 'Studio stopped before it was closed (exit 1)',
    logs: 'sh: vite: command not found\nLocal package.json exists, but node_modules missing\n',
  },
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.getHarnessSurface.mockResolvedValue(failedSurface)
})

afterEach(cleanup)

describe('HarnessSurfacePage failure recovery', () => {
  it('shows a dependency diagnosis and opens a prefilled Agent Quick Start', async () => {
    render(<HarnessSurfacePage workspaceId="prediction-1" source="prediction" />)

    expect(await screen.findByRole('heading', { name: 'Studio could not start' })).toBeTruthy()
    expect(screen.getByText(/does not appear to have its Studio dependencies installed/)).toBeTruthy()
    expect(screen.getByText(/vite: command not found/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: 'Set up with Agent' }))

    await waitFor(() => expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'auto-prediction-landing',
      params: {
        targetWsId: 'prediction-1',
        initialPrompt: expect.stringContaining('Inspect harness.json'),
      },
    }))
  })

  it('keeps unrelated process failures on the generic diagnosis path', () => {
    expect(harnessSurfaceFailureKind('worker exited after an internal assertion')).toBe('generic')
  })
})
