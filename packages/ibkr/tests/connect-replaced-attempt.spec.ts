import { createServer, type Socket } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { EClient } from '../src/client/base.js'
import { DefaultEWrapper } from '../src/wrapper.js'

describe('EClient.connect — replaced attempt', () => {
  const cleanups: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
  })

  async function listen(): Promise<{ port: number; sockets: Set<Socket>; accepted: () => number }> {
    const sockets = new Set<Socket>()
    let accepted = 0
    const server = createServer((socket) => {
      accepted++
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      // Accept the socket but never answer the greeting.
      socket.resume()
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolve)
    })
    cleanups.push(async () => {
      for (const socket of sockets) socket.destroy()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('test server has no TCP port')
    return { port: address.port, sockets, accepted: () => accepted }
  }

  it('closes only its own socket when the client is reset while the socket opens', async () => {
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => { unhandled.push(reason) }
    process.on('unhandledRejection', onUnhandled)
    cleanups.push(() => { process.off('unhandledRejection', onUnhandled) })

    const { port, sockets, accepted } = await listen()
    const wrapper = new DefaultEWrapper()
    const error = vi.spyOn(wrapper, 'error')
    const connectionClosed = vi.spyOn(wrapper, 'connectionClosed')
    const client = new EClient(wrapper)

    const attempt = client.connect('127.0.0.1', port, 7)
    // Stands in for a newer attempt or teardown taking over the shared client
    // while this attempt still waits for its TCP connect.
    client.reset()

    await expect(attempt).resolves.toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(unhandled).toEqual([])
    // The replaced attempt reports nothing through the wrapper it no longer owns.
    expect(error).not.toHaveBeenCalled()
    expect(connectionClosed).not.toHaveBeenCalled()
    expect(client.conn).toBeNull()
    // The server did see the socket, and the replaced attempt closed it.
    await vi.waitFor(() => expect(accepted()).toBe(1), { timeout: 1_000 })
    await vi.waitFor(() => expect(sockets.size).toBe(0), { timeout: 1_000 })
  }, 3_000)
})
