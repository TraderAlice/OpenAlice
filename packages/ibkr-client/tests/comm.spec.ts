/**
 * Mirrors: tests/test_comm.py
 * Tests low-level message framing — encode/decode round-trips.
 */

import { describe, it, expect } from 'vitest'
import { makeInitialMsg, makeField, makeFieldHandleEmpty, makeMsg, makeMsgProto, readMsg, readFields } from '../src/comm.js'
import { UNSET_DOUBLE, UNSET_INTEGER, DOUBLE_INFINITY } from '@traderalice/ibkr-types'

describe('comm', () => {

  // --- Ported from Python test_comm.py ---

  it('test_make_msg: initial msg has correct size prefix and payload', () => {
    const text = 'ABCD'
    const msg = makeInitialMsg(text)

    // First 4 bytes are big-endian size
    const size = msg.readUInt32BE(0)
    expect(size).toBe(text.length)

    // Rest is the payload
    expect(msg.subarray(4).toString()).toBe(text)
  })

  it('test_make_field: field is NULL-terminated', () => {
    const text = 'ABCD'
    const field = makeField(text)

    expect(field[field.length - 1]).toBe('\0')
    expect(field.slice(0, -1)).toBe(text)
    expect(field.slice(0, -1).length).toBe(text.length)
  })

  it('test_read_msg: round-trip encode → decode', () => {
    const text = 'ABCD'
    const msg = makeInitialMsg(text)

    const [size, payload, rest] = readMsg(msg)

    expect(size).toBe(text.length)
    expect(payload.toString()).toBe(text)
    expect(rest.length).toBe(0)
  })

  it('test_readFields: multiple fields round-trip', () => {
    const text1 = 'ABCD'
    const text2 = '123'

    const msg = makeInitialMsg(makeField(text1) + makeField(text2))
    const [_size, payload, _rest] = readMsg(msg)
    const fields = readFields(payload)

    expect(fields.length).toBe(2)
    expect(fields[0]).toBe(text1)
    expect(fields[1]).toBe(text2)
  })

  // --- Additional tests beyond Python's coverage ---

  it('makeField: bool is encoded as int', () => {
    expect(makeField(true)).toBe('1\0')
    expect(makeField(false)).toBe('0\0')
  })

  it('makeField: number is encoded as string', () => {
    expect(makeField(42)).toBe('42\0')
    expect(makeField(3.14)).toBe('3.14\0')
  })

  it('makeField: null throws', () => {
    expect(() => makeField(null)).toThrow('Cannot send None to TWS')
  })

  it('makeFieldHandleEmpty: UNSET values become empty', () => {
    expect(makeFieldHandleEmpty(UNSET_INTEGER)).toBe('\0')
    expect(makeFieldHandleEmpty(UNSET_DOUBLE)).toBe('\0')
  })

  it('makeFieldHandleEmpty: INFINITY becomes "Infinity"', () => {
    expect(makeFieldHandleEmpty(DOUBLE_INFINITY)).toBe('Infinity\0')
  })

  it('readMsg: incomplete message returns empty payload', () => {
    // Only 2 bytes — not even a size prefix
    const buf = Buffer.from([0x00, 0x01])
    const [size, msg, rest] = readMsg(buf)
    expect(size).toBe(0)
    expect(msg.length).toBe(0)
    expect(rest).toBe(buf)
  })

  it('readMsg: size prefix present but payload incomplete', () => {
    // Size says 10 bytes but only 3 available
    const buf = Buffer.alloc(7)
    buf.writeUInt32BE(10, 0)
    buf[4] = 0x41; buf[5] = 0x42; buf[6] = 0x43
    const [size, msg, rest] = readMsg(buf)
    expect(size).toBe(10)
    expect(msg.length).toBe(0) // incomplete
    expect(rest).toBe(buf)
  })

  it('makeMsg: text protocol (legacy, no raw int msgId)', () => {
    const msg = makeMsg(1, false, makeField('hello'))
    const [size, payload, rest] = readMsg(msg)
    expect(size).toBeGreaterThan(0)
    expect(rest.length).toBe(0)
    // Payload starts with msgId as text field: "1\0"
    const fields = readFields(payload)
    expect(fields[0]).toBe('1')
    expect(fields[1]).toBe('hello')
  })

  it('makeMsg: binary protocol (v201+, raw int msgId)', () => {
    const msg = makeMsg(1, true, makeField('hello'))
    const [size, payload, rest] = readMsg(msg)
    expect(size).toBeGreaterThan(0)
    expect(rest.length).toBe(0)
    // Payload starts with 4-byte binary msgId
    const msgId = payload.readUInt32BE(0)
    expect(msgId).toBe(1)
    const textPart = payload.subarray(4)
    const fields = readFields(textPart)
    expect(fields[0]).toBe('hello')
  })

  it('makeMsgProto: wraps protobuf data with msgId + length', () => {
    const protoData = Buffer.from([0x08, 0x01]) // fake protobuf
    const msg = makeMsgProto(49, protoData)
    const [size, payload, rest] = readMsg(msg)
    expect(size).toBe(4 + 2) // 4 bytes msgId + 2 bytes proto
    expect(rest.length).toBe(0)
    const msgId = payload.readUInt32BE(0)
    expect(msgId).toBe(49)
    expect(payload.subarray(4)).toEqual(protoData)
  })
})
