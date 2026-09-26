// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { i18n } from '../i18n'
import { useHarnessInitialization } from '../live/harness-initialization'
import { AutoQuantSetupPage } from '../pages/AutoQuantSetupPage'
import { AutoPredictionSetupPage } from '../pages/AutoPredictionSetupPage'
import { ChatSetupPage } from '../pages/ChatSetupPage'

const mocks = vi.hoisted(() => ({ initialize: vi.fn(), refresh: vi.fn(), refreshAutoQuantPreference: vi.fn(), refreshAutoPredictionPreference: vi.fn(), setup: { pending: [] as string[], errors: {} as Record<string, string>, phase: 'complete' as 'idle' | 'preparing' | 'complete' } }))
vi.mock('../hooks/useProjectWorkspaceSetup', () => ({
  useProjectWorkspaceSetup: () => ({ setup: mocks.setup, error: null, busy: false, retry: vi.fn() }),
}))
vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({
    workspaces: [], templates: [], hasLoaded: true, templatesLoaded: true,
    listError: null, templatesError: null,
    refresh: mocks.refresh,
    refreshAutoQuantPreference: mocks.refreshAutoQuantPreference,
    refreshAutoPredictionPreference: mocks.refreshAutoPredictionPreference,
    autoQuantPreferenceLoaded: true, autoPredictionPreferenceLoaded: true,
    initializeAutoQuant: mocks.initialize,
    initializeAutoPrediction: mocks.initialize,
    initializeChat: mocks.initialize,
  }),
}))

beforeEach(async () => {
  mocks.initialize.mockReset()
  mocks.refresh.mockReset()
  mocks.setup = { pending: [], errors: {}, phase: 'complete' }
  useHarnessInitialization.setState({ templates: {} })
  await i18n.changeLanguage('en')
})
afterEach(cleanup)

it('shows background setup progress without requiring a manual click', () => {
  mocks.setup = { pending: ['auto-quant'], errors: {}, phase: 'preparing' }
  render(<AutoQuantSetupPage />)
  expect(screen.getByRole('progressbar')).toBeTruthy()
  expect((screen.getByRole('button', { name: 'Initializing AutoQuant…' }) as HTMLButtonElement).disabled).toBe(true)
  expect(mocks.initialize).not.toHaveBeenCalled()
})

it.each([
  ['AutoQuant', AutoQuantSetupPage],
  ['Auto Prediction', AutoPredictionSetupPage],
  ['Ask Alice', ChatSetupPage],
] as const)('retains %s progress, failures and retry across navigation', async (name, Page) => {
  let reject!: (error: Error) => void
  mocks.initialize.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
  const first = render(<Page />)
  fireEvent.click(screen.getByRole('button', { name: `Initialize ${name}` }))
  expect(screen.getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false)
  first.unmount()

  const second = render(<Page />)
  expect(screen.getByRole('progressbar')).toBeTruthy()
  const pending = screen.getByRole('button', { name: `Initializing ${name}…` }) as HTMLButtonElement
  expect(pending.disabled).toBe(true)
  fireEvent.click(pending)
  expect(mocks.initialize).toHaveBeenCalledOnce()
  second.unmount()

  await act(async () => reject(new Error('Source download failed')))
  const third = render(<Page />)
  expect(screen.getByRole('alert').textContent).toBe('Source download failed')
  expect(screen.queryByRole('progressbar')).toBeNull()

  let finish!: () => void
  mocks.initialize.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  fireEvent.click(screen.getByRole('button', { name: `Initialize ${name}` }))
  expect(screen.queryByRole('alert')).toBeNull()
  expect(mocks.initialize).toHaveBeenCalledTimes(2)
  third.unmount()
  await act(async () => finish())
  render(<Page />)
  expect(screen.queryByRole('progressbar')).toBeNull()
  expect(screen.queryByRole('alert')).toBeNull()
})

it('deduplicates initialization by template while other Harnesses can initialize', async () => {
  const { initialize } = useHarnessInitialization.getState()
  let finish!: () => void
  const run = vi.fn(() => new Promise<void>((resolve) => { finish = resolve }))
  const first = initialize('auto-quant-v2', run)
  await initialize('auto-quant-v2', run)
  expect(run).toHaveBeenCalledOnce()
  await initialize('auto-prediction', async () => undefined)
  expect(useHarnessInitialization.getState().templates['auto-quant-v2']?.pending).toBe(true)
  finish()
  await first
  expect(useHarnessInitialization.getState().templates['auto-quant-v2']?.pending).toBe(false)
})
