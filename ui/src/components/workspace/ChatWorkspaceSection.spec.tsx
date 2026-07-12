import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesContext, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import { i18n } from '../../i18n'
import type { TemplateInfo, Workspace } from './api'
import { ChatWorkspaceSection } from './ChatWorkspaceSection'

const { openOrFocus } = vi.hoisted(() => ({ openOrFocus: vi.fn() }))

vi.mock('../../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof openOrFocus }) => unknown) =>
    selector({ openOrFocus }),
}))

vi.mock('../../tabs/types', () => ({
  getFocusedTab: () => null,
}))

const chatTemplate: TemplateInfo = {
  name: 'chat',
  defaultAgents: ['pi'],
  version: '1.0.0',
  hasReadme: true,
}

const chatWorkspace: Workspace = {
  id: 'chat-1',
  tag: 'chat-jul11',
  dir: '/tmp/chat-jul11',
  createdAt: '2026-07-11T00:00:00.000Z',
  template: 'chat',
  agents: ['pi'],
  sessions: [],
}

function workspaceContext(workspaces: readonly Workspace[]): WorkspacesContextValue {
  return {
    workspaces,
    templates: [chatTemplate],
    agents: [],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    listError: null,
    hasLoaded: true,
    templatesLoaded: true,
    refresh: vi.fn(),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    quickChat: vi.fn(async () => 'session-1'),
    pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

function renderSection(workspaces: readonly Workspace[] = [chatWorkspace]) {
  return render(
    <WorkspacesContext.Provider value={workspaceContext(workspaces)}>
      <ChatWorkspaceSection />
    </WorkspacesContext.Provider>,
  )
}

beforeEach(async () => {
  openOrFocus.mockReset()
  await i18n.changeLanguage('en')
})

afterEach(cleanup)

describe('ChatWorkspaceSection actions', () => {
  it('keeps conversation creation primary and scopes workspace creation to the workspace list', () => {
    renderSection()

    const newChat = screen.getByRole('button', { name: 'New chat' })
    const newWorkspace = screen.getByRole('button', { name: 'New workspace' })
    const workspaceHeading = screen.getByText('Workspaces', { selector: 'span' })
    const workspaceButton = screen.getByRole('button', { name: chatWorkspace.tag })
    const newSession = screen.getByRole('button', { name: 'New conversation in this workspace' })

    expect(newChat.className).toContain('w-full')
    expect(newChat.textContent).toBe('New chat')
    expect(newChat.querySelector('.lucide-message-square-plus')).toBeTruthy()
    expect(workspaceHeading.parentElement?.nextElementSibling?.contains(newWorkspace)).toBe(true)
    expect(newWorkspace.className).toContain('w-full')
    expect(newWorkspace.textContent).toBe('New workspace')
    expect(newWorkspace.querySelector('.lucide-panels-top-left')).toBeTruthy()
    expect(newSession.querySelector('.lucide-message-square-plus')).toBeTruthy()

    fireEvent.click(newChat)
    expect(openOrFocus).toHaveBeenCalledWith({ kind: 'chat-landing', params: {} })

    fireEvent.click(workspaceButton)
    expect(openOrFocus).toHaveBeenLastCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })

    fireEvent.click(newSession)
    expect(openOrFocus).toHaveBeenLastCalledWith({
      kind: 'chat-landing',
      params: { targetWsId: chatWorkspace.id },
    })
  })

  it('keeps an explicit workspace action in the empty state', () => {
    renderSection([])

    expect(screen.getByText(i18n.t('chat.noChatWorkspacesYet'))).toBeTruthy()
    expect(screen.getAllByRole('button', { name: 'New workspace' })).toHaveLength(2)
  })
})
