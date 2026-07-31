// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import type { TemplateInfo, Workspace } from '../components/workspace/api'
import { i18n } from '../i18n'
import { AutoQuantSetupPage } from './AutoQuantSetupPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  initializeAutoQuant: vi.fn(),
  setAutoQuantDefaultWorkspace: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

const template: TemplateInfo = {
  name: 'auto-quant-v2',
  displayName: 'AutoQuant',
  defaultAgents: ['codex'],
  version: '1.0.0',
  hasReadme: true,
  source: {
    repository: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
    defaultVersion: 'v0.8.31',
    versions: [
      {
        version: 'v0.8.31',
        commit: '426d815b18450172fbcf4c6b6af77c6ae05a4967',
      },
      {
        version: 'v0.8.30',
        commit: 'cba95f8718e8396a3147a9cc5f5275cd44feae5f',
      },
    ],
  },
}

const existingWorkspace: Workspace = {
  id: 'aq-existing',
  tag: 'auto-quant',
  displayName: 'Quant desk',
  dir: '/tmp/aq-existing',
  createdAt: '2026-07-30T00:00:00.000Z',
  template: 'auto-quant-v2',
  sessions: [],
  harnessSource: {
    schemaVersion: 1,
    template: 'auto-quant-v2',
    repository: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
    version: 'v0.8.30',
    commit: 'cba95f8718e8396a3147a9cc5f5275cd44feae5f',
  },
}

function context(workspaces: readonly Workspace[]): WorkspacesContextValue {
  return {
    workspaces,
    templates: [template],
    agents: [],
    defaultAgent: null,
    issueDefaultAgent: null,
    listError: null,
    workspaceManager: null,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    templatesError: null,
    autoQuantDefaultWorkspaceId: null,
    autoQuantPreferenceLoaded: true,
    autoQuantPreferenceError: null,
    refresh: vi.fn(),
    refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('not used') }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: mocks.initializeAutoQuant,
    setAutoQuantDefaultWorkspace: mocks.setAutoQuantDefaultWorkspace,
    quickChat: vi.fn(async () => ''),
    pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.initializeAutoQuant.mockResolvedValue(existingWorkspace)
  mocks.setAutoQuantDefaultWorkspace.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('AutoQuant setup', () => {
  it('shows one initialization action and no research composer on a fresh install', async () => {
    mocks.useWorkspaces.mockReturnValue(context([]))
    render(<AutoQuantSetupPage />)

    expect(screen.queryByPlaceholderText('Describe the strategy, market, hypothesis, or iteration goal…')).toBeNull()
    expect(screen.getByText('v0.8.31')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Initialize AutoQuant' }))
    await waitFor(() => expect(mocks.initializeAutoQuant).toHaveBeenCalledOnce())
  })

  it('requires explicit selection when an AutoQuant Workspace already exists', async () => {
    mocks.useWorkspaces.mockReturnValue(context([existingWorkspace]))
    render(<AutoQuantSetupPage />)

    expect(screen.getByRole('heading', { name: 'Choose your AutoQuant workspace' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Initialize AutoQuant' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /Quant desk/ }))
    await waitFor(() => {
      expect(mocks.setAutoQuantDefaultWorkspace).toHaveBeenCalledWith('aq-existing')
    })
  })

  it('leaves the loading spinner when the Workspace inventory fails and offers retry', () => {
    const failed = {
      ...context([]),
      hasLoaded: false,
      listError: 'list failed: 500',
    }
    mocks.useWorkspaces.mockReturnValue(failed)
    render(<AutoQuantSetupPage />)

    expect(screen.queryByLabelText('Loading AutoQuant')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Workspace data is unavailable' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(failed.refresh).toHaveBeenCalledOnce()
  })

  it('retries the AutoQuant preference without reloading the page', () => {
    const failed = {
      ...context([]),
      autoQuantPreferenceError: 'preference failed: 500',
    }
    mocks.useWorkspaces.mockReturnValue(failed)
    render(<AutoQuantSetupPage />)

    expect(screen.getByRole('heading', { name: 'AutoQuant status is unavailable' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(failed.refreshAutoQuantPreference).toHaveBeenCalledOnce()
  })

  it('does not offer initialization when the template catalog is unavailable', () => {
    const failed = {
      ...context([]),
      templates: [],
      templatesError: 'templates failed: 500',
    }
    mocks.useWorkspaces.mockReturnValue(failed)
    render(<AutoQuantSetupPage />)

    expect(screen.getByRole('heading', { name: 'Workspace templates are unavailable' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Initialize AutoQuant' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(failed.refreshTemplates).toHaveBeenCalledOnce()
  })

  it('keeps the setup heading reachable in a short viewport', () => {
    mocks.useWorkspaces.mockReturnValue(context([]))
    render(<AutoQuantSetupPage />)

    expect(screen.getByTestId('autoquant-setup-scroll').className).toContain('items-start')
    expect(screen.getByTestId('autoquant-setup-scroll').className).toContain('justify-start')
    expect(screen.getByTestId('autoquant-setup-stack').className).toContain('my-auto')
  })
})
