import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EClient } from '../src/client/base.js'
import { makeField, makeMsg } from '../src/comm.js'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { EReader } from '../src/reader.js'
import { IN } from '../src/message.js'
import type { ConnectionWrapper } from '../src/connection.js'
import { DefaultEWrapper } from '../src/wrapper.js'

class FakeConnection extends EventEmitter {
  wrapper: ConnectionWrapper | null = null
  private incoming = Buffer.alloc(0)
  private connected = true

  push(data: Buffer): void {
    this.incoming = Buffer.concat([this.incoming, data])
    this.emit('data')
  }

  consumeBuffer(): Buffer {
    const data = this.incoming
    this.incoming = Buffer.alloc(0)
    return data
  }

  isConnected(): boolean {
    return this.connected
  }

  disconnect(): void {
    if (!this.connected) return
    this.connected = false
    this.wrapper?.connectionClosed()
  }
}

describe('EReader decoder failure recovery', () => {
  it('contains a malformed broker frame to the connection and drops buffered successors', () => {
    const wrapper = new DefaultEWrapper()
    const error = vi.spyOn(wrapper, 'error')
    const connectionClosed = vi.spyOn(wrapper, 'connectionClosed')
    const currentTime = vi.spyOn(wrapper, 'currentTime')
    const client = new EClient(wrapper)
    const connection = new FakeConnection()
    connection.wrapper = wrapper

    client.conn = connection as never
    client.serverVersion_ = 206
    client.decoder = new Decoder(wrapper, 206)
    applyAllHandlers(client.decoder)
    client.setConnState(EClient.CONNECTED)

    const privateClient = client as unknown as {
      onMessage(message: Buffer): void
      handleReaderError(error: unknown): void
    }
    const reader = new EReader(
      connection as never,
      (message) => privateClient.onMessage(message),
      (readerError) => privateClient.handleReaderError(readerError),
    )
    reader.start()

    const malformedAccount = makeMsg(
      IN.ACCT_VALUE,
      true,
      makeField(2) + makeField('CashBalance') + makeField('DU_TEST'),
    )
    const bufferedCurrentTime = makeMsg(
      IN.CURRENT_TIME,
      true,
      makeField(1) + makeField(1784289600),
    )

    expect(() => connection.push(Buffer.concat([
      malformedAccount,
      bufferedCurrentTime,
    ]))).not.toThrow()

    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0][3]).toContain('text msgId=6, fieldCount=3')
    expect(error.mock.calls[0][3]).not.toContain('CashBalance')
    expect(error.mock.calls[0][3]).not.toContain('DU_TEST')
    expect(connectionClosed).toHaveBeenCalledOnce()
    expect(currentTime).not.toHaveBeenCalled()
    expect(client.conn).toBeNull()
    expect(client.connState).toBe(EClient.DISCONNECTED)
  })

  it('contains a truncated envelope without logging its bytes', () => {
    const wrapper = new DefaultEWrapper()
    const error = vi.spyOn(wrapper, 'error')
    const connectionClosed = vi.spyOn(wrapper, 'connectionClosed')
    const currentTime = vi.spyOn(wrapper, 'currentTime')
    const client = new EClient(wrapper)
    const connection = new FakeConnection()
    connection.wrapper = wrapper

    client.conn = connection as never
    client.serverVersion_ = 206
    client.decoder = new Decoder(wrapper, 206)
    applyAllHandlers(client.decoder)
    client.setConnState(EClient.CONNECTED)

    const privateClient = client as unknown as {
      onMessage(message: Buffer): void
      handleReaderError(readerError: unknown): void
    }
    const reader = new EReader(
      connection as never,
      (message) => privateClient.onMessage(message),
      (readerError) => privateClient.handleReaderError(readerError),
    )
    reader.start()

    const truncatedEnvelope = Buffer.alloc(7)
    truncatedEnvelope.writeUInt32BE(3, 0)
    truncatedEnvelope.set([0xde, 0xad, 0xbe], 4)
    const bufferedCurrentTime = makeMsg(
      IN.CURRENT_TIME,
      true,
      makeField(1) + makeField(1784289600),
    )

    expect(() => connection.push(Buffer.concat([
      truncatedEnvelope,
      bufferedCurrentTime,
    ]))).not.toThrow()

    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0][3]).toBe('Bad message envelope')
    expect(error.mock.calls[0][3]).not.toContain('deadbe')
    expect(connectionClosed).toHaveBeenCalledOnce()
    expect(currentTime).not.toHaveBeenCalled()
    expect(client.conn).toBeNull()
    expect(client.connState).toBe(EClient.DISCONNECTED)
  })
})
