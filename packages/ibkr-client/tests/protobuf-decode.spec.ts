/**
 * Tests for protobuf message decoding in the Decoder.
 * These test that protobuf messages from TWS are correctly dispatched
 * to EWrapper callbacks.
 */

import { describe, it, expect, vi } from 'vitest'
import { Decoder, applyAllHandlers } from '../src/decoder'
import { DefaultEWrapper } from '@traderalice/ibkr-types'
import { BinaryWriter } from '@bufbuild/protobuf/wire'
import { CurrentTime } from '../src/protobuf/CurrentTime.js'
import { NextValidId } from '../src/protobuf/NextValidId.js'
import { ErrorMessage } from '../src/protobuf/ErrorMessage.js'
import { ManagedAccounts } from '../src/protobuf/ManagedAccounts.js'
import { IN } from '@traderalice/ibkr-types'

function encodeProto<T>(codec: { encode(msg: T, writer?: BinaryWriter): BinaryWriter }, msg: T): Buffer {
  const bytes = codec.encode(msg).finish()
  return Buffer.from(bytes)
}

describe('Decoder.processProtoBuf', () => {

  it('decodes CurrentTime and calls wrapper.currentTime', () => {
    const wrapper = new DefaultEWrapper()
    const spy = vi.spyOn(wrapper, 'currentTime')
    const decoder = new Decoder(wrapper, 222)
    applyAllHandlers(decoder)

    const buf = encodeProto(CurrentTime, { currentTime: 1710500000 })
    decoder.processProtoBuf(buf, IN.CURRENT_TIME)

    expect(spy).toHaveBeenCalledWith(1710500000)
  })

  it('decodes NextValidId and calls wrapper.nextValidId', () => {
    const wrapper = new DefaultEWrapper()
    const spy = vi.spyOn(wrapper, 'nextValidId')
    const decoder = new Decoder(wrapper, 222)
    applyAllHandlers(decoder)

    const buf = encodeProto(NextValidId, { orderId: 42 })
    decoder.processProtoBuf(buf, IN.NEXT_VALID_ID)

    expect(spy).toHaveBeenCalledWith(42)
  })

  it('decodes ErrorMessage and calls wrapper.error', () => {
    const wrapper = new DefaultEWrapper()
    const spy = vi.spyOn(wrapper, 'error')
    const decoder = new Decoder(wrapper, 222)
    applyAllHandlers(decoder)

    const buf = encodeProto(ErrorMessage, {
      id: -1,
      errorTime: 1710500000,
      errorCode: 2104,
      errorMsg: 'Market data farm connection is OK:usfarm.nj',
      advancedOrderRejectJson: '',
    })
    decoder.processProtoBuf(buf, IN.ERR_MSG)

    expect(spy).toHaveBeenCalledWith(-1, 1710500000, 2104, 'Market data farm connection is OK:usfarm.nj', '')
  })

  it('decodes ManagedAccounts and calls wrapper.managedAccounts', () => {
    const wrapper = new DefaultEWrapper()
    const spy = vi.spyOn(wrapper, 'managedAccounts')
    const decoder = new Decoder(wrapper, 222)
    applyAllHandlers(decoder)

    const buf = encodeProto(ManagedAccounts, { accountsList: 'DU12345' })
    decoder.processProtoBuf(buf, IN.MANAGED_ACCTS)

    expect(spy).toHaveBeenCalledWith('DU12345')
  })

  it('logs unknown protobuf msgId without crashing', () => {
    const wrapper = new DefaultEWrapper()
    const decoder = new Decoder(wrapper, 222)
    applyAllHandlers(decoder)

    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    decoder.processProtoBuf(Buffer.from([]), 999)
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('unhandled protobuf'))
    consoleSpy.mockRestore()
  })
})
