// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { WorkspaceAIPreferencesPanel } from './WorkspaceAIPreferencesPanel'
import type { AgentInfo, Workspace } from './api'

const mocks = vi.hoisted(() => ({
  listAgentCredentials: vi.fn(),
  updateWorkspaceRuntimeDefaults: vi.fn(),
  getAgentRuntimeReadiness: vi.fn(),
  getPresets: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    listAgentCredentials: mocks.listAgentCredentials,
    updateWorkspaceRuntimeDefaults: mocks.updateWorkspaceRuntimeDefaults,
    getAgentRuntimeReadiness: mocks.getAgentRuntimeReadiness,
  }
})

vi.mock('@/api/config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/config')>()
  return { ...actual, getPresets: mocks.getPresets }
})

const agents: AgentInfo[] = [
  { id: 'pi', displayName: 'Pi', capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'none', headless: true } },
  { id: 'codex', displayName: 'Codex', capabilities: { parallelPerCwd: true, resumeLast: true, resumeById: true, transcriptDiscovery: 'subprocess', headless: true } },
]

const workspace: Workspace = {
  id: 'chat-1',
  tag: 'chat-one',
  dir: '/tmp/chat-one',
  createdAt: '2026-08-10T00:00:00.000Z',
  sessions: [],
  runtimeSettings: {
    version: 3,
    runtime: {
      interactive: {
        defaultAgent: 'pi',
        agents: {
          pi: { accessMode: 'vault', credentialSlug: 'deepseek-1', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
        },
        recent: {
          agent: 'pi',
          agents: {
            pi: { accessMode: 'vault', credentialSlug: 'deepseek-1', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
          },
        },
      },
      headless: {
        agents: {},
        recent: { agent: 'codex', agents: { codex: { accessMode: 'native', model: 'gpt-5.6-terra' } } },
      },
    },
  },
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
  mocks.listAgentCredentials.mockResolvedValue([{ slug: 'deepseek-1', vendor: 'deepseek', authType: 'api-key', label: 'DeepSeek API' }])
  mocks.updateWorkspaceRuntimeDefaults.mockResolvedValue(workspace)
  mocks.getAgentRuntimeReadiness.mockResolvedValue({
    checkedAt: '2026-08-10T00:00:00.000Z',
    agents: {
      pi: { agent: 'pi', ready: true, source: 'global-login' },
      codex: { agent: 'codex', ready: true, source: 'global-login' },
    },
  })
  mocks.getPresets.mockResolvedValue({ presets: [] })
})

afterEach(cleanup)

describe('WorkspaceAIPreferencesPanel', () => {
  it('shows both launch modes together and saves a runtime choice immediately', async () => {
    const onSaved = vi.fn(async () => undefined)
    render(
      <WorkspaceAIPreferencesPanel
        workspace={workspace}
        agents={agents}
        onSaved={onSaved}
        onConfigureProvider={vi.fn()}
      />,
    )

    expect(screen.queryByRole('tab')).toBeNull()
    expect(screen.getByText('交互式 Session')).toBeTruthy()
    expect(screen.getByText('无头运行')).toBeTruthy()
    expect((screen.getByRole('combobox', { name: '交互式 Session的默认 Agent Runtime' }) as HTMLSelectElement).value).toBe('pi')
    expect((await screen.findAllByText('DeepSeek API')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('deepseek-v4-flash · high').length).toBeGreaterThan(0)
    expect(screen.getByRole('option', { name: '跟随最近使用 — Pi' })).toBeTruthy()
    expect(screen.getByText('最近成功使用的 Runtime')).toBeTruthy()
    expect(screen.getByText('当前解析为')).toBeTruthy()
    expect(screen.getByText('固定默认值 · 当前最近使用')).toBeTruthy()
    expect(screen.getByText('当前最近使用的 Runtime')).toBeTruthy()
    expect(screen.getAllByText('使用最近设置').length).toBeGreaterThan(0)

    const runtime = screen.getByRole('combobox', { name: '无头运行的默认 Agent Runtime' })
    expect((runtime as HTMLSelectElement).value).toBe('')
    fireEvent.change(runtime, { target: { value: 'codex' } })

    await waitFor(() => expect(mocks.updateWorkspaceRuntimeDefaults).toHaveBeenCalledWith(
      'chat-1',
      {
        interactive: {
          defaultAgent: 'pi',
          agents: {
            pi: { accessMode: 'vault', credentialSlug: 'deepseek-1', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
          },
        },
        headless: { defaultAgent: 'codex', agents: {} },
      },
    ))
    expect(onSaved).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: '保存' })).toBeNull()
    expect((await screen.findByRole('status')).textContent).toContain('已保存')
  })

  it('saves a runtime preference directly from the full settings form', async () => {
    render(
      <WorkspaceAIPreferencesPanel
        workspace={workspace}
        agents={agents}
        onSaved={vi.fn()}
        onConfigureProvider={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '编辑交互式 Session中的 Codex 偏好' }))
    fireEvent.click(screen.getByRole('radio', { name: /固定默认值/ }))
    const access = await screen.findByRole('button', { name: 'AI 访问' })
    expect(screen.getByRole('combobox', { name: 'AI 模型' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '思考强度' })).toBeTruthy()

    fireEvent.click(access)
    expect(await screen.findByText('由谁管理 Codex 的 AI 访问？')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /由 Codex 管理/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek API/ }))
    await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: /DeepSeek API/ })).toBeNull())

    fireEvent.click(screen.getByRole('button', { name: '保存更改' }))
    await waitFor(() => expect(mocks.updateWorkspaceRuntimeDefaults).toHaveBeenCalledOnce())
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Codex 默认偏好' })).toBeNull())
  })

  it('rolls back a failed automatic save and allows retrying it', async () => {
    mocks.updateWorkspaceRuntimeDefaults.mockRejectedValueOnce(new Error('保存失败'))
    render(
      <WorkspaceAIPreferencesPanel
        workspace={workspace}
        agents={agents}
        onSaved={vi.fn()}
        onConfigureProvider={vi.fn()}
      />,
    )

    const runtime = screen.getByRole('combobox', { name: '无头运行的默认 Agent Runtime' }) as HTMLSelectElement
    fireEvent.change(runtime, { target: { value: 'codex' } })

    expect((await screen.findByRole('alert')).textContent).toContain('保存失败')
    expect(runtime.value).toBe('')

    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    await waitFor(() => expect(mocks.updateWorkspaceRuntimeDefaults).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(runtime.value).toBe('codex'))
  })
})
