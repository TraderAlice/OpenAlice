// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesContext, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { i18n } from '../../i18n'
import type { SessionRecord, TemplateInfo, Workspace } from './api'
import { ChatWorkspaceSection } from './ChatWorkspaceSection'

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
  getFocusedTab: () => ({
    spec: {
      kind: 'workspace',
      params: { wsId: 'auto-quant-1', sessionId: 'research-1', source: 'auto-quant' },
    },
  }),
}))

vi.mock('../../hooks/useHarnessPreferences', () => ({
  useHarnessPreferences: () => ({
    preferences: { showHeadlessBornSessions: true },
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
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('Ask Alice sidebar in AutoQuant mode', () => {
  it('stacks Harness capabilities as full-width rows', () => {
    render(
      <WorkspacesContext.Provider value={context()}>
        <ChatWorkspaceSection mode="auto-quant" displayMode="focused" />
      </WorkspacesContext.Provider>,
    )

    const newResearch = screen.getByRole('button', { name: 'New research' })
    const studio = screen.getByRole('button', { name: 'Studio' })
    expect(newResearch.parentElement).toBe(studio.parentElement)
    expect(newResearch.parentElement?.className).toContain('grid-cols-1')
  })

  it('keeps the active research current and routes destructive actions through the More menu', async () => {
    const user = userEvent.setup()
    const onNavigate = vi.fn()
    render(
      <WorkspacesContext.Provider value={context()}>
        <ChatWorkspaceSection mode="auto-quant" displayMode="focused" onNavigate={onNavigate} />
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
