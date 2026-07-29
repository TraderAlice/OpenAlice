// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { i18n } from '../i18n'
import { TradingAsGitPage } from './TradingAsGitPage'

const mocks = vi.hoisted(() => ({
  ensureTradingModePolling: vi.fn(),
  openOrFocus: vi.fn(),
}))

vi.mock('../live/trading-mode', () => ({
  ensureTradingModePolling: mocks.ensureTradingModePolling,
  useTradingMode: (selector: (state: {
    status: { mode: 'lite' }
    loading: boolean
  }) => unknown) => selector({
    status: { mode: 'lite' },
    loading: false,
  }),
}))

vi.mock('../tabs/store', () => ({
  useWorkspace: (selector: (state: { openOrFocus: typeof mocks.openOrFocus }) => unknown) =>
    selector({ openOrFocus: mocks.openOrFocus }),
}))

beforeEach(async () => {
  vi.clearAllMocks()
  await i18n.changeLanguage('zh')
})

afterEach(cleanup)

describe('TradingAsGitPage localization', () => {
  it('localizes the Lite-mode entry path', () => {
    render(<TradingAsGitPage />)

    expect(screen.getByRole('heading', { name: '交易即 Git' })).toBeTruthy()
    expect(screen.getByText('在将智能体暂存的券商写入推送到交易场所前进行审阅。')).toBeTruthy()
    expect(screen.getByText('精简模式')).toBeTruthy()
    expect(screen.getByRole('heading', { name: '精简模式下无法使用“交易即 Git”。' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '打开智能体权限' })).toBeTruthy()
    expect(screen.queryByText('Trading as Git is unavailable in Lite mode.')).toBeNull()
  })
})
