import { describe, expect, it, vi } from 'vitest'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { IN } from '../src/message.js'
import { DefaultEWrapper } from '../src/wrapper.js'

function createDecoder(): { decoder: Decoder; wrapper: DefaultEWrapper } {
  const wrapper = new DefaultEWrapper()
  const decoder = new Decoder(wrapper, 206)
  applyAllHandlers(decoder)
  return { decoder, wrapper }
}

describe('Decoder text contract payloads', () => {
  it('decodes contract end and symbol samples without a payload msgId', () => {
    const { decoder, wrapper } = createDecoder()
    const contractDetailsEnd = vi.spyOn(wrapper, 'contractDetailsEnd')
    const symbolSamples = vi.spyOn(wrapper, 'symbolSamples')

    decoder.interpret(IN.CONTRACT_DATA_END, ['1', '91'])
    decoder.interpret(IN.SYMBOL_SAMPLES, [
      '92',
      '1',
      '265598',
      'AAPL',
      'STK',
      'NASDAQ',
      'USD',
      '1',
      'OPT',
      'Apple Inc.',
      'ISSUER',
    ])

    expect(contractDetailsEnd).toHaveBeenCalledWith(91)
    expect(symbolSamples).toHaveBeenCalledOnce()
    expect(symbolSamples.mock.calls[0][0]).toBe(92)
    expect(symbolSamples.mock.calls[0][1]).toHaveLength(1)
    expect(symbolSamples.mock.calls[0][1][0]).toMatchObject({
      contract: {
        conId: 265598,
        symbol: 'AAPL',
        secType: 'STK',
        primaryExchange: 'NASDAQ',
        currency: 'USD',
        description: 'Apple Inc.',
        issuerId: 'ISSUER',
      },
      derivativeSecTypes: ['OPT'],
    })
  })

  it('decodes delta-neutral validation and market-rule payloads', () => {
    const { decoder, wrapper } = createDecoder()
    const deltaNeutralValidation = vi.spyOn(wrapper, 'deltaNeutralValidation')
    const marketRule = vi.spyOn(wrapper, 'marketRule')

    decoder.interpret(IN.DELTA_NEUTRAL_VALIDATION, [
      '1', '93', '265598', '0.5', '250.5',
    ])
    decoder.interpret(IN.MARKET_RULE, ['26', '2', '0', '0.01', '1', '0.05'])

    expect(deltaNeutralValidation).toHaveBeenCalledOnce()
    expect(deltaNeutralValidation.mock.calls[0][0]).toBe(93)
    expect(deltaNeutralValidation.mock.calls[0][1]).toMatchObject({
      conId: 265598,
      delta: 0.5,
      price: 250.5,
    })
    expect(marketRule).toHaveBeenCalledWith(26, [
      expect.objectContaining({ lowEdge: 0, increment: 0.01 }),
      expect.objectContaining({ lowEdge: 1, increment: 0.05 }),
    ])
  })
})
