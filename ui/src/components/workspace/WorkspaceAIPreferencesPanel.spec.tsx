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
    version: 2,
    runtime: {
      askAlice: {
        defaultAgent: 'pi',
        agents: {
          pi: { accessMode: 'vault', credentialSlug: 'deepseek-1', model: 'deepseek-v4-flash', reasoningEffort: 'high' },
        },
        recent: { agents: {} },
      },
      issues: {
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
  it('separates Ask Alice and Issues defaults and saves one scenario atomically', async () => {
    const onSaved = vi.fn(async () => undefined)
    render(
      <WorkspaceAIPreferencesPanel
        workspace={workspace}
        agents={agents}
        onSaved={onSaved}
        onConfigureProvider={vi.fn()}
      />,
    )

    expect(screen.getByDisplayValue('Pi')).toBeTruthy()
    expect(await screen.findByText('DeepSeek API')).toBeTruthy()
    expect(screen.getByText('deepseek-v4-flash · high')).toBeTruthy()

    fireEvent.click(screen.getByRole('tab', { name: '议题' }))
    const runtime = await screen.findByLabelText('默认 Agent Runtime')
    expect((runtime as HTMLSelectElement).value).toBe('')
    fireEvent.change(runtime, { target: { value: 'codex' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))

    await waitFor(() => expect(mocks.updateWorkspaceRuntimeDefaults).toHaveBeenCalledWith(
      'chat-1',
      'issues',
      { defaultAgent: 'codex', agents: {} },
    ))
    expect(onSaved).toHaveBeenCalledOnce()
  })

  it('uses a full settings form and opens the portaled AI access menu', async () => {
    render(
      <WorkspaceAIPreferencesPanel
        workspace={workspace}
        agents={agents}
        onSaved={vi.fn()}
        onConfigureProvider={vi.fn()}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: '编辑 Codex 偏好' }))
    fireEvent.click(screen.getByRole('radio', { name: /固定默认值/ }))
    const access = await screen.findByRole('button', { name: 'AI 访问' })
    expect(screen.getByRole('combobox', { name: 'AI 模型' })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: '思考强度' })).toBeTruthy()

    fireEvent.click(access)
    expect(await screen.findByText('Codex 要如何访问 AI？')).toBeTruthy()
    expect(screen.getByRole('menuitemradio', { name: /使用 Codex 账号/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('menuitemradio', { name: /DeepSeek API/ }))
    await waitFor(() => expect(screen.queryByRole('menuitemradio', { name: /DeepSeek API/ })).toBeNull())
  })
})
