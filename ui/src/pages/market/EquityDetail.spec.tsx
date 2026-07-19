// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EquityDetail } from './EquityDetail'

vi.mock('../../components/market/QuoteHeader', () => ({ QuoteHeader: () => <div>quote-panel</div> }))
vi.mock('../../components/market/ProfilePanel', () => ({ ProfilePanel: () => <div>profile-panel</div> }))
vi.mock('../../components/market/KeyMetricsPanel', () => ({ KeyMetricsPanel: () => <div>metrics-panel</div> }))
vi.mock('../../components/market/FinancialStatementsPanel', () => ({ FinancialStatementsPanel: () => <div>statements-panel</div> }))
vi.mock('../../components/market/KlinePanel', () => ({ KlinePanel: () => <div>kline-panel</div> }))
vi.mock('../../components/market/TradeableContractsPanel', () => ({ TradeableContractsPanel: () => <div>contracts-panel</div> }))

afterEach(cleanup)

describe('EquityDetail provider namespaces', () => {
  it('keeps Eastmoney native secids on the supported K-line-only surface', () => {
    render(<EquityDetail symbol="1.600519" source="eastmoney|1.600519" />)

    expect(screen.getByText(/Eastmoney provides Chinese A-share discovery/)).toBeTruthy()
    expect(screen.getByText('kline-panel')).toBeTruthy()
    expect(screen.getByText('contracts-panel')).toBeTruthy()
    expect(screen.queryByText('quote-panel')).toBeNull()
    expect(screen.queryByText('profile-panel')).toBeNull()
    expect(screen.queryByText('metrics-panel')).toBeNull()
    expect(screen.queryByText('statements-panel')).toBeNull()
  })

  it('keeps quote and fundamental panels for shared ticker namespaces', () => {
    render(<EquityDetail symbol="AAPL" source="yfinance|AAPL" />)

    expect(screen.getByText('quote-panel')).toBeTruthy()
    expect(screen.getByText('profile-panel')).toBeTruthy()
    expect(screen.getByText('metrics-panel')).toBeTruthy()
    expect(screen.getByText('statements-panel')).toBeTruthy()
  })
})
