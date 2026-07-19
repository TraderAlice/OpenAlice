import { describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { IN } from '../src/message.js'
import { DefaultEWrapper } from '../src/wrapper.js'

const RAW_ID_TEXT_ACCOUNT_SERVER_VERSION = 206

function createDecoder(): { decoder: Decoder; wrapper: DefaultEWrapper } {
  const wrapper = new DefaultEWrapper()
  const decoder = new Decoder(wrapper, RAW_ID_TEXT_ACCOUNT_SERVER_VERSION)
  applyAllHandlers(decoder)
  return { decoder, wrapper }
}

describe('Decoder text account payloads', () => {
  it('decodes the Gateway account-value frame reported in #132/#162', () => {
    const { decoder, wrapper } = createDecoder()
    const updateAccountValue = vi.spyOn(wrapper, 'updateAccountValue')

    decoder.interpret(
      IN.ACCT_VALUE,
      ['2', 'CashBalance', '1000000.00', 'USD', 'DU_TEST'],
    )

    expect(updateAccountValue).toHaveBeenCalledWith(
      'CashBalance',
      '1000000.00',
      'USD',
      'DU_TEST',
    )
  })

  it('decodes the initial text-account handshake frames without a payload msgId', () => {
    const { decoder, wrapper } = createDecoder()
    const nextValidId = vi.spyOn(wrapper, 'nextValidId')
    const managedAccounts = vi.spyOn(wrapper, 'managedAccounts')
    const updateAccountTime = vi.spyOn(wrapper, 'updateAccountTime')
    const accountDownloadEnd = vi.spyOn(wrapper, 'accountDownloadEnd')

    decoder.interpret(IN.NEXT_VALID_ID, ['1', '42'])
    decoder.interpret(IN.MANAGED_ACCTS, ['1', 'DU_TEST'])
    decoder.interpret(IN.ACCT_UPDATE_TIME, ['1', '17:30'])
    decoder.interpret(IN.ACCT_DOWNLOAD_END, ['1', 'DU_TEST'])

    expect(nextValidId).toHaveBeenCalledWith(42)
    expect(managedAccounts).toHaveBeenCalledWith('DU_TEST')
    expect(updateAccountTime).toHaveBeenCalledWith('17:30')
    expect(accountDownloadEnd).toHaveBeenCalledWith('DU_TEST')
  })

  it('decodes a complete text portfolio row from its version field', () => {
    const { decoder, wrapper } = createDecoder()
    const updatePortfolio = vi.spyOn(wrapper, 'updatePortfolio')

    decoder.interpret(IN.PORTFOLIO_VALUE, [
      '8',
      '265598',
      'AAPL',
      'STK',
      '',
      '0',
      '',
      '1',
      'NASDAQ',
      'USD',
      'AAPL',
      'NMS',
      '10',
      '250',
      '2500',
      '200',
      '500',
      '0',
      'DU_TEST',
    ])

    expect(updatePortfolio).toHaveBeenCalledOnce()
    const [contract, position, marketPrice, marketValue, averageCost,
      unrealizedPnl, realizedPnl, accountName] = updatePortfolio.mock.calls[0]
    expect(contract).toMatchObject({
      conId: 265598,
      symbol: 'AAPL',
      secType: 'STK',
      multiplier: '1',
      primaryExchange: 'NASDAQ',
      currency: 'USD',
      localSymbol: 'AAPL',
      tradingClass: 'NMS',
    })
    expect(position).toEqual(new Decimal('10'))
    expect(marketPrice).toBe('250')
    expect(marketValue).toBe('2500')
    expect(averageCost).toBe('200')
    expect(unrealizedPnl).toBe('500')
    expect(realizedPnl).toBe('0')
    expect(accountName).toBe('DU_TEST')
  })

  it('decodes position and account-summary payloads from their version field', () => {
    const { decoder, wrapper } = createDecoder()
    const position = vi.spyOn(wrapper, 'position')
    const positionEnd = vi.spyOn(wrapper, 'positionEnd')
    const accountSummary = vi.spyOn(wrapper, 'accountSummary')
    const accountSummaryEnd = vi.spyOn(wrapper, 'accountSummaryEnd')

    decoder.interpret(IN.POSITION_DATA, [
      '3',
      'DU_TEST',
      '265598',
      'AAPL',
      'STK',
      '',
      '0',
      '',
      '1',
      'SMART',
      'USD',
      'AAPL',
      'NMS',
      '10',
      '200',
    ])
    decoder.interpret(IN.POSITION_END, ['1'])
    decoder.interpret(IN.ACCOUNT_SUMMARY, [
      '1',
      '7',
      'DU_TEST',
      'NetLiquidation',
      '1000000.00',
      'USD',
    ])
    decoder.interpret(IN.ACCOUNT_SUMMARY_END, ['1', '7'])

    expect(position).toHaveBeenCalledOnce()
    expect(position.mock.calls[0][0]).toBe('DU_TEST')
    expect(position.mock.calls[0][1]).toMatchObject({
      conId: 265598,
      symbol: 'AAPL',
      secType: 'STK',
      tradingClass: 'NMS',
    })
    expect(position.mock.calls[0][2]).toEqual(new Decimal('10'))
    expect(position.mock.calls[0][3]).toBe(200)
    expect(positionEnd).toHaveBeenCalledOnce()
    expect(accountSummary).toHaveBeenCalledWith(
      7,
      'DU_TEST',
      'NetLiquidation',
      '1000000.00',
      'USD',
    )
    expect(accountSummaryEnd).toHaveBeenCalledWith(7)
  })

  it('decodes multi-account payloads from their version field', () => {
    const { decoder, wrapper } = createDecoder()
    const positionMulti = vi.spyOn(wrapper, 'positionMulti')
    const positionMultiEnd = vi.spyOn(wrapper, 'positionMultiEnd')
    const accountUpdateMulti = vi.spyOn(wrapper, 'accountUpdateMulti')
    const accountUpdateMultiEnd = vi.spyOn(wrapper, 'accountUpdateMultiEnd')

    decoder.interpret(IN.POSITION_MULTI, [
      '1',
      '11',
      'DU_TEST',
      '265598',
      'AAPL',
      'STK',
      '',
      '0',
      '',
      '1',
      'SMART',
      'USD',
      'AAPL',
      'NMS',
      '10',
      '200',
      'MODEL',
    ])
    decoder.interpret(IN.POSITION_MULTI_END, ['1', '11'])
    decoder.interpret(IN.ACCOUNT_UPDATE_MULTI, [
      '1',
      '12',
      'DU_TEST',
      'MODEL',
      'CashBalance',
      '1000000.00',
      'USD',
    ])
    decoder.interpret(IN.ACCOUNT_UPDATE_MULTI_END, ['1', '12'])

    expect(positionMulti).toHaveBeenCalledOnce()
    expect(positionMulti.mock.calls[0][0]).toBe(11)
    expect(positionMulti.mock.calls[0][1]).toBe('DU_TEST')
    expect(positionMulti.mock.calls[0][2]).toBe('MODEL')
    expect(positionMulti.mock.calls[0][3]).toMatchObject({ conId: 265598, symbol: 'AAPL' })
    expect(positionMulti.mock.calls[0][4]).toEqual(new Decimal('10'))
    expect(positionMulti.mock.calls[0][5]).toBe(200)
    expect(positionMultiEnd).toHaveBeenCalledWith(11)
    expect(accountUpdateMulti).toHaveBeenCalledWith(
      12,
      'DU_TEST',
      'MODEL',
      'CashBalance',
      '1000000.00',
      'USD',
    )
    expect(accountUpdateMultiEnd).toHaveBeenCalledWith(12)
  })

  it('decodes PnL payloads that begin directly with reqId', () => {
    const { decoder, wrapper } = createDecoder()
    const pnl = vi.spyOn(wrapper, 'pnl')
    const pnlSingle = vi.spyOn(wrapper, 'pnlSingle')

    decoder.interpret(IN.PNL, ['21', '10.5', '11.5', '12.5'])
    decoder.interpret(IN.PNL_SINGLE, ['22', '3', '20.5', '21.5', '22.5', '500'])

    expect(pnl).toHaveBeenCalledWith(21, 10.5, 11.5, 12.5)
    expect(pnlSingle).toHaveBeenCalledWith(
      22,
      new Decimal('3'),
      20.5,
      21.5,
      22.5,
      500,
    )
  })
})
