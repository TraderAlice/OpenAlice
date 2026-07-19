import { describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { IN } from '../src/message.js'
import { DefaultEWrapper } from '../src/wrapper.js'

function createDecoder(): { decoder: Decoder; wrapper: DefaultEWrapper } {
  const wrapper = new DefaultEWrapper()
  const decoder = new Decoder(wrapper, 206)
  applyAllHandlers(decoder)
  return { decoder, wrapper }
}

describe('Decoder text execution payloads', () => {
  it('decodes execution details beginning directly with reqId', () => {
    const { decoder, wrapper } = createDecoder()
    const execDetails = vi.spyOn(wrapper, 'execDetails')

    decoder.interpret(IN.EXECUTION_DATA, [
      '101',
      '81',
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
      'EXEC-1',
      '20260717 12:00:00',
      'DU_TEST',
      'NASDAQ',
      'BOT',
      '2',
      '250.5',
      '9001',
      '7',
      '0',
      '2',
      '250.5',
      'ref',
      '',
      '0',
      'MODEL',
      '1',
      '0',
      'SUBMITTER',
    ])

    expect(execDetails).toHaveBeenCalledOnce()
    expect(execDetails.mock.calls[0][0]).toBe(101)
    expect(execDetails.mock.calls[0][1]).toMatchObject({
      conId: 265598,
      symbol: 'AAPL',
      secType: 'STK',
      tradingClass: 'NMS',
    })
    expect(execDetails.mock.calls[0][2]).toMatchObject({
      orderId: 81,
      execId: 'EXEC-1',
      acctNumber: 'DU_TEST',
      side: 'BOT',
      shares: new Decimal('2'),
      price: 250.5,
      permId: 9001,
      clientId: 7,
      modelCode: 'MODEL',
      lastLiquidity: 1,
      pendingPriceRevision: false,
      submitter: 'SUBMITTER',
    })
  })

  it('decodes execution end and commission payloads from their version field', () => {
    const { decoder, wrapper } = createDecoder()
    const execDetailsEnd = vi.spyOn(wrapper, 'execDetailsEnd')
    const commissionAndFeesReport = vi.spyOn(wrapper, 'commissionAndFeesReport')

    decoder.interpret(IN.EXECUTION_DATA_END, ['1', '101'])
    decoder.interpret(IN.COMMISSION_AND_FEES_REPORT, [
      '1', 'EXEC-1', '1.25', 'USD', '25', '0', '0',
    ])

    expect(execDetailsEnd).toHaveBeenCalledWith(101)
    expect(commissionAndFeesReport).toHaveBeenCalledOnce()
    expect(commissionAndFeesReport.mock.calls[0][0]).toMatchObject({
      execId: 'EXEC-1',
      commissionAndFees: 1.25,
      currency: 'USD',
      realizedPNL: 25,
      yield_: 0,
      yieldRedemptionDate: 0,
    })
  })
})
