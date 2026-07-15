import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { WorkspacesContext, type WorkspacesContextValue } from '../../contexts/workspaces-context'
import {
  getAgentConfig,
  listCredentials,
  saveAgentConfig,
  type AgentConfigBundle,
  type Workspace,
} from './api'
import { DEFAULT_WORKSPACE_CONTEXT_WINDOW } from '../../lib/workspaceContext'
import { WorkspaceAIConfigModal } from './WorkspaceAIConfigModal'

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  getAgentConfig: vi.fn(),
  listCredentials: vi.fn(),
  saveAgentConfig: vi.fn(),
  saveCredential: vi.fn(),
  testAgentConfig: vi.fn(),
}))

vi.mock('../../api', () => ({
  api: { config: { getPresets: vi.fn(async () => ({ presets: [] })) } },
}))

const emptyBundle: AgentConfigBundle = {
  claude: null,
  codex: null,
  opencode: null,
  pi: null,
}

function workspace(runningPi = false): Workspace {
  return {
    id: 'ws-1',
    tag: 'chat-local-model',
    dir: '/tmp/chat-local-model',
    createdAt: '2026-07-15T00:00:00.000Z',
    template: 'chat',
    agents: ['opencode', 'pi'],
    sessions: runningPi ? [{
      id: 'pi-live',
      resumeId: 'resume-live',
      wsId: 'ws-1',
      agent: 'pi',
      name: 'p1',
      createdAt: '2026-07-15T00:00:00.000Z',
      lastActiveAt: '2026-07-15T00:00:00.000Z',
      state: 'running',
      surface: 'webpi',
      pid: 42,
      startedAt: 1,
      title: 'Long local conversation',
    }] : [],
  }
}

function contextValue(ws: Workspace): WorkspacesContextValue {
  return {
    workspaces: [ws],
    templates: [],
    agents: [],
    defaultAgent: 'pi',
    issueDefaultAgent: null,
    listError: null,
    hasLoaded: true,
    templatesLoaded: true,
    refresh: vi.fn(async () => undefined),
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

function renderModal(ws = workspace()) {
  return render(
    <WorkspacesContext.Provider value={contextValue(ws)}>
      <WorkspaceAIConfigModal
        wsId={ws.id}
        initialSection="ai"
        initialAgent="pi"
        onClose={vi.fn()}
      />
    </WorkspacesContext.Provider>,
  )
}

beforeEach(() => {
  vi.mocked(listCredentials).mockResolvedValue([])
  vi.mocked(getAgentConfig).mockResolvedValue(emptyBundle)
  vi.mocked(saveAgentConfig).mockResolvedValue(undefined)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('WorkspaceAIConfigModal context state', () => {
  it('defaults unknown Pi/OpenCode models to the conservative 256K window', async () => {
    renderModal()

    const select = await screen.findByLabelText('Context window') as HTMLSelectElement
    expect(select.value).toBe(String(DEFAULT_WORKSPACE_CONTEXT_WINDOW))
    expect(screen.getByRole('option', { name: '256K — recommended' })).toBeTruthy()
  })

  it('warns that 512K and 1M selections can exceed local prefill memory', async () => {
    vi.mocked(getAgentConfig).mockResolvedValue({
      ...emptyBundle,
      pi: {
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey: 'local',
        model: 'qwen-local',
        wireShape: 'openai-chat',
        contextWindow: 1_000_000,
      },
    })
    renderModal()

    await waitFor(() => expect((screen.getByLabelText('Context window') as HTMLSelectElement).value).toBe('1000000'))
    expect(screen.getByText(/sharply increase local prefill memory/)).toBeTruthy()
    expect(screen.getByText(/connection test checks the endpoint, key, and model only/)).toBeTruthy()
  })

  it('preserves a valid custom context window instead of silently replacing it', async () => {
    vi.mocked(getAgentConfig).mockResolvedValue({
      ...emptyBundle,
      opencode: {
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey: 'local',
        model: 'qwen-local',
        wireShape: 'openai-chat',
        contextWindow: 200_000,
      },
    })
    render(
      <WorkspacesContext.Provider value={contextValue(workspace())}>
        <WorkspaceAIConfigModal
          wsId="ws-1"
          initialSection="ai"
          initialAgent="opencode"
          onClose={vi.fn()}
        />
      </WorkspacesContext.Provider>,
    )

    const select = await screen.findByLabelText('Context window') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('200000'))
    expect(screen.getByRole('option', { name: 'Custom — 200,000 tokens' })).toBeTruthy()
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('lets a context-only change save directly and names running Sessions that need a restart', async () => {
    let bundle: AgentConfigBundle = {
      ...emptyBundle,
      pi: {
        baseUrl: 'http://127.0.0.1:8080/v1',
        apiKey: 'local',
        model: 'qwen-local',
        wireShape: 'openai-chat',
        contextWindow: 1_000_000,
      },
    }
    vi.mocked(getAgentConfig).mockImplementation(async () => bundle)
    vi.mocked(saveAgentConfig).mockImplementation(async (_wsId, agent, cfg) => {
      bundle = { ...bundle, [agent]: cfg }
    })
    renderModal(workspace(true))

    const select = await screen.findByLabelText('Context window') as HTMLSelectElement
    await waitFor(() => expect(select.value).toBe('1000000'))
    fireEvent.change(select, { target: { value: '256000' } })

    expect(screen.queryByRole('button', { name: 'Test' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(saveAgentConfig).toHaveBeenCalledWith(
      'ws-1',
      'pi',
      expect.objectContaining({ contextWindow: 256_000 }),
    ))
    expect(await screen.findByText(/1 running Pi Session still uses the previous provider state/)).toBeTruthy()
    expect(screen.getByText(/Pause and resume it to apply this change/)).toBeTruthy()
    expect(screen.getByText(/saving does not resize an already-running process/)).toBeTruthy()
  })
})
