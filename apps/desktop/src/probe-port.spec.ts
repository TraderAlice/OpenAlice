import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer, Server, type AddressInfo } from 'node:net'
import { probeFreePort } from './probe-port.js'

async function listen(port: number = 0): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.once('listening', () => resolve(srv))
    srv.listen(port)
  })
}

function boundPort(server: Server): number {
  return (server.address() as AddressInfo).port
}

function close(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

async function reserveConsecutivePorts(count: number): Promise<{ start: number; servers: Server[] }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const servers: Server[] = []
    try {
      const first = await listen()
      servers.push(first)
      const start = boundPort(first)
      if (start + count - 1 > 65_535) throw new Error('dynamic range crosses port limit')
      for (let offset = 1; offset < count; offset++) {
        servers.push(await listen(start + offset))
      }
      return { start, servers }
    } catch {
      await Promise.all(servers.map(close))
    }
  }
  throw new Error(`could not reserve ${count} consecutive dynamic ports`)
}

describe('probeFreePort', () => {
  const held: Server[] = []

  afterEach(async () => {
    await Promise.all(held.splice(0).map(close))
  })

  it('returns a dynamically allocated starting port when it is free', async () => {
    const { start, servers } = await reserveConsecutivePorts(1)
    await close(servers[0]!)
    expect(await probeFreePort(start, start)).toBe(start)
  })

  it('falls back to a later free port when the starting port is taken', async () => {
    const { start, servers } = await reserveConsecutivePorts(2)
    held.push(servers[0]!)
    await close(servers[1]!)
    const port = await probeFreePort(start, Math.min(start + 100, 65_535))
    expect(port).toBeGreaterThan(start)
  })

  it('skips consecutive occupied ports', async () => {
    const { start, servers } = await reserveConsecutivePorts(4)
    held.push(...servers.slice(0, 3))
    await close(servers[3]!)
    const port = await probeFreePort(start, Math.min(start + 100, 65_535))
    expect(port).toBeGreaterThanOrEqual(start + 3)
  })

  it('waits for a probe server to finish closing before resolving', async () => {
    const { start, servers } = await reserveConsecutivePorts(1)
    await close(servers[0]!)

    const originalClose = Server.prototype.close
    let pendingServer: Server | undefined
    let pendingCallback: ((error?: Error) => void) | undefined
    let releaseObserved!: () => void
    const closeObserved = new Promise<void>((resolve) => {
      releaseObserved = resolve
    })
    const closeSpy = vi.spyOn(Server.prototype, 'close').mockImplementationOnce(function (
      this: Server,
      callback?: (error?: Error) => void,
    ) {
      pendingServer = this
      pendingCallback = callback
      releaseObserved()
      return this
    })

    let resolved = false
    let released = false
    try {
      const probe = probeFreePort(start, start).then((port) => {
        resolved = true
        return port
      })
      void probe.catch(() => {}) // Keep a failing regression from becoming an unhandled rejection.
      await closeObserved
      expect(pendingCallback).toBeTypeOf('function')
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(resolved).toBe(false)
      expect(pendingServer).toBeDefined()

      closeSpy.mockRestore()
      await new Promise<void>((resolve, reject) => {
        originalClose.call(pendingServer!, (error) => {
          if (error) {
            reject(error)
            return
          }
          pendingCallback?.()
          resolve()
        })
      })
      released = true
      expect(await probe).toBe(start)
    } finally {
      if (!released) {
        closeSpy.mockRestore()
        if (pendingServer) {
          await new Promise<void>((resolve) => {
            originalClose.call(pendingServer!, () => resolve())
          })
        }
      }
    }
  })

  it('throws when no port in range is available', async () => {
    const { start, servers } = await reserveConsecutivePorts(3)
    held.push(...servers)
    await expect(probeFreePort(start, start + 2)).rejects.toThrow(/no free port/)
  })
})
