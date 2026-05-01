/**
 * Decoder base — class skeleton, dispatch tables, interpret/processProtoBuf.
 *
 * Actual handler methods are registered by sibling modules (market-data, orders, etc.)
 * via the register* helpers exported here.
 */

import type { EWrapper } from '@traderalice/ibkr-types'
import { NO_VALID_ID } from '@traderalice/ibkr-types'
import { BadMessage, currentTimeMillis } from '../utils.js'
import { BAD_MESSAGE, UNKNOWN_ID } from '@traderalice/ibkr-types'

export type TextHandler = (decoder: Decoder, fields: Iterator<string>) => void
export type ProtoHandler = (decoder: Decoder, buf: Buffer) => void

export class Decoder {
  wrapper: EWrapper
  serverVersion: number

  private readonly msgId2textHandler = new Map<number, TextHandler>()
  private readonly msgId2protoHandler = new Map<number, ProtoHandler>()

  constructor(wrapper: EWrapper, serverVersion: number) {
    this.wrapper = wrapper
    this.serverVersion = serverVersion
  }

  /** Register a text-protocol handler for a given IN message id. */
  registerText(msgId: number, handler: TextHandler): void {
    this.msgId2textHandler.set(msgId, handler)
  }

  /** Register a protobuf handler for a given IN message id. */
  registerProto(msgId: number, handler: ProtoHandler): void {
    this.msgId2protoHandler.set(msgId, handler)
  }

  /**
   * Dispatch a text-protocol message.
   * Mirrors: ibapi/decoder.py interpret()
   */
  interpret(fields: string[], msgId?: number): void {
    if (msgId === undefined) {
      msgId = parseInt(fields[0] || '0', 10)
    }
    if (msgId === 0) return

    const handler = this.msgId2textHandler.get(msgId)
    if (!handler) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), UNKNOWN_ID.code(), UNKNOWN_ID.msg(), '')
      return
    }

    try {
      handler(this, fields[Symbol.iterator]())
    } catch (e) {
      if (e instanceof BadMessage) {
        this.wrapper.error(
          NO_VALID_ID, currentTimeMillis(),
          BAD_MESSAGE.code(), BAD_MESSAGE.msg() + fields.join(','), '',
        )
      }
      throw e
    }
  }

  /**
   * Dispatch a protobuf-encoded message.
   * Mirrors: ibapi/decoder.py processProtoBuf()
   */
  processProtoBuf(protoBuf: Buffer, msgId: number): void {
    if (msgId === 0) return

    const handler = this.msgId2protoHandler.get(msgId)
    if (!handler) {
      console.log(`[ibkr] unhandled protobuf message: msgId=${msgId}, len=${protoBuf.length}`)
      return
    }

    try {
      handler(this, protoBuf)
    } catch (e) {
      if (e instanceof BadMessage) {
        this.wrapper.error(
          NO_VALID_ID, currentTimeMillis(),
          BAD_MESSAGE.code(), BAD_MESSAGE.msg() + `protobuf msgId=${msgId}`, '',
        )
      }
      throw e
    }
  }
}
