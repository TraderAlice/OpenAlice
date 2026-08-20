// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { Workspace } from '../components/workspace/api'
import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import { i18n } from '../i18n'
import { AutoPredictionSetupPage } from './AutoPredictionSetupPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  initialize: vi.fn(),
  select: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

const workspace: Workspace = {
  id: 'prediction-existing',
  tag: 'prediction',
  displayName: 'Forecast desk',
  dir: '/tmp/prediction',
  createdAt: '2026-08-20T00:00:00.000Z',
  template: 'auto-prediction',
  sessions: [],
  harnessSource: {
    schemaVersion: 1,
    template: 'auto-prediction',
    repository: 'https://github.com/TraderAlice/Auto-Prediction.git',
    version: 'snapshot-26f3ae2',
    commit: '26f3ae2d617e115850cff6fe047f6fb54c979d20',
  },
}

function context(workspaces: readonly Workspace[]): WorkspacesContextValue {
  return {
    workspaces,
    templates: [{
      name: 'auto-prediction',
      displayName: 'Auto Prediction',
      defaultAgents: ['codex'],
      version: 'snapshot-26f3ae2',
      hasReadme: true,
      source: {
        repository: 'https://github.com/TraderAlice/Auto-Prediction.git',
        defaultVersion: 'snapshot-26f3ae2',
        versions: [{ version: 'snapshot-26f3ae2', commit: '26f3ae2d617e115850cff6fe047f6fb54c979d20' }],
      },
    }],
    agents: [], defaultAgent: null, issueDefaultAgent: null,
    listError: null, workspaceManager: null, workspaceManagerLoaded: true, workspaceManagerError: null,
    hasLoaded: true, templatesLoaded: true, templatesError: null,
    autoQuantDefaultWorkspaceId: null, autoQuantPreferenceLoaded: true, autoQuantPreferenceError: null,
    autoPredictionDefaultWorkspaceId: null, autoPredictionPreferenceLoaded: true, autoPredictionPreferenceError: null,
    refresh: vi.fn(), refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshAutoPredictionPreference: vi.fn(async () => undefined),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('not used') }),
    spawn: vi.fn(async () => undefined), openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined), setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeChat: vi.fn(async () => { throw new Error('not used') }),
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    initializeAutoPrediction: mocks.initialize,
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
    setAutoPredictionDefaultWorkspace: mocks.select,
    quickChat: vi.fn(async () => ''), pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined), openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(), setSessionPresence: vi.fn(async () => undefined),
    setSessionDisplayName: vi.fn(async () => undefined), updateSessionRuntime: vi.fn(async () => undefined),
    openAgentConfig: vi.fn(), saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.initialize.mockResolvedValue(workspace)
  mocks.select.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('Auto Prediction setup', () => {
  it('initializes the pinned source snapshot on a fresh install', async () => {
    mocks.useWorkspaces.mockReturnValue(context([]))
    render(<AutoPredictionSetupPage />)

    expect(screen.getByText('snapshot-26f3ae2')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Auto Prediction' }))
    await waitFor(() => expect(mocks.initialize).toHaveBeenCalledOnce())
  })

  it('requires explicit selection when an Auto Prediction Workspace already exists', async () => {
    mocks.useWorkspaces.mockReturnValue(context([workspace]))
    render(<AutoPredictionSetupPage />)

    expect(screen.getByRole('heading', { name: 'Choose your Auto Prediction workspace' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /Forecast desk/ }))
    await waitFor(() => expect(mocks.select).toHaveBeenCalledWith(workspace.id))
  })
})
