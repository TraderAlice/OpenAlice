// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { PushApprovalPanel } from './PushApprovalPanel'

const mocks = vi.hoisted(() => ({
  listUTASummaries: vi.fn(),
  walletStatus: vi.fn(),
  walletLog: vi.fn(),
  walletPush: vi.fn(),
  walletReject: vi.fn(),
}))

vi.mock('../api', () => ({
  api: {
    trading: {
      listUTASummaries: mocks.listUTASummaries,
      walletStatus: mocks.walletStatus,
      walletLog: mocks.walletLog,
      walletPush: mocks.walletPush,
      walletReject: mocks.walletReject,
    },
  },
}))

const paperAccount = {
  id: 'paper-account',
  label: '模拟账户',
  asVendor: false,
  capabilities: {
    supportedSecTypes: ['STK'],
    supportedOrderTypes: ['LMT'],
  },
  health: {
    status: 'healthy',
    reach: 'readable',
    tier: 'trading',
    consecutiveFailures: 0,
    recovering: false,
    connecting: false,
    disabled: false,
  },
}

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
  mocks.listUTASummaries.mockResolvedValue({ utas: [paperAccount] })
  mocks.walletStatus.mockResolvedValue({
    staged: [],
    pendingMessage: null,
    head: 'abc123456789',
    commitCount: 0,
  })
  mocks.walletLog.mockResolvedValue({ commits: [] })
})

afterEach(cleanup)

describe('PushApprovalPanel localization', () => {
  it('renders the clean review state in the selected language', async () => {
    render(<PushApprovalPanel />)

    expect((await screen.findAllByText('工作树干净')).length).toBeGreaterThan(1)
    expect(screen.getByText('没有等待审批的券商写入。')).toBeTruthy()
    expect(screen.getByText('待审批')).toBeTruthy()
    expect(screen.getByText('已暂存')).toBeTruthy()
    expect(screen.getByText('已推送')).toBeTruthy()
    expect(screen.queryByText('Working tree clean')).toBeNull()
  })

  it('localizes a pending order review and its confirmation step', async () => {
    mocks.walletStatus.mockResolvedValue({
      staged: [{
        action: 'placeOrder',
        contract: { symbol: 'AAPL' },
        order: {
          action: 'BUY',
          orderType: 'LMT',
          totalQuantity: '2',
          lmtPrice: '210',
        },
      }],
      pendingMessage: '调整 AAPL 仓位',
      head: 'abc123456789',
      commitCount: 1,
    })

    render(<PushApprovalPanel />)

    const approve = await screen.findByRole('button', { name: '批准并推送' })
    expect(screen.getByText('需要审批')).toBeTruthy()
    expect(screen.getByText('操作差异')).toBeTruthy()
    expect(screen.getByText('买入 AAPL')).toBeTruthy()
    expect(screen.getByText('LMT → 数量 2 → 限价 210')).toBeTruthy()
    expect(screen.getByText('审阅摘要')).toBeTruthy()
    expect(screen.getByText('卖出 / 取消')).toBeTruthy()
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy()

    fireEvent.click(approve)

    expect(screen.getByRole('button', { name: '确认推送' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '取消' })).toBeTruthy()
    expect(mocks.walletPush).not.toHaveBeenCalled()
  })
})
