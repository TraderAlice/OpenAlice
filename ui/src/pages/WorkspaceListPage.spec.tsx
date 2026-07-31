// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { WorkspacesContextValue } from '../contexts/workspaces-context'
import type { DepartedWorkspace } from '../components/workspace/api'
import { i18n } from '../i18n'
import { WorkspaceListPage } from './WorkspaceListPage'

const mocks = vi.hoisted(() => ({
  useWorkspaces: vi.fn(),
  openOrFocus: vi.fn(),
  listDepartedWorkspaces: vi.fn(),
  purgeDepartedWorkspace: vi.fn(),
  restoreWorkspace: vi.fn(),
  getGitLog: vi.fn(),
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
    getGitLog: mocks.getGitLog,
    listDepartedWorkspaces: mocks.listDepartedWorkspaces,
    purgeDepartedWorkspace: mocks.purgeDepartedWorkspace,
    restoreWorkspace: mocks.restoreWorkspace,
  }
})

function context(): WorkspacesContextValue {
  return {
    workspaces: [],
    templates: [],
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
    quickStartWorkspaceManager: vi.fn(async () => {
      throw new Error('not used')
    }),
    spawn: vi.fn(async () => undefined),
    openHeadlessRun: vi.fn(async () => undefined),
    setDefaultAgent: vi.fn(async () => undefined),
    setIssueDefaultAgent: vi.fn(async () => undefined),
    initializeAutoQuant: vi.fn(async () => { throw new Error('not used') }),
    setAutoQuantDefaultWorkspace: vi.fn(async () => undefined),
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

const departedWorkspace: DepartedWorkspace = {
  id: 'chat-quiet-slate-archive',
  tag: 'macro-research-archive',
  activeDir: '/demo/workspaces/chat-quiet-slate-archive',
  departedDir: '/demo/departed-workspaces/chat-quiet-slate-archive',
  createdAt: '2026-07-01T08:00:00.000Z',
  updatedAt: '2026-07-11T08:30:00.000Z',
  departedAt: '2026-07-11T08:30:00.000Z',
  lifecycle: 'departed',
  handoff: {
    preparedAt: '2026-07-11T08:29:00.000Z',
    dirtyFiles: [],
    openIssueIds: ['issue-1'],
    scheduledIssueIds: [],
    resumeIds: ['resume-1'],
    sessionRecords: 1,
  },
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
  mocks.useWorkspaces.mockImplementation(context)
  mocks.listDepartedWorkspaces.mockResolvedValue([departedWorkspace])
  mocks.purgeDepartedWorkspace.mockResolvedValue(undefined)
  mocks.restoreWorkspace.mockResolvedValue(undefined)
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('WorkspaceListPage departed workspaces', () => {
  it('localizes the inventory and confirms permanent purge inside the app', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm')
    render(<WorkspaceListPage />)

    expect(await screen.findByRole('heading', { name: '已离职工作区' })).toBeTruthy()
    expect(screen.getByText('已离职工作区位于活跃工作区目录之外。恢复会带回原检出和会话签名；永久清理会删除文件，但保留历史墓碑。')).toBeTruthy()
    expect(screen.getByText('已离职')).toBeTruthy()
    expect(screen.getByText('1 个会话')).toBeTruthy()
    expect(screen.getByText('1 个未结议题')).toBeTruthy()
    expect(screen.getByRole('button', { name: '恢复 macro-research-archive' })).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: '永久清理 macro-research-archive 的文件' }))

    expect(screen.getByRole('heading', { name: '永久清理 macro-research-archive？' })).toBeTruthy()
    expect(screen.getByText(/归档检出、交互会话记录和 Shell 历史输出/)).toBeTruthy()
    expect(screen.getByText(/无头运行历史、收件箱条目和产物溯源/)).toBeTruthy()
    expect(confirmSpy).not.toHaveBeenCalled()
    expect(mocks.purgeDepartedWorkspace).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: '取消' }))
    expect(screen.queryByRole('heading', { name: '永久清理 macro-research-archive？' })).toBeNull()

    let finishPurge!: () => void
    mocks.purgeDepartedWorkspace.mockImplementationOnce(() => new Promise<void>((resolve) => {
      finishPurge = resolve
    }))
    fireEvent.click(screen.getByRole('button', { name: '永久清理 macro-research-archive 的文件' }))
    fireEvent.click(screen.getByRole('button', { name: '永久清理文件' }))

    await waitFor(() => {
      expect(mocks.purgeDepartedWorkspace).toHaveBeenCalledWith('chat-quiet-slate-archive')
    })
    expect((screen.getByRole('button', { name: '正在永久清理…' }) as HTMLButtonElement).disabled).toBe(true)
    await act(async () => finishPurge())
    await waitFor(() => {
      expect(screen.queryByRole('heading', { name: '永久清理 macro-research-archive？' })).toBeNull()
    })
    confirmSpy.mockRestore()
  })

  it('keeps the purge confirmation open and reports an API failure', async () => {
    mocks.purgeDepartedWorkspace.mockRejectedValueOnce(new Error('archive is locked'))
    render(<WorkspaceListPage />)

    fireEvent.click(await screen.findByRole('button', { name: '永久清理 macro-research-archive 的文件' }))
    fireEvent.click(screen.getByRole('button', { name: '永久清理文件' }))

    expect(await screen.findByText('archive is locked')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '永久清理 macro-research-archive？' })).toBeTruthy()
  })
})

describe('WorkspaceListPage inventory truthfulness', () => {
  it('offers recovery instead of rendering a failed first load as an empty Workspace list', async () => {
    const failed = {
      ...context(),
      hasLoaded: false,
      listError: 'list failed: 500',
    }
    mocks.useWorkspaces.mockReturnValue(failed)
    mocks.listDepartedWorkspaces.mockResolvedValue([])

    render(<WorkspaceListPage />)

    expect(screen.getByRole('heading', { name: '暂时无法读取工作区' })).toBeTruthy()
    expect(screen.queryByText('还没有工作区。请从侧栏新建；每个工作区都是隔离的 Git 目录，并带有持久终端会话。')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(failed.refresh).toHaveBeenCalledOnce()
  })

  it('keeps departed records visible without claiming there are zero active Workspaces', async () => {
    mocks.useWorkspaces.mockReturnValue({
      ...context(),
      hasLoaded: false,
      listError: 'list failed: 500',
    })

    render(<WorkspaceListPage />)

    expect(await screen.findByRole('heading', { name: '已离职工作区' })).toBeTruthy()
    expect(screen.getByText('活跃数量不可用')).toBeTruthy()
    expect(screen.queryByText('0 个工作区')).toBeNull()
    expect(screen.getByText('活跃工作区清单暂时不可用；已离职记录仍可查看。')).toBeTruthy()
  })

  it('gives the true empty state a page-level creation path', async () => {
    mocks.listDepartedWorkspaces.mockResolvedValue([])
    render(<WorkspaceListPage />)

    const action = screen.getByRole('button', { name: '浏览模板' })
    fireEvent.click(action)
    expect(mocks.openOrFocus).toHaveBeenCalledWith({ kind: 'template-catalog', params: {} })
  })
})
