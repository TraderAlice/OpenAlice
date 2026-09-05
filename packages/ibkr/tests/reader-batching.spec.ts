import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { EClient } from '../src/client/base.js'
import { makeField, makeMsg } from '../src/comm.js'
import { Decoder, applyAllHandlers } from '../src/decoder/index.js'
import { EReader, MAX_MESSAGES_PER_TURN } from '../src/reader.js'
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

function currentTimeFrame(value: number): Buffer {
  return makeMsg(IN.CURRENT_TIME, true, makeField(1) + makeField(value))
}

describe('EReader dispatch batching', () => {
  it('yields to timers between batches while preserving message order', async () => {
    const connection = new FakeConnection()
    const trace: string[] = []
    const reader = new EReader(connection as never, (msg) => {
      trace.push(`msg:${msg.readUInt32BE(0)}`)
    })
    reader.start()

    const burst = MAX_MESSAGES_PER_TURN * 2 + 5
    const frames: Buffer[] = []
    for (let i = 0; i < burst; i++) {
      const payload = Buffer.alloc(4)
      payload.writeUInt32BE(i)
      const header = Buffer.alloc(4)
      header.writeUInt32BE(payload.length)
      frames.push(Buffer.concat([header, payload]))
    }

    const timerFired = new Promise<void>((resolve) => {
      setTimeout(() => {
        trace.push('timer')
        resolve()
      }, 0)
    })

    connection.push(Buffer.concat(frames))

    // The synchronous push must not have drained the whole burst.
    expect(trace).toHaveLength(MAX_MESSAGES_PER_TURN)

    await timerFired
    await new Promise((resolve) => setTimeout(resolve, 10))

    const messages = trace.filter(entry => entry !== 'timer')
    expect(messages).toHaveLength(burst)
    expect(messages).toEqual(
      Array.from({ length: burst }, (_, i) => `msg:${i}`),
    )
    // A timer got a turn before the last message was dispatched.
    expect(trace.indexOf('timer')).toBeLessThan(trace.length - 1)
  })
})

function connectedClient(wrapper: DefaultEWrapper): {
    client: EClient
    connection: FakeConnection
    reader: EReader
  } {
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
      (error) => privateClient.handleReaderError(error),
    )
  client.reader = reader
  reader.start()
  return { client, connection, reader }
}

describe('EReader failure classification', () => {
  it('keeps the connection when a decoder callback throws and still decodes the successor', () => {
    const wrapper = new DefaultEWrapper()
    const error = vi.spyOn(wrapper, 'error')
    const connectionClosed = vi.spyOn(wrapper, 'connectionClosed')
    const currentTime = vi.spyOn(wrapper, 'currentTime')
      .mockImplementationOnce(() => { throw new TypeError('consumer handler defect') })
    const { client, connection } = connectedClient(wrapper)

    expect(() => connection.push(Buffer.concat([
      currentTimeFrame(1784289600),
      currentTimeFrame(1784289601),
    ]))).not.toThrow()

    expect(currentTime).toHaveBeenCalledTimes(2)
    expect(connectionClosed).not.toHaveBeenCalled()
    expect(client.connState).toBe(EClient.CONNECTED)
    expect(error).toHaveBeenCalledOnce()
    expect(error.mock.calls[0][3]).toContain('Handler failure for text msgId=49')
    expect(error.mock.calls[0][3]).not.toContain('consumer handler defect')
  })

  it('still tears the connection down on a framing failure', () => {
    const wrapper = new DefaultEWrapper()
    const connectionClosed = vi.spyOn(wrapper, 'connectionClosed')
    const currentTime = vi.spyOn(wrapper, 'currentTime')
    const { client, connection } = connectedClient(wrapper)

    const malformedAccount = makeMsg(
      IN.ACCT_VALUE,
      true,
      makeField(2) + makeField('CashBalance') + makeField('DU_TEST'),
    )

    expect(() => connection.push(Buffer.concat([
      malformedAccount,
      currentTimeFrame(1784289600),
    ]))).not.toThrow()

    expect(currentTime).not.toHaveBeenCalled()
    expect(connectionClosed).toHaveBeenCalledOnce()
    expect(client.connState).toBe(EClient.DISCONNECTED)
  })
})

describe('EReader teardown', () => {
  it('drops queued frames and detaches on stop, so a later session never sees them', async () => {
    const connection = new FakeConnection()
    const seen: number[] = []
    const reader = new EReader(connection as never, (msg) => {
      seen.push(msg.readUInt32BE(0))
    })
    reader.start()

    const burst = MAX_MESSAGES_PER_TURN * 2
    const frames: Buffer[] = []
    for (let i = 0; i < burst; i++) {
      const payload = Buffer.alloc(4)
      payload.writeUInt32BE(i)
      const header = Buffer.alloc(4)
      header.writeUInt32BE(payload.length)
      frames.push(Buffer.concat([header, payload]))
    }
    connection.push(Buffer.concat(frames))
    expect(seen).toHaveLength(MAX_MESSAGES_PER_TURN)

    // Teardown lands between drain batches.
    reader.stop()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(seen).toHaveLength(MAX_MESSAGES_PER_TURN)

    // The socket listener is gone too: nothing from the dead session leaks.
    connection.push(frames[0]!)
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(seen).toHaveLength(MAX_MESSAGES_PER_TURN)
    expect(connection.listenerCount('data')).toBe(0)
  })

  it('stops the reader when the client resets, so a reconnect cannot decode stale frames', async () => {
    const wrapper = new DefaultEWrapper()
    const currentTime = vi.spyOn(wrapper, 'currentTime')
    const { client, connection } = connectedClient(wrapper)

    const burst: Buffer[] = []
    for (let i = 0; i < MAX_MESSAGES_PER_TURN + 5; i++) burst.push(currentTimeFrame(1_784_289_600 + i))
    connection.push(Buffer.concat(burst))
    expect(currentTime).toHaveBeenCalledTimes(MAX_MESSAGES_PER_TURN)

    // Teardown lands between drain batches, with 5 frames still queued.
    client.disconnect()

    // A new session installs a fresh decoder before the old reader's next
    // macrotask, and the 5 queued frames belong to a dead socket.
    client.serverVersion_ = 206
    client.decoder = new Decoder(wrapper, 206)
    applyAllHandlers(client.decoder)
    client.setConnState(EClient.CONNECTED)

    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(currentTime).toHaveBeenCalledTimes(MAX_MESSAGES_PER_TURN)
  })
})
