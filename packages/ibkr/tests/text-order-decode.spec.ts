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

describe('Decoder text order payloads', () => {
  it('decodes order status beginning directly with orderId', () => {
    const { decoder, wrapper } = createDecoder()
    const orderStatus = vi.spyOn(wrapper, 'orderStatus')

    decoder.interpret(IN.ORDER_STATUS, [
      '81', 'Submitted', '2', '3', '250.5', '9001', '0', '251', '7', '', '252',
    ])

    expect(orderStatus).toHaveBeenCalledWith(
      81,
      'Submitted',
      new Decimal('2'),
      new Decimal('3'),
      250.5,
      9001,
      0,
      251,
      7,
      '',
      252,
    )
  })

  it('decodes text order lifecycle markers without a payload msgId', () => {
    const { decoder, wrapper } = createDecoder()
    const openOrderEnd = vi.spyOn(wrapper, 'openOrderEnd')
    const orderBound = vi.spyOn(wrapper, 'orderBound')
    const completedOrdersEnd = vi.spyOn(wrapper, 'completedOrdersEnd')

    decoder.interpret(IN.OPEN_ORDER_END, ['1'])
    decoder.interpret(IN.ORDER_BOUND, ['9001', '7', '81'])
    decoder.interpret(IN.COMPLETED_ORDERS_END, [])

    expect(openOrderEnd).toHaveBeenCalledOnce()
    expect(orderBound).toHaveBeenCalledWith(9001, 7, 81)
    expect(completedOrdersEnd).toHaveBeenCalledOnce()
  })
})
