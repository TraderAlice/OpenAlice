import { describe, expect, it, vi } from 'vitest'
import Decimal from 'decimal.js'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { IN } from '../src/message.js'
import { TickTypeEnum } from '../src/tick-type.js'
import { DefaultEWrapper } from '../src/wrapper.js'

function createDecoder(): { decoder: Decoder; wrapper: DefaultEWrapper } {
  const wrapper = new DefaultEWrapper()
  const decoder = new Decoder(wrapper, 206)
  applyAllHandlers(decoder)
  return { decoder, wrapper }
}

describe('Decoder text market-data payloads', () => {
  it('decodes tick price and size payloads from their version field', () => {
    const { decoder, wrapper } = createDecoder()
    const tickPrice = vi.spyOn(wrapper, 'tickPrice')
    const tickSize = vi.spyOn(wrapper, 'tickSize')

    decoder.interpret(IN.TICK_PRICE, ['3', '41', '1', '250.5', '10', '7'])
    decoder.interpret(IN.TICK_SIZE, ['1', '42', '0', '11'])

    expect(tickPrice).toHaveBeenCalledOnce()
    expect(tickPrice.mock.calls[0][0]).toBe(41)
    expect(tickPrice.mock.calls[0][1]).toBe(TickTypeEnum.BID)
    expect(tickPrice.mock.calls[0][2]).toBe(250.5)
    expect(tickPrice.mock.calls[0][3]).toMatchObject({
      canAutoExecute: true,
      pastLimit: true,
      preOpen: true,
    })
    expect(tickSize).toHaveBeenCalledWith(41, TickTypeEnum.BID_SIZE, new Decimal('10'))
    expect(tickSize).toHaveBeenCalledWith(42, TickTypeEnum.BID_SIZE, new Decimal('11'))
  })

  it('decodes option, generic, string, and EFP tick payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const tickOptionComputation = vi.spyOn(wrapper, 'tickOptionComputation')
    const tickGeneric = vi.spyOn(wrapper, 'tickGeneric')
    const tickString = vi.spyOn(wrapper, 'tickString')
    const tickEFP = vi.spyOn(wrapper, 'tickEFP')

    decoder.interpret(IN.TICK_OPTION_COMPUTATION, [
      '51', '13', '1', '0.25', '0.5', '1.2', '0.1', '0.02', '0.03', '-0.04', '250',
    ])
    decoder.interpret(IN.TICK_GENERIC, ['1', '52', '23', '1.5'])
    decoder.interpret(IN.TICK_STRING, ['1', '53', '45', 'hello'])
    decoder.interpret(IN.TICK_EFP, [
      '1', '54', '38', '1.1', '1.1bp', '251', '3', '202612', '0.2', '0.3',
    ])

    expect(tickOptionComputation).toHaveBeenCalledWith(
      51, 13, 1, 0.25, 0.5, 1.2, 0.1, 0.02, 0.03, -0.04, 250,
    )
    expect(tickGeneric).toHaveBeenCalledWith(52, 23, 1.5)
    expect(tickString).toHaveBeenCalledWith(53, 45, 'hello')
    expect(tickEFP).toHaveBeenCalledWith(
      54, 38, 1.1, '1.1bp', 251, 3, '202612', 0.2, 0.3,
    )
  })

  it('decodes snapshot, market-data type, and request-parameter payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const tickSnapshotEnd = vi.spyOn(wrapper, 'tickSnapshotEnd')
    const marketDataType = vi.spyOn(wrapper, 'marketDataType')
    const tickReqParams = vi.spyOn(wrapper, 'tickReqParams')

    decoder.interpret(IN.TICK_SNAPSHOT_END, ['1', '61'])
    decoder.interpret(IN.MARKET_DATA_TYPE, ['1', '62', '3'])
    decoder.interpret(IN.TICK_REQ_PARAMS, ['63', '0.01', 'NASDAQ', '7'])

    expect(tickSnapshotEnd).toHaveBeenCalledWith(61)
    expect(marketDataType).toHaveBeenCalledWith(62, 3)
    expect(tickReqParams).toHaveBeenCalledWith(63, 0.01, 'NASDAQ', 7)
  })

  it('decodes depth and reroute payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const updateMktDepth = vi.spyOn(wrapper, 'updateMktDepth')
    const updateMktDepthL2 = vi.spyOn(wrapper, 'updateMktDepthL2')
    const rerouteMktDataReq = vi.spyOn(wrapper, 'rerouteMktDataReq')
    const rerouteMktDepthReq = vi.spyOn(wrapper, 'rerouteMktDepthReq')

    decoder.interpret(IN.MARKET_DEPTH, ['1', '71', '2', '0', '1', '250.5', '10'])
    decoder.interpret(IN.MARKET_DEPTH_L2, [
      '1', '72', '3', 'MM', '1', '0', '251.5', '11', '1',
    ])
    decoder.interpret(IN.REROUTE_MKT_DATA_REQ, ['73', '265598', 'NASDAQ'])
    decoder.interpret(IN.REROUTE_MKT_DEPTH_REQ, ['74', '265598', 'NASDAQ'])

    expect(updateMktDepth).toHaveBeenCalledWith(
      71, 2, 0, 1, 250.5, new Decimal('10'),
    )
    expect(updateMktDepthL2).toHaveBeenCalledWith(
      72, 3, 'MM', 1, 0, 251.5, new Decimal('11'), true,
    )
    expect(rerouteMktDataReq).toHaveBeenCalledWith(73, 265598, 'NASDAQ')
    expect(rerouteMktDepthReq).toHaveBeenCalledWith(74, 265598, 'NASDAQ')
  })
})
