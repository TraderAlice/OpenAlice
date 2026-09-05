import { describe, it, expect, vi, afterEach } from 'vitest'
import net from 'node:net'
import { EventEmitter } from 'node:events'
import { Connection } from './connection.js'

/** A net.Socket stand-in that never completes its TCP connect, as a recreated
 *  IB Gateway container looks while its port is not yet reachable. */
function stubPendingSocket(): EventEmitter & { destroy: () => void } {
  const socket = new EventEmitter() as EventEmitter & {
    connect: (port: number, host: string, cb: () => void) => void
    destroy: () => void
    write: () => boolean
  }
  socket.connect = () => { /* stays in SYN_SENT: no 'connect', no 'error' */ }
  socket.destroy = () => { socket.emit('close') }
  socket.write = () => true
  // Callers use `new net.Socket()`, so the implementation must be
  // constructible and an arrow function will not do.
  vi.spyOn(net, 'Socket').mockImplementation(function () { return socket as unknown as net.Socket })
  return socket
}

describe('Connection.connect — terminal settlement', () => {
  afterEach(() => { vi.restoreAllMocks() })

  // destroy() emits 'close' but not 'error', so a promise listening only for
  // 'connect'/'error' never settles.
  it('rejects a still-connecting attempt when disconnect() destroys the socket', async () => {
    stubPendingSocket()
    const conn = new Connection('127.0.0.1', 4002)
    conn.wrapper = { error: () => {}, connectionClosed: () => {} }

    const attempt = conn.connect()
    const settled = vi.fn()
    void attempt.then(settled, settled)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()

    conn.disconnect()
    await expect(attempt).rejects.toThrow()
  })

  it('rejects when the peer closes the socket before the connect callback', async () => {
    const socket = stubPendingSocket()
    const conn = new Connection('127.0.0.1', 4002)
    conn.wrapper = { error: () => {}, connectionClosed: () => {} }

    const attempt = conn.connect()
    socket.emit('close')
    await expect(attempt).rejects.toThrow()
  })

  it('still resolves normally once the socket connects', async () => {
    const socket = stubPendingSocket() as EventEmitter & {
      connect: (port: number, host: string, cb: () => void) => void
    }
    socket.connect = (_port, _host, cb) => { cb() }
    const conn = new Connection('127.0.0.1', 4002)
    conn.wrapper = { error: () => {}, connectionClosed: () => {} }

    await expect(conn.connect()).resolves.toBeUndefined()
  })
})
