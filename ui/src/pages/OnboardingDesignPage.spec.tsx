// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { OnboardingDesignPage } from './OnboardingDesignPage'

const mocks = vi.hoisted(() => ({
  getCredentials: vi.fn(),
  getTradingStatus: vi.fn(),
  loadTradingConfig: vi.fn(),
  loadConfig: vi.fn(),
  openOrFocus: vi.fn(),
  agents: [
    { id: 'claude', displayName: 'Claude Code', kind: 'agent', installed: true },
    { id: 'codex', displayName: 'Codex', kind: 'agent', installed: true },
    { id: 'opencode', displayName: 'opencode', kind: 'agent', installed: true },
    { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
  ],
}))

vi.mock('../api/config', () => ({
  configApi: {
    getCredentials: mocks.getCredentials,
    load: mocks.loadConfig,
  },
}))

vi.mock('../api/trading', () => ({
  tradingApi: {
    status: mocks.getTradingStatus,
    loadTradingConfig: mocks.loadTradingConfig,
  },
}))

vi.mock('../contexts/workspaces-context', () => ({
  useWorkspaces: () => ({ agents: mocks.agents }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) => (
    selector({ openOrFocus: mocks.openOrFocus })
  ),
}))

beforeEach(async () => {
  mocks.getCredentials.mockReset()
  mocks.getTradingStatus.mockReset()
  mocks.loadTradingConfig.mockReset()
  mocks.loadConfig.mockReset()
  mocks.openOrFocus.mockReset()
  mocks.agents.splice(
    0,
    mocks.agents.length,
    { id: 'claude', displayName: 'Claude Code', kind: 'agent', installed: true },
    { id: 'codex', displayName: 'Codex', kind: 'agent', installed: true },
    { id: 'opencode', displayName: 'opencode', kind: 'agent', installed: true },
    { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
  )
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('OnboardingDesignPage', () => {
  it('localizes the ready setup checklist and its dynamic status', async () => {
    mocks.getCredentials.mockResolvedValue({ credentials: [{ slug: 'one' }, { slug: 'two' }] })
    mocks.getTradingStatus.mockResolvedValue({ mode: 'pro', modeSource: 'auto' })
    mocks.loadTradingConfig.mockResolvedValue({
      utas: [
        { id: 'one', enabled: true, readOnly: false, asVendor: true },
        { id: 'two', enabled: true, readOnly: true, asVendor: true },
        { id: 'three', enabled: true, readOnly: false, asVendor: true },
      ],
    })
    mocks.loadConfig.mockResolvedValue({
      agent: { allowAiTrading: true },
      trading: { mode: 'pro' },
    })

    render(<OnboardingDesignPage />)

    expect(await screen.findByRole('heading', { name: '让 Alice 一层一层准备就绪。' })).toBeTruthy()
    expect(screen.getAllByText('Pro · 自动')).toHaveLength(2)
    expect(screen.getByText('4/4 个运行时')).toBeTruthy()
    expect(screen.getByText('凭证库中有 2 个凭证可注入工作区。')).toBeTruthy()
    expect(screen.getByText('共 3 个，已启用 3 个，只读 1 个，数据供应账户 3 个。')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '能力图' })).toBeTruthy()
    expect(screen.queryByText('Setup checklist')).toBeNull()
  })

  it('keeps the localized next setup action navigable', async () => {
    mocks.agents.splice(
      0,
      mocks.agents.length,
      { id: 'pi', displayName: 'Pi', kind: 'agent', installed: true },
    )
    mocks.getCredentials.mockResolvedValue({ credentials: [] })
    mocks.getTradingStatus.mockResolvedValue({ mode: 'lite', modeSource: 'auto' })
    mocks.loadTradingConfig.mockResolvedValue({ utas: [] })
    mocks.loadConfig.mockResolvedValue({
      agent: { allowAiTrading: false },
      trading: { mode: 'lite' },
    })
    const user = userEvent.setup()

    render(<OnboardingDesignPage />)

    const nextActions = await screen.findAllByRole('button', { name: '打开 AI 提供方' })
    expect(nextActions).toHaveLength(2)
    expect(screen.getByText('添加 AI 访问')).toBeTruthy()
    expect(screen.getByText('UTA 可以稍后再配')).toBeTruthy()
    expect(screen.getAllByText('可选').length).toBeGreaterThan(0)

    await user.click(nextActions[1])

    expect(mocks.openOrFocus).toHaveBeenCalledWith({
      kind: 'settings',
      params: { category: 'ai-provider' },
    })
  })
})
