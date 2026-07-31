// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

  it('never reports a failed account check as a clean review queue', async () => {
    mocks.walletStatus.mockRejectedValue(new Error('account unavailable'))

    render(<PushApprovalPanel />)

    expect((await screen.findAllByText('已验证 0 / 1 个账户')).length).toBeGreaterThan(1)
    expect(screen.getAllByText('审批状态尚未验证')).toHaveLength(2)
    expect(screen.getByText('无法验证：模拟账户')).toBeTruthy()
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(screen.queryByText('工作树干净')).toBeNull()
    expect(screen.queryByText('没有等待审批的券商写入。')).toBeNull()
  })

  it('shows partial account verification instead of a global clean state', async () => {
    const secondAccount = { ...paperAccount, id: 'paper-account-2', label: '第二个模拟账户' }
    mocks.listUTASummaries.mockResolvedValue({ utas: [paperAccount, secondAccount] })
    mocks.walletStatus.mockImplementation(async (accountId: string) => {
      if (accountId === secondAccount.id) throw new Error('account unavailable')
      return {
        staged: [],
        pendingMessage: null,
        head: 'abc123456789',
        commitCount: 0,
      }
    })

    render(<PushApprovalPanel />)

    expect((await screen.findAllByText('已验证 1 / 2 个账户')).length).toBeGreaterThan(1)
    expect(screen.getByText('无法验证：第二个模拟账户')).toBeTruthy()
    expect(screen.queryByText('工作树干净')).toBeNull()
  })

  it('offers recovery when the trading account list cannot be verified', async () => {
    mocks.listUTASummaries.mockRejectedValueOnce(new Error('UTA list unavailable'))

    render(<PushApprovalPanel />)

    expect((await screen.findAllByText('审批状态尚未验证')).length).toBeGreaterThan(1)
    expect(screen.queryByText('没有交易账户')).toBeNull()
    expect(screen.queryByText('工作树干净')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: '重试' }))

    expect((await screen.findAllByText('工作树干净')).length).toBeGreaterThan(1)
    expect(screen.queryByText('审批状态尚未验证')).toBeNull()
  })

  it('keeps last-known review items visible during a transient account failure', async () => {
    mocks.walletStatus
      .mockResolvedValueOnce({
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
      .mockRejectedValue(new Error('account unavailable'))

    render(<PushApprovalPanel />)

    expect(await screen.findByText('调整 AAPL 仓位')).toBeTruthy()
    await new Promise((resolve) => window.setTimeout(resolve, 3_200))

    expect((await screen.findAllByText('已验证 0 / 1 个账户')).length).toBeGreaterThan(1)
    expect(screen.getAllByText('调整 AAPL 仓位').length).toBeGreaterThan(0)
    expect(screen.queryByText('工作树干净')).toBeNull()
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

  it('uses a queue-to-detail drill-in on narrow layouts while preserving the desktop split view', async () => {
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

    const queue = await screen.findByTestId('trading-review-queue')
    const detail = screen.getByTestId('trading-review-detail')
    expect(queue.className).toContain('flex')
    expect(queue.className).toContain('md:flex')
    expect(detail.className).toContain('hidden')
    expect(detail.className).toContain('md:block')

    const queueRow = await screen.findByRole('button', { name: /调整 AAPL 仓位/ })
    fireEvent.click(queueRow)

    expect(queue.className).toContain('hidden')
    expect(detail.className).toContain('block')
    expect(detail.className).toContain('overflow-x-hidden')

    const back = screen.getByRole('button', { name: '返回队列' })
    expect(back.className).toContain('min-h-10')
    await waitFor(() => expect(document.activeElement).toBe(back))
    fireEvent.click(back)

    expect(queue.className).toContain('flex')
    expect(detail.className).toContain('hidden')
    await waitFor(() => expect(document.activeElement).toBe(queueRow))
  })
})
