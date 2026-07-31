// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../../i18n'
import { WorkspaceLaunchConfigurationPanel } from './WorkspaceLaunchConfigurationPanel'

const mocks = vi.hoisted(() => ({
  getWorkspaceLaunchPlan: vi.fn(),
  writeText: vi.fn(async () => undefined),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    getWorkspaceLaunchPlan: mocks.getWorkspaceLaunchPlan,
  }
})

function plan(agent = 'codex') {
  return {
    workspace: { id: 'chat-1', tag: 'chat-one', dir: '/tmp/chat-1' },
    agent: {
      id: agent,
      displayName: agent === 'codex' ? 'Codex' : 'Shell',
      kind: agent === 'shell' ? 'utility' as const : 'agent' as const,
      installed: true,
      binPath: agent === 'shell' ? '/bin/zsh' : '/usr/local/bin/codex',
      capabilities: {
        parallelPerCwd: true,
        resumeLast: agent !== 'shell',
        resumeById: agent !== 'shell',
        transcriptDiscovery: agent === 'shell' ? 'none' as const : 'subprocess' as const,
        headless: agent !== 'shell',
      },
    },
    launch: {
      intent: 'fresh' as const,
      mode: 'direct' as const,
      composedCommand: agent === 'shell'
        ? ['/bin/zsh', '--login']
        : ['codex', '--sandbox', 'danger-full-access'],
      resolvedCommand: agent === 'shell'
        ? ['/bin/zsh', '--login']
        : ['/usr/local/bin/codex', '--sandbox', 'danger-full-access'],
      cwd: '/tmp/chat-1',
      envPWD: '/tmp/chat-1',
      environment: [
        { key: 'TERM', source: 'terminal' as const, presentation: 'value' as const, value: 'xterm-256color' },
        { key: 'PATH', source: 'tools' as const, presentation: 'path-count' as const, count: 12 },
        { key: 'OPENALICE_WORKSPACE_KEY', source: 'adapter' as const, presentation: 'redacted' as const },
      ],
      transcriptDir: agent === 'shell' ? null : '/tmp/transcripts/codex',
    },
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
  mocks.getWorkspaceLaunchPlan.mockImplementation(async (_wsId: string, agent: string) => plan(agent))
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: mocks.writeText },
  })
})

afterEach(cleanup)

describe('WorkspaceLaunchConfigurationPanel', () => {
  it('shows the canonical command, platform resolution, and redacted environment contributions', async () => {
    render(
      <WorkspaceLaunchConfigurationPanel
        wsId="chat-1"
        agents={['codex', 'shell']}
        installationDefaultAgent="codex"
        initialAgent="codex"
        onSaveDefaultAgent={vi.fn(async () => undefined)}
      />,
    )

    expect((await screen.findAllByText('/usr/local/bin/codex')).length).toBe(2)
    expect(screen.getAllByText('danger-full-access').length).toBeGreaterThan(0)
    expect(screen.getByText('平台解析后的进程 argv')).toBeTruthy()
    expect(screen.getByText('12 个搜索路径')).toBeTruthy()
    expect(screen.getByText('已脱敏')).toBeTruthy()
    expect(mocks.getWorkspaceLaunchPlan).toHaveBeenCalledWith('chat-1', 'codex')

    fireEvent.click(screen.getByRole('button', { name: '复制进程 argv' }))
    await waitFor(() => expect(mocks.writeText).toHaveBeenCalledWith(
      JSON.stringify(['/usr/local/bin/codex', '--sandbox', 'danger-full-access']),
    ))
  })

  it('refreshes the plan when another enabled runtime is selected', async () => {
    render(
      <WorkspaceLaunchConfigurationPanel
        wsId="chat-1"
        agents={['codex']}
        installationDefaultAgent="codex"
        initialAgent="codex"
        onSaveDefaultAgent={vi.fn(async () => undefined)}
      />,
    )

    await screen.findAllByText('/usr/local/bin/codex')
    fireEvent.click(screen.getByRole('button', { name: 'Shell' }))

    expect((await screen.findAllByText('/bin/zsh')).length).toBe(2)
    expect(screen.getByText('不发现原生会话记录')).toBeTruthy()
    expect(mocks.getWorkspaceLaunchPlan).toHaveBeenLastCalledWith('chat-1', 'shell')
  })

  it('shows Shell even when the Workspace has no configured agent runtime', async () => {
    render(
      <WorkspaceLaunchConfigurationPanel
        wsId="chat-1"
        agents={[]}
        installationDefaultAgent={null}
        onSaveDefaultAgent={vi.fn(async () => undefined)}
      />,
    )

    expect((await screen.findAllByText('/bin/zsh')).length).toBe(2)
    expect(screen.getByRole('button', { name: 'Shell' })).toBeTruthy()
    expect(mocks.getWorkspaceLaunchPlan).toHaveBeenCalledWith('chat-1', 'shell')
  })

  it('surfaces a read-only load failure without closing the settings panel', async () => {
    mocks.getWorkspaceLaunchPlan.mockRejectedValueOnce(new Error('workspace_not_found'))
    render(
      <WorkspaceLaunchConfigurationPanel
        wsId="chat-1"
        agents={['codex']}
        installationDefaultAgent="codex"
        initialAgent="codex"
        onSaveDefaultAgent={vi.fn(async () => undefined)}
      />,
    )

    expect(await screen.findByText('无法读取启动计划')).toBeTruthy()
    expect(screen.getByText('workspace_not_found')).toBeTruthy()
    expect(screen.getByText(/仅预览/)).toBeTruthy()
  })

  it('saves a Workspace runtime default without changing it when only previewing', async () => {
    const onSaveDefaultAgent = vi.fn(async () => undefined)
    render(
      <WorkspaceLaunchConfigurationPanel
        wsId="chat-1"
        agents={['claude', 'codex', 'pi']}
        workspaceDefaultAgent="codex"
        installationDefaultAgent="claude"
        onSaveDefaultAgent={onSaveDefaultAgent}
      />,
    )

    const selector = screen.getByLabelText('新 Session Runtime')
    expect((selector as HTMLSelectElement).value).toBe('codex')

    fireEvent.click(screen.getByRole('button', { name: 'Pi' }))
    expect((selector as HTMLSelectElement).value).toBe('codex')
    expect(onSaveDefaultAgent).not.toHaveBeenCalled()

    fireEvent.change(selector, { target: { value: 'pi' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(onSaveDefaultAgent).toHaveBeenCalledWith('pi'))
  })
})
