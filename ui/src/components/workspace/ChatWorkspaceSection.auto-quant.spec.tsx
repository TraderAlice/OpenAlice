// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesContext, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { i18n } from '../../i18n'
import type { SessionRecord, TemplateInfo, Workspace } from './api'
import { ChatWorkspaceSection } from './ChatWorkspaceSection'
import type { ViewSpec } from '../../tabs/types'

const focused = vi.hoisted(() => ({ spec: null as ViewSpec | null }))

const actions = vi.hoisted(() => ({
  openOrFocus: vi.fn(),
  pauseSession: vi.fn(async () => undefined),
  resumeSession: vi.fn(async () => undefined),
  requestDeleteSession: vi.fn(),
  setSessionPresence: vi.fn(async () => undefined),
  setSessionDisplayName: vi.fn(async () => undefined),
  updateSessionRuntime: vi.fn(async () => undefined),
  setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
}))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof actions.openOrFocus }) => unknown) =>
    selector({ openOrFocus: actions.openOrFocus }),
}))

vi.mock('../../tabs/types', () => ({
  getFocusedTab: () => focused.spec ? { spec: focused.spec } : null,
}))

vi.mock('../../hooks/useHarnessPreferences', () => ({
  useHarnessPreferences: () => ({
    preferences: { showHeadlessBornSessions: true, showIssueAttachedSessions: true },
    loading: false,
    error: null,
    save: vi.fn(),
  }),
}))

vi.mock('../../hooks/useWorkspaceSessionDirectory', () => ({
  useWorkspaceSessionDirectories: () => ({
    directories: new Map(),
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}))

const template: TemplateInfo = {
  name: 'auto-quant-v2',
  defaultAgents: ['pi'],
  version: '1.0.0',
  hasReadme: true,
}

const session: SessionRecord = {
  id: 'research-1',
  resumeId: 'resume-1',
  wsId: 'auto-quant-1',
  agent: 'pi',
  name: 'p1',
  createdAt: '2026-07-15T00:00:00.000Z',
  lastActiveAt: '2026-07-15T00:05:00.000Z',
  state: 'paused',
  surface: 'terminal',
  pid: null,
  startedAt: null,
  title: 'Review cross-market rotation',
}
const sessionTitle = 'Review cross-market rotation'

const workspace: Workspace = {
  id: 'auto-quant-1',
  tag: 'auto-quant',
  dir: '/tmp/auto-quant',
  createdAt: '2026-07-15T00:00:00.000Z',
  template: 'auto-quant-v2',
  sessions: [session],
}

function context(): WorkspacesContextValue {
  return {
    workspaces: [workspace],
    templates: [template],
    agents: [],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    listError: null,
    workspaceManager: null,
    workspaceManagerLoaded: true,
    workspaceManagerError: null,
    hasLoaded: true,
    templatesLoaded: true,
    autoQuantDefaultWorkspaceId: workspace.id,
    autoQuantPreferenceLoaded: true,
    autoQuantPreferenceError: null,
    templatesError: null,
    refresh: vi.fn(),
    refreshTemplates: vi.fn(async () => undefined),
    refreshAutoQuantPreference: vi.fn(async () => undefined),
    refreshWorkspaceManager: vi.fn(async () => undefined),
    quickStartWorkspaceManager: vi.fn(async () => { throw new Error('not used') }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    initializeChat: vi.fn(async () => { throw new Error('not used') }),
    setAutoQuantDefaultWorkspace: actions.setAutoQuantDefaultWorkspace,
    quickChat: vi.fn(async () => session.id),
    pauseSession: actions.pauseSession,
    resumeSession: actions.resumeSession,
    openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: actions.requestDeleteSession,
    setSessionPresence: actions.setSessionPresence,
    setSessionDisplayName: actions.setSessionDisplayName,
    updateSessionRuntime: actions.updateSessionRuntime,
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

beforeEach(async () => {
  for (const action of Object.values(actions)) action.mockClear()
  focused.spec = { kind: 'workspace', params: { wsId: 'auto-quant-1', sessionId: 'research-1', source: 'auto-quant' } }
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('Ask Alice sidebar in AutoQuant mode', () => {
  it('keeps the office visible but withholds research and Studio until the default is ready', () => {
    const state = { ...context(), autoQuantDefaultWorkspaceId: null }
    render(<WorkspacesContext.Provider value={state}><ChatWorkspaceSection mode="auto-quant" placement="navigation" /></WorkspacesContext.Provider>)
    expect(screen.queryByRole('button', { name: 'Open Studio' })).toBeNull()
    expect(screen.queryByRole('button', { name: sessionTitle })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Auto Quant Harness' }))
    expect(actions.openOrFocus).toHaveBeenCalledWith({ kind: 'auto-quant-landing', params: {} })
    expect(actions.setAutoQuantDefaultWorkspace).not.toHaveBeenCalled()
  })

  it('retains Studio and current research inside the ready navigation group', () => {
    render(<WorkspacesContext.Provider value={context()}><ChatWorkspaceSection mode="auto-quant" placement="navigation" /></WorkspacesContext.Provider>)
    fireEvent.click(screen.getByRole('button', { name: sessionTitle }))
    expect(actions.resumeSession).toHaveBeenCalledWith(workspace.id, session.id, 'auto-quant')
    fireEvent.click(screen.getByRole('button', { name: 'Open Studio' }))
    expect(actions.openOrFocus).toHaveBeenCalledWith({ kind: 'harness-surface', params: { wsId: workspace.id, capability: 'studio', source: 'auto-quant' } })
  })
  it('stacks Harness capabilities as full-width rows', () => {
    render(
      <WorkspacesContext.Provider value={context()}>
        <ChatWorkspaceSection mode="auto-quant" />
      </WorkspacesContext.Provider>,
    )

    const newResearch = screen.getByRole('button', { name: 'New research' })
    const studio = screen.getByRole('button', { name: 'Studio' })
    expect(newResearch.parentElement).toBe(studio.parentElement)
    expect(newResearch.parentElement?.className).toContain('grid-cols-1')
    expect(screen.getByText('New research').className).toContain('text-body')
    expect(screen.getByText('Studio').className).toContain('text-body')
  })

  it('keeps the active research current and routes destructive actions through the More menu', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <WorkspacesContext.Provider value={context()}>
        <ChatWorkspaceSection mode="auto-quant" onNavigate={onNavigate} />
      </WorkspacesContext.Provider>,
    )

    const research = screen.getByRole('button', { name: sessionTitle })
    expect(research.getAttribute('aria-current')).toBe('page')
    fireEvent.click(research)
    expect(actions.openOrFocus).toHaveBeenCalledWith({
      kind: 'workspace',
      params: { wsId: workspace.id, sessionId: session.id, source: 'auto-quant' },
    })
    expect(actions.setAutoQuantDefaultWorkspace).not.toHaveBeenCalled()

    const more = screen.getByRole('button', { name: `More actions for ${sessionTitle}` })
    more.focus()
    await user.keyboard('{ArrowDown}')
    fireEvent.click(screen.getByRole('menuitem', { name: `Archive ${sessionTitle}` }))
    expect(actions.setSessionPresence).toHaveBeenCalledWith(workspace.id, session.resumeId, 'archived')
  })
})

describe.each(['auto-quant', 'prediction'] as const)('%s navigation readiness', (mode) => {
  const name = mode === 'auto-quant' ? 'Auto Quant' : 'Auto Prediction'
  const templateName = mode === 'auto-quant' ? 'auto-quant-v2' : 'auto-prediction'
  const landingKind = mode === 'auto-quant' ? 'auto-quant-landing' : 'auto-prediction-landing'
  function renderNavigation(overrides: Partial<WorkspacesContextValue> = {}) {
    const state = {
      ...context(),
      workspaces: [{ ...workspace, template: templateName }],
      templates: [{ ...template, name: templateName }],
      autoPredictionDefaultWorkspaceId: workspace.id,
      autoPredictionPreferenceLoaded: true,
      autoPredictionPreferenceError: null,
      refreshAutoPredictionPreference: vi.fn(async () => undefined),
      ...overrides,
    }
    render(<WorkspacesContext.Provider value={state}><ChatWorkspaceSection mode={mode} placement="navigation" /></WorkspacesContext.Provider>)
    return state
  }

  it('uses the Harness title as the only setup entry when no workspace exists', () => {
    const state = renderNavigation({ workspaces: [], autoQuantDefaultWorkspaceId: null, autoPredictionDefaultWorkspaceId: null })
    expect(screen.queryByText('Set up a workspace to start researching.')).toBeNull()
    expect(screen.queryByRole('button', { name: `Set up ${name}` })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open Studio' })).toBeNull()
    expect(screen.queryByRole('button', { name: /New.*research/i })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: `${name} Harness` }))
    expect(actions.openOrFocus).toHaveBeenCalledWith({ kind: landingKind, params: {} })
    expect(state.initializeAutoQuant).not.toHaveBeenCalled()
  })

  it('keeps only the trailing new-research action alongside Studio for an empty workspace', () => {
    renderNavigation({ workspaces: [{ ...workspace, template: templateName, sessions: [] }] })
    const create = screen.getByRole('button', { name: new RegExp(`^${name}: New`) })
    expect(create.parentElement?.lastElementChild).toBe(create)
    expect(screen.queryByRole('button', { name: /^New.*research$/i })).toBeNull()
    expect(screen.getByRole('button', { name: 'Open Studio' })).toBeTruthy()
    fireEvent.click(create)
    expect(actions.openOrFocus).toHaveBeenCalledWith({ kind: landingKind, params: { targetWsId: workspace.id } })
  })

  it('asks to choose an existing workspace instead of creating another', () => {
    renderNavigation({ autoQuantDefaultWorkspaceId: null, autoPredictionDefaultWorkspaceId: null })
    expect(screen.queryByRole('button', { name: `Set up ${name}` })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Choose workspace' }))
    expect(actions.openOrFocus).toHaveBeenCalledWith({ kind: landingKind, params: {} })
    expect(actions.setAutoQuantDefaultWorkspace).not.toHaveBeenCalled()
  })

  it('does not flash setup while preferences are loading', () => {
    renderNavigation({ autoQuantPreferenceLoaded: false, autoPredictionPreferenceLoaded: false })
    expect(screen.getByLabelText('Loading…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Set up|Choose workspace|Open Studio/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /New.*research/i })).toBeNull()
  })

  it('shows preference failure as retryable error, not a missing workspace', () => {
    const state = renderNavigation({ workspaces: [], autoQuantPreferenceError: 'offline', autoPredictionPreferenceError: 'offline' })
    expect(screen.queryByRole('button', { name: /Set up|Choose workspace|Open Studio/ })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(mode === 'auto-quant' ? state.refreshAutoQuantPreference : state.refreshAutoPredictionPreference).toHaveBeenCalledOnce()
  })

  it('does not offer setup when the template catalog is unavailable', () => {
    renderNavigation({ workspaces: [], templates: [], templatesError: 'offline' })
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Set up|Choose workspace/ })).toBeNull()
  })

  it('marks only its matching Studio as current', () => {
    focused.spec = { kind: 'harness-surface', params: { wsId: workspace.id, source: mode, capability: 'studio' } }
    renderNavigation()
    const studio = screen.getByRole('button', { name: 'Open Studio' })
    expect(studio.getAttribute('aria-current')).toBe('page')
    fireEvent.click(studio)
    expect(actions.openOrFocus).toHaveBeenCalledWith(focused.spec)
    expect(actions.resumeSession).not.toHaveBeenCalled()
  })
})
