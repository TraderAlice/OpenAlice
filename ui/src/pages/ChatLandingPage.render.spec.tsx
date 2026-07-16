// @vitest-environment jsdom

import { act, cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import { i18n } from '../i18n'
import type { AgentInfo, Workspace } from '../components/workspace/api'
import { ChatLandingPage } from './ChatLandingPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  listAgentCredentials: vi.fn(),
  detectWorkspaceCredential: vi.fn(),
  getAgentReadiness: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  probeAgentRuntimeReadiness: vi.fn(),
  getWorkspaceCredentialDefaults: vi.fn(),
  getQuickChat: vi.fn(),
  rememberRecentChatWorkspace: vi.fn(),
  rememberQuickChatCredential: vi.fn(),
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => mocks.useWorkspaces(),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

vi.mock('../components/workspace/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/workspace/api')>()
  return {
    ...actual,
    listAgentCredentials: mocks.listAgentCredentials,
    detectWorkspaceCredential: mocks.detectWorkspaceCredential,
    getAgentReadiness: mocks.getAgentReadiness,
    getAgentRuntimeReadiness: mocks.getAgentRuntimeReadiness,
    probeAgentRuntimeReadiness: mocks.probeAgentRuntimeReadiness,
  }
})

vi.mock('../api/config', () => ({
  configApi: {
    getWorkspaceCredentialDefaults: mocks.getWorkspaceCredentialDefaults,
  },
}))

vi.mock('../api/preferences', () => ({
  preferencesApi: {
    getQuickChat: mocks.getQuickChat,
    rememberRecentChatWorkspace: mocks.rememberRecentChatWorkspace,
    rememberQuickChatCredential: mocks.rememberQuickChatCredential,
  },
}))

const piAgent: AgentInfo = {
  id: 'pi',
  displayName: 'Pi',
  kind: 'agent',
  installed: true,
  capabilities: {
    parallelPerCwd: false,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'fs-watch',
  },
}

function chatWorkspace(): Workspace {
  return {
    id: 'chat-1',
    tag: 'chat-jul16',
    dir: '/tmp/chat-jul16',
    createdAt: '2026-07-16T00:00:00.000Z',
    template: 'chat',
    agents: ['pi'],
    sessions: [],
  }
}

function context(workspaces: readonly Workspace[]): WorkspacesContextValue {
  return {
    workspaces,
    templates: [],
    agents: [piAgent],
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
    quickChat: vi.fn(async () => 'chat-1'),
    pauseSession: vi.fn(async () => undefined),
    resumeSession: vi.fn(async () => undefined),
    openWebPiSession: vi.fn(async () => undefined),
    requestDeleteSession: vi.fn(),
    openAgentConfig: vi.fn(),
    saveWorkspaceMetadata: vi.fn(async () => undefined),
    renameWorkspace: vi.fn(async () => undefined),
  }
}

let workspaces: Workspace[]

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('en')
  workspaces = [chatWorkspace()]
  mocks.useWorkspaces.mockImplementation(() => context(workspaces))
  mocks.listAgentCredentials.mockResolvedValue([{
    slug: 'google-1',
    vendor: 'google',
    authType: 'api-key',
    wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
    resolvedModel: 'gemini-3.1-flash-lite',
  }])
  mocks.detectWorkspaceCredential.mockResolvedValue({
    slug: 'google-1',
    model: 'gemini-3.1-flash-lite',
    contextWindow: 256_000,
    wireShape: 'google-generative-ai',
  })
  mocks.getAgentReadiness.mockResolvedValue({
    agents: {
      pi: {
        agent: 'pi',
        ready: true,
        requiresCredential: true,
        source: 'workspace-config',
        hasWorkspaceConfig: true,
        hasUsableWorkspaceConfig: true,
        detectedCredentialSlug: 'google-1',
        compatibleCredentialSlugs: ['google-1'],
        injectableCredentialSlugs: ['google-1'],
      },
    },
  })
  mocks.getAgentRuntimeReadiness.mockResolvedValue({
    agents: {
      pi: {
        agent: 'pi',
        displayName: 'Pi',
        installed: true,
        binPath: '/tmp/pi',
        status: 'ready',
        ready: true,
        source: 'workspace-override',
        checkedAt: '2026-07-16T00:00:00.000Z',
        durationMs: 1,
      },
    },
    overallReady: true,
    checkedAt: '2026-07-16T00:00:00.000Z',
  })
  mocks.probeAgentRuntimeReadiness.mockImplementation(() => mocks.getAgentRuntimeReadiness())
  mocks.getWorkspaceCredentialDefaults.mockResolvedValue({
    defaults: {},
    compatibleByAgent: { pi: ['google-1'] },
    contextWindow: 256_000,
  })
  mocks.getQuickChat.mockResolvedValue({
    lastCredentialByAgent: {},
    recentChatWorkspaceId: 'chat-1',
  })
  mocks.rememberRecentChatWorkspace.mockResolvedValue(undefined)
  mocks.rememberQuickChatCredential.mockResolvedValue(undefined)
})

afterEach(cleanup)

describe('ChatLandingPage polling stability', () => {
  it('does not re-run credential detection when a poll replaces the Workspace object with the same id', async () => {
    const view = render(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)

    await waitFor(() => expect(mocks.detectWorkspaceCredential).toHaveBeenCalledTimes(1))

    await act(async () => {
      workspaces = structuredClone(workspaces)
      view.rerender(<ChatLandingPage spec={{ params: { targetWsId: 'chat-1' } }} />)
    })

    expect(mocks.detectWorkspaceCredential).toHaveBeenCalledTimes(1)
    expect(mocks.getAgentReadiness).toHaveBeenCalledTimes(1)
  })
})
