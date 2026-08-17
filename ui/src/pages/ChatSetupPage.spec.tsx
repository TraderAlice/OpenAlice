// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import type { TemplateInfo, Workspace } from '../components/workspace/api'
import { i18n } from '../i18n'
import { ChatSetupPage } from './ChatSetupPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  initializeChat: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

const template: TemplateInfo = {
  name: 'chat',
  displayName: 'Chat',
  defaultAgents: ['pi'],
  version: '0.2.0',
  hasReadme: false,
  source: {
    repository: 'https://example.test/chat.git',
    defaultVersion: 'v9.9.9',
    versions: [
      {
        version: 'v9.9.9',
        commit: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      },
    ],
  },
}

const createdWorkspace: Workspace = {
  id: 'chat-new',
  tag: 'chat',
  dir: '/tmp/chat-new',
  createdAt: '2026-08-15T00:00:00.000Z',
  template: 'chat',
  sessions: [],
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
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    initializeChat: mocks.initializeChat,
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => ''),
    pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    setSessionPresence: vi.fn(async () => undefined),
    setSessionDisplayName: vi.fn(async () => undefined),
    updateSessionRuntime: vi.fn(async () => undefined),
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  mocks.initializeChat.mockResolvedValue(createdWorkspace)
})

afterEach(cleanup)

describe('Chat setup', () => {
  it('shows one initialization action and does not pin a Harness version', async () => {
    mocks.useWorkspaces.mockReturnValue(context([]))
    render(<ChatSetupPage />)

    expect(screen.queryByPlaceholderText('Ask Alice…')).toBeNull()
    expect(screen.queryByText('v9.9.9')).toBeNull()
    expect(screen.queryByText('Pinned Harness version')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Initialize Ask Alice' }))
    await waitFor(() => expect(mocks.initializeChat).toHaveBeenCalledOnce())
  })

  it('still offers initialization when the template catalog is unavailable', () => {
    const failed = {
      ...context([]),
      templates: [],
      templatesError: 'templates failed: 500',
    }
    mocks.useWorkspaces.mockReturnValue(failed)
    render(<ChatSetupPage />)

    expect(screen.getByRole('button', { name: 'Initialize Ask Alice' })).toBeTruthy()
    expect(screen.queryByRole('heading', { name: 'Workspace templates are unavailable' })).toBeNull()
  })

  it('keeps the setup heading reachable in a short viewport', () => {
    mocks.useWorkspaces.mockReturnValue(context([]))
    render(<ChatSetupPage />)

    expect(screen.getByTestId('chat-setup-scroll').className).toContain('items-start')
    expect(screen.getByTestId('chat-setup-scroll').className).toContain('justify-start')
    expect(screen.getByTestId('chat-setup-stack').className).toContain('my-auto')
  })
})
