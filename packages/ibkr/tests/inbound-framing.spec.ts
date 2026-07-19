import { describe, expect, it } from 'vitest'
import { decodeInboundFrame } from '../src/client/base.js'
import { readFields } from '../src/comm.js'
import { IN } from '../src/message.js'
import { BadMessage } from '../src/utils.js'

const textPayload = Buffer.from(['2', 'CashBalance', '1000000.00', 'USD', 'DU_TEST', ''].join('\0'))

describe('decodeInboundFrame', () => {
  it('removes the legacy text msgId before exposing payload fields', () => {
    const frame = decodeInboundFrame(
      200,
      Buffer.concat([Buffer.from(`${IN.ACCT_VALUE}\0`), textPayload]),
    )

    expect(frame).toMatchObject({ kind: 'text', msgId: IN.ACCT_VALUE })
    expect(readFields(frame.payload)).toEqual([
      '2',
      'CashBalance',
      '1000000.00',
      'USD',
      'DU_TEST',
    ])
  })

  it('removes the v201+ binary msgId before exposing the same payload fields', () => {
    const msgId = Buffer.alloc(4)
    msgId.writeUInt32BE(IN.ACCT_VALUE)

    const frame = decodeInboundFrame(206, Buffer.concat([msgId, textPayload]))

    expect(frame).toMatchObject({ kind: 'text', msgId: IN.ACCT_VALUE })
    expect(readFields(frame.payload)).toEqual([
      '2',
      'CashBalance',
      '1000000.00',
      'USD',
      'DU_TEST',
    ])
  })

  it('classifies a v201+ protobuf envelope without touching its payload', () => {
    const wireMsgId = Buffer.alloc(4)
    wireMsgId.writeUInt32BE(IN.MANAGED_ACCTS + 200)
    const protobufPayload = Buffer.from([0x0a, 0x07, 0x44, 0x55, 0x5f, 0x54, 0x45, 0x53, 0x54])

    const frame = decodeInboundFrame(222, Buffer.concat([wireMsgId, protobufPayload]))

    expect(frame).toEqual({
      kind: 'protobuf',
      msgId: IN.MANAGED_ACCTS,
      payload: protobufPayload,
    })
  })

  it('rejects incomplete or invalid envelopes instead of continuing', () => {
    expect(() => decodeInboundFrame(206, Buffer.alloc(3))).toThrow(BadMessage)
    expect(() => decodeInboundFrame(200, Buffer.from(`${IN.ACCT_VALUE}`))).toThrow(BadMessage)
    expect(() => decodeInboundFrame(200, Buffer.from('not-a-number\0payload\0'))).toThrow(BadMessage)
  })
})
