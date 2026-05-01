/**
 * Low-level IB message framing — encode/decode with length prefix.
 * Mirrors: ibapi/comm.py
 */

import Decimal from 'decimal.js'
import { UNSET_INTEGER, UNSET_DOUBLE, UNSET_DECIMAL, DOUBLE_INFINITY, INFINITY_STR } from '@traderalice/ibkr-types'
import { ClientException, isAsciiPrintable } from './utils.js'
import { INVALID_SYMBOL } from '@traderalice/ibkr-types'

/**
 * Wrap protobuf data with 4-byte big-endian length prefix and msgId.
 * Wire format: [4-byte total length][4-byte msgId BE][protobuf bytes]
 */
export function makeMsgProto(msgId: number, protobufData: Buffer): Buffer {
  const msgIdBuf = Buffer.alloc(4)
  msgIdBuf.writeUInt32BE(msgId)
  const payload = Buffer.concat([msgIdBuf, protobufData])
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  return Buffer.concat([header, payload])
}

/**
 * Wrap text message with 4-byte length prefix.
 * If useRawIntMsgId, msgId is sent as 4-byte BE int before text.
 * Otherwise msgId is sent as a NULL-terminated text field.
 */
export function makeMsg(msgId: number, useRawIntMsgId: boolean, text: string): Buffer {
  let payload: Buffer
  if (useRawIntMsgId) {
    const msgIdBuf = Buffer.alloc(4)
    msgIdBuf.writeUInt32BE(msgId)
    payload = Buffer.concat([msgIdBuf, Buffer.from(text, 'utf-8')])
  } else {
    payload = Buffer.from(makeField(msgId) + text, 'utf-8')
  }
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  return Buffer.concat([header, payload])
}

/**
 * Wrap initial handshake text with length prefix.
 */
export function makeInitialMsg(text: string): Buffer {
  const payload = Buffer.from(text, 'utf-8')
  const header = Buffer.alloc(4)
  header.writeUInt32BE(payload.length)
  return Buffer.concat([header, payload])
}

/**
 * Encode a value as a NULL-terminated string field.
 */
export function makeField(val: unknown): string {
  if (val === null || val === undefined) {
    throw new Error('Cannot send None to TWS')
  }

  // Decimal: use toFixed() to avoid scientific notation on small values
  // (Decimal.toString() uses '1e-8' by default; TWS wire expects '0.00000001').
  if (val instanceof Decimal) {
    return val.toFixed() + '\0'
  }

  // Validate printable ASCII for strings
  if (typeof val === 'string' && val.length > 0 && !isAsciiPrintable(val)) {
    throw new ClientException(
      INVALID_SYMBOL.code(),
      INVALID_SYMBOL.msg(),
      val,
    )
  }

  // bool → int
  if (typeof val === 'boolean') {
    return (val ? 1 : 0) + '\0'
  }

  return String(val) + '\0'
}

/**
 * Like makeField but handles UNSET/INFINITY sentinel values.
 */
export function makeFieldHandleEmpty(val: unknown): string {
  if (val === null || val === undefined) {
    throw new Error('Cannot send None to TWS')
  }

  if (val instanceof Decimal) {
    if (val.equals(UNSET_DECIMAL)) return makeField('')
    return makeField(val)
  }

  if (val === UNSET_INTEGER || val === UNSET_DOUBLE) {
    return makeField('')
  }

  if (val === DOUBLE_INFINITY) {
    return makeField(INFINITY_STR)
  }

  return makeField(val)
}

/**
 * Read a length-prefixed message from a buffer.
 * Returns [size, msg, remainingBuf].
 * If incomplete, msg is empty Buffer.
 */
export function readMsg(buf: Buffer): [number, Buffer, Buffer] {
  if (buf.length < 4) {
    return [0, Buffer.alloc(0), buf]
  }
  const size = buf.readUInt32BE(0)
  if (buf.length - 4 >= size) {
    const msg = buf.subarray(4, 4 + size)
    const rest = buf.subarray(4 + size)
    return [size, msg, rest]
  }
  return [size, Buffer.alloc(0), buf]
}

/**
 * Split a message payload into NULL-separated fields.
 */
export function readFields(buf: Buffer): string[] {
  const parts = buf.toString('utf-8').split('\0')
  // Last element is empty (trailing NULL)
  return parts.slice(0, -1)
}
