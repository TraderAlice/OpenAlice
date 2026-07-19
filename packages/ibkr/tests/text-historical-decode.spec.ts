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

describe('Decoder text historical payloads', () => {
  it('decodes historical bars, updates, and end markers beginning with reqId', () => {
    const { decoder, wrapper } = createDecoder()
    const historicalData = vi.spyOn(wrapper, 'historicalData')
    const historicalDataUpdate = vi.spyOn(wrapper, 'historicalDataUpdate')
    const historicalDataEnd = vi.spyOn(wrapper, 'historicalDataEnd')

    decoder.interpret(IN.HISTORICAL_DATA, [
      '201', '1', '20260717', '10', '12', '9', '11', '100', '10.5', '7',
    ])
    decoder.interpret(IN.HISTORICAL_DATA_UPDATE, [
      '202', '8', '20260718', '11', '12', '13', '10', '11.5', '101',
    ])
    decoder.interpret(IN.HISTORICAL_DATA_END, [
      '203', '20260717', '20260718',
    ])

    expect(historicalData).toHaveBeenCalledOnce()
    expect(historicalData.mock.calls[0][0]).toBe(201)
    expect(historicalData.mock.calls[0][1]).toMatchObject({
      date: '20260717',
      open: 10,
      high: 12,
      low: 9,
      close: 11,
      volume: new Decimal('100'),
      wap: new Decimal('10.5'),
      barCount: 7,
    })
    expect(historicalDataUpdate).toHaveBeenCalledOnce()
    expect(historicalDataUpdate.mock.calls[0][0]).toBe(202)
    expect(historicalDataUpdate.mock.calls[0][1]).toMatchObject({
      barCount: 8,
      date: '20260718',
      volume: new Decimal('101'),
    })
    expect(historicalDataEnd).toHaveBeenCalledWith(203, '20260717', '20260718')
  })

  it('decodes realtime bars, head timestamps, and histograms', () => {
    const { decoder, wrapper } = createDecoder()
    const realtimeBar = vi.spyOn(wrapper, 'realtimeBar')
    const headTimestamp = vi.spyOn(wrapper, 'headTimestamp')
    const histogramData = vi.spyOn(wrapper, 'histogramData')

    decoder.interpret(IN.REAL_TIME_BARS, [
      '1', '211', '1784289600', '10', '12', '9', '11', '100', '10.5', '7',
    ])
    decoder.interpret(IN.HEAD_TIMESTAMP, ['212', '20260717 12:00:00'])
    decoder.interpret(IN.HISTOGRAM_DATA, ['213', '2', '10', '5', '11', '6'])

    expect(realtimeBar).toHaveBeenCalledWith(
      211,
      1784289600,
      10,
      12,
      9,
      11,
      new Decimal('100'),
      new Decimal('10.5'),
      7,
    )
    expect(headTimestamp).toHaveBeenCalledWith(212, '20260717 12:00:00')
    expect(histogramData).toHaveBeenCalledWith(213, [
      expect.objectContaining({ price: 10, size: new Decimal('5') }),
      expect.objectContaining({ price: 11, size: new Decimal('6') }),
    ])
  })

  it('decodes all three historical-tick payload shapes', () => {
    const { decoder, wrapper } = createDecoder()
    const historicalTicks = vi.spyOn(wrapper, 'historicalTicks')
    const historicalTicksBidAsk = vi.spyOn(wrapper, 'historicalTicksBidAsk')
    const historicalTicksLast = vi.spyOn(wrapper, 'historicalTicksLast')

    decoder.interpret(IN.HISTORICAL_TICKS, [
      '221', '1', '1784289600', '', '10', '5', '1',
    ])
    decoder.interpret(IN.HISTORICAL_TICKS_BID_ASK, [
      '222', '1', '1784289601', '3', '10', '11', '5', '6', '1',
    ])
    decoder.interpret(IN.HISTORICAL_TICKS_LAST, [
      '223', '1', '1784289602', '3', '11', '6', 'NASDAQ', 'COND', '1',
    ])

    expect(historicalTicks).toHaveBeenCalledOnce()
    expect(historicalTicks.mock.calls[0][0]).toBe(221)
    expect(historicalTicks.mock.calls[0][1][0]).toMatchObject({
      time: 1784289600,
      price: 10,
      size: new Decimal('5'),
    })
    expect(historicalTicks.mock.calls[0][2]).toBe(true)
    expect(historicalTicksBidAsk).toHaveBeenCalledOnce()
    expect(historicalTicksBidAsk.mock.calls[0][1][0]).toMatchObject({
      time: 1784289601,
      priceBid: 10,
      priceAsk: 11,
      sizeBid: new Decimal('5'),
      sizeAsk: new Decimal('6'),
    })
    expect(historicalTicksLast).toHaveBeenCalledOnce()
    expect(historicalTicksLast.mock.calls[0][1][0]).toMatchObject({
      time: 1784289602,
      price: 11,
      size: new Decimal('6'),
      exchange: 'NASDAQ',
      specialConditions: 'COND',
    })
  })

  it('decodes tick-by-tick and historical-schedule payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const tickByTickAllLast = vi.spyOn(wrapper, 'tickByTickAllLast')
    const historicalSchedule = vi.spyOn(wrapper, 'historicalSchedule')

    decoder.interpret(IN.TICK_BY_TICK, [
      '231', '1', '1784289600', '11', '6', '3', 'NASDAQ', 'COND',
    ])
    decoder.interpret(IN.HISTORICAL_SCHEDULE, [
      '232',
      '20260717 09:30:00',
      '20260717 16:00:00',
      'US/Eastern',
      '1',
      '20260717 09:30:00',
      '20260717 16:00:00',
      '20260717',
    ])

    expect(tickByTickAllLast).toHaveBeenCalledOnce()
    expect(tickByTickAllLast.mock.calls[0].slice(0, 5)).toEqual([
      231, 1, 1784289600, 11, new Decimal('6'),
    ])
    expect(tickByTickAllLast.mock.calls[0][5]).toMatchObject({
      pastLimit: true,
      unreported: true,
    })
    expect(tickByTickAllLast.mock.calls[0].slice(6)).toEqual(['NASDAQ', 'COND'])
    expect(historicalSchedule).toHaveBeenCalledOnce()
    expect(historicalSchedule.mock.calls[0][0]).toBe(232)
    expect(historicalSchedule.mock.calls[0][1]).toBe('20260717 09:30:00')
    expect(historicalSchedule.mock.calls[0][2]).toBe('20260717 16:00:00')
    expect(historicalSchedule.mock.calls[0][3]).toBe('US/Eastern')
    expect(historicalSchedule.mock.calls[0][4]).toEqual([
      expect.objectContaining({
        startDateTime: '20260717 09:30:00',
        endDateTime: '20260717 16:00:00',
        refDate: '20260717',
      }),
    ])
  })
})
