/**
 * EClient base class — connection management, handshake, sendMsg.
 * Mirrors: ibapi/client.py (lines 286-626)
 *
 * Request methods are added via mixins in sibling files.
 */

import { makeMsg, makeMsgProto, makeField, makeInitialMsg, readMsg, readFields } from '../comm.js'
import { Connection } from '../connection.js'
import { EReader } from '../reader.js'
import { Decoder, applyAllHandlers } from '../decoder/index.js'
import type { EWrapper } from '../wrapper.js'
import { OUT } from '../message.js'
import {
  MIN_CLIENT_VER,
  MAX_CLIENT_VER,
  MIN_SERVER_VER_OPTIONAL_CAPABILITIES,
  MIN_SERVER_VER_PROTOBUF,
} from '../server-versions.js'
import { NO_VALID_ID } from '../const.js'
import { PROTOBUF_MSG_IDS } from '../common.js'
import * as errors from '../errors.js'
import { BadMessage, ClientException, isAsciiPrintable, currentTimeMillis } from '../utils.js'

export type InboundFrame =
  | { kind: 'text'; msgId: number; payload: Buffer }
  | { kind: 'protobuf'; msgId: number; payload: Buffer }

const PROTOBUF_MSG_ID = 200

/**
 * Remove the wire envelope from one complete inbound message.
 *
 * The decoder always receives the message id out-of-band and text fields that
 * begin at the payload's first field (normally a message version or request
 * id). This mirrors ibapi/client.py's run loop for both legacy and v201+
 * framing.
 */
export function decodeInboundFrame(serverVersion: number, msgBuf: Buffer): InboundFrame {
  let wireMsgId: number
  let payload: Buffer

  if (serverVersion >= MIN_SERVER_VER_PROTOBUF) {
    if (msgBuf.length < 4) {
      throw new BadMessage('missing binary message id')
    }
    wireMsgId = msgBuf.readUInt32BE(0)
    payload = msgBuf.subarray(4)
  } else {
    const nullIdx = msgBuf.indexOf(0)
    if (nullIdx < 0) {
      throw new BadMessage('missing text message id delimiter')
    }
    wireMsgId = Number.parseInt(msgBuf.subarray(0, nullIdx).toString('utf-8'), 10)
    if (!Number.isFinite(wireMsgId)) {
      throw new BadMessage('invalid text message id')
    }
    payload = msgBuf.subarray(nullIdx + 1)
  }

  if (wireMsgId > PROTOBUF_MSG_ID) {
    return { kind: 'protobuf', msgId: wireMsgId - PROTOBUF_MSG_ID, payload }
  }
  return { kind: 'text', msgId: wireMsgId, payload }
}

export class EClient {
  static readonly DISCONNECTED = 0
  static readonly CONNECTING = 1
  static readonly CONNECTED = 2

  wrapper: EWrapper
  decoder: Decoder | null = null
  conn: Connection | null = null
  host: string | null = null
  port: number | null = null
  extraAuth = false
  clientId: number | null = null
  serverVersion_: number | null = null
  connTime: string | null = null
  connState: number = EClient.DISCONNECTED
  optCapab: string | null = null
  reader: EReader | null = null
  connectOptions: string | null = null

  constructor(wrapper: EWrapper) {
    this.wrapper = wrapper
  }

  reset(): void {
    this.decoder = null
    this.conn = null
    this.host = null
    this.port = null
    this.extraAuth = false
    this.clientId = null
    this.serverVersion_ = null
    this.connTime = null
    this.optCapab = null
    this.reader = null
    this.setConnState(EClient.DISCONNECTED)
    this.connectOptions = null
  }

  setConnState(connState: number): void {
    this.connState = connState
  }

  sendMsg(msgId: number, msg: string): void {
    const useRawIntMsgId = this.serverVersion() >= MIN_SERVER_VER_PROTOBUF
    const fullMsg = makeMsg(msgId, useRawIntMsgId, msg)
    this.conn!.sendMsg(fullMsg)
  }

  sendMsgProtoBuf(msgId: number, msg: Buffer): void {
    const fullMsg = makeMsgProto(msgId, msg)
    this.conn!.sendMsg(fullMsg)
  }

  checkConnected(): void {
    if (this.isConnected()) {
      throw new ClientException(
        errors.ALREADY_CONNECTED.code(),
        errors.ALREADY_CONNECTED.msg(),
        '',
      )
    }
  }

  useProtoBuf(msgId: number): boolean {
    const unifiedVersion = PROTOBUF_MSG_IDS[msgId]
    return unifiedVersion !== undefined && unifiedVersion <= this.serverVersion()
  }

  serverVersion(): number {
    return this.serverVersion_ ?? 0
  }

  twsConnectionTime(): string | null {
    return this.connTime
  }

  isConnected(): boolean {
    const connConnected = this.conn?.isConnected() ?? false
    return this.connState === EClient.CONNECTED && connConnected
  }

  setConnectOptions(opts: string): void {
    this.connectOptions = opts
  }

  setOptionalCapabilities(optCapab: string): void {
    this.optCapab = optCapab
  }

  // ── Connect / Disconnect ────────────────────────────────────────────

  async connect(host: string, port: number, clientId: number): Promise<void> {
    try {
      this.validateInvalidSymbols(host)
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg + ex.text)
      return
    }

    try {
      this.checkConnected()
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), ex.code, ex.msg)
      return
    }

    try {
      this.host = host
      this.port = port
      this.clientId = clientId

      this.conn = new Connection(this.host, this.port)
      this.conn.wrapper = this.wrapper as any

      await this.conn.connect()
      this.setConnState(EClient.CONNECTING)

      // Send handshake: "API\0" + version range
      const v100prefix = 'API\0'
      let v100version = `v${MIN_CLIENT_VER}..${MAX_CLIENT_VER}`
      if (this.connectOptions) {
        v100version = v100version + ' ' + this.connectOptions
      }

      const msg = makeInitialMsg(v100version)
      const msg2 = Buffer.concat([Buffer.from(v100prefix, 'ascii'), msg])
      this.conn.sendMsg(msg2)

      // Wait for server version response
      const { serverVersion, connTime } = await this.waitForHandshake()
      this.serverVersion_ = serverVersion
      this.connTime = connTime

      this.decoder = new Decoder(this.wrapper, this.serverVersion())
      applyAllHandlers(this.decoder)
      this.setConnState(EClient.CONNECTED)

      // Start reader
      this.reader = new EReader(this.conn, (msgBuf: Buffer) => {
        this.onMessage(msgBuf)
      }, (error: unknown) => {
        this.handleReaderError(error)
      })
      this.reader.start()

      // Send startApi
      this.startApi()
      this.wrapper.connectAck()
    } catch {
      if (this.wrapper) {
        this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.CONNECT_FAIL.code(), errors.CONNECT_FAIL.msg())
      }
      this.disconnect()
    }
  }

  disconnect(): void {
    this.setConnState(EClient.DISCONNECTED)
    if (this.conn !== null) {
      this.conn.disconnect()
      this.wrapper.connectionClosed()
      this.reset()
    }
  }

  // ── StartApi ────────────────────────────────────────────────────────

  startApi(): void {
    if (!this.isConnected()) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.NOT_CONNECTED.code(), errors.NOT_CONNECTED.msg())
      return
    }

    try {
      const VERSION = 2
      let msg = makeField(VERSION) + makeField(this.clientId)
      if (this.serverVersion() >= MIN_SERVER_VER_OPTIONAL_CAPABILITIES) {
        msg += makeField(this.optCapab ?? '')
      }
      this.sendMsg(OUT.START_API, msg)
    } catch (ex: any) {
      this.wrapper.error(NO_VALID_ID, currentTimeMillis(), errors.FAIL_SEND_STARTAPI.code(), errors.FAIL_SEND_STARTAPI.msg() + String(ex))
    }
  }

  // ── Internal helpers ────────────────────────────────────────────────

  /** Check that the connection is live; if not, report error and return false. */
  protected requireConnected(reqId: number = NO_VALID_ID): boolean {
    if (!this.isConnected()) {
      this.wrapper.error(reqId, currentTimeMillis(), errors.NOT_CONNECTED.code(), errors.NOT_CONNECTED.msg())
      return false
    }
    return true
  }

  private validateInvalidSymbols(host: string): void {
    if (host && !isAsciiPrintable(host)) {
      throw new ClientException(errors.INVALID_SYMBOL.code(), errors.INVALID_SYMBOL.msg(), host)
    }
    if (this.connectOptions && !isAsciiPrintable(this.connectOptions)) {
      throw new ClientException(errors.INVALID_SYMBOL.code(), errors.INVALID_SYMBOL.msg(), this.connectOptions)
    }
    if (this.optCapab && !isAsciiPrintable(this.optCapab)) {
      throw new ClientException(errors.INVALID_SYMBOL.code(), errors.INVALID_SYMBOL.msg(), this.optCapab)
    }
  }

  /**
   * Process a single framed message from the reader.
   * Mirrors: ibapi/client.py run() lines 595-611
   *
   * Server v201+: 4-byte big-endian binary msgId prefix.
   * If msgId > PROTOBUF_MSG_ID (200) → protobuf (subtract 200 for real msgId).
   * Otherwise → text with \0-delimited fields.
   *
   * Server < 201: text msgId is first \0-delimited field.
   */
  private onMessage(msgBuf: Buffer): void {
    if (!this.decoder) return

    let frame: InboundFrame
    try {
      frame = decodeInboundFrame(this.serverVersion(), msgBuf)
    } catch (error) {
      if (error instanceof BadMessage) {
        this.wrapper.error(
          NO_VALID_ID,
          currentTimeMillis(),
          errors.BAD_MESSAGE.code(),
          `${errors.BAD_MESSAGE.msg()} envelope`,
          '',
        )
      }
      throw error
    }

    if (frame.kind === 'protobuf') {
      this.decoder.processProtoBuf(frame.payload, frame.msgId)
    } else {
      this.decoder.interpret(frame.msgId, readFields(frame.payload))
    }
  }

  /**
   * Contain an inbound decoder failure to this broker connection.
   *
   * BadMessage is already reported by Decoder with safe framing metadata. Any
   * other exception gets a generic error so arbitrary broker payloads or
   * account fields are never copied into logs.
   */
  private handleReaderError(error: unknown): void {
    if (!(error instanceof BadMessage)) {
      this.wrapper.error(
        NO_VALID_ID,
        currentTimeMillis(),
        errors.BAD_MESSAGE.code(),
        `${errors.BAD_MESSAGE.msg()} reader failure`,
        '',
      )
    }

    const conn = this.conn
    this.reset()
    conn?.disconnect()
  }

  private waitForHandshake(): Promise<{ serverVersion: number; connTime: string }> {
    return new Promise((resolve, reject) => {
      const conn = this.conn
      const socket = conn?.socket
      if (!conn || !socket) {
        reject(new Error('Connection closed before handshake started'))
        return
      }

      let buf: Buffer = Buffer.alloc(0)
      let timer: ReturnType<typeof setTimeout> | undefined

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        conn.removeListener('data', onData)
        socket.removeListener('close', onClose)
      }

      const onClose = () => {
        cleanup()
        reject(new Error('Connection closed during handshake'))
      }

      const onData = () => {
        const incoming = conn.consumeBuffer()
        if (incoming.length === 0) return

        buf = Buffer.concat([buf, incoming])
        const [size, msg, rest] = readMsg(buf)
        if (msg.length > 0) {
          buf = rest
          const fields = readFields(msg)
          if (fields.length >= 2) {
            cleanup()
            resolve({
              serverVersion: parseInt(fields[0], 10),
              connTime: fields[1],
            })
          }
        }
      }

      conn.on('data', onData)
      socket.once('close', onClose)

      // Timeout after 10 seconds
      timer = setTimeout(() => {
        cleanup()
        reject(new Error('Handshake timeout'))
      }, 10000)
    })
  }
}
