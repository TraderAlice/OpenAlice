import { createServer, type AddressInfo, type Server } from 'node:net'

import { afterEach, describe, expect, it } from 'vitest'

import { probeFreePort } from './probe-port.js'

let held: Server[] = []

function listen(port: number = 0, host?: string): Promise<Server> {
  return new Promise((res, rej) => {
    const srv = createServer()
    srv.once('error', rej)
    srv.once('listening', () => {
      res(srv)
    })
    if (host === undefined) srv.listen(port) // node default — wildcard, dual-stack
    else srv.listen(port, host)
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

async function reserveConsecutivePorts(
  count: number,
  firstHost?: string,
): Promise<{ start: number; servers: Server[] }> {
  for (let attempt = 0; attempt < 50; attempt++) {
    const servers: Server[] = []
    try {
      const first = await listen(0, firstHost)
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

afterEach(async () => {
  await Promise.all(held.map(close))
  held = []
})

describe('probeFreePort', () => {
  it('returns the start port when it is genuinely free', async () => {
    const { start, servers } = await reserveConsecutivePorts(1)
    await close(servers[0]!)
    expect(await probeFreePort(start, start)).toBe(start)
  })

  it('skips a port held on the loopback address', async () => {
    const { start, servers } = await reserveConsecutivePorts(2, '127.0.0.1')
    held.push(servers[0]!)
    await close(servers[1]!)
    expect(await probeFreePort(start, start + 1)).toBe(start + 1)
  })

  it('skips a port held by a default (wildcard) listener — the MCP-shaped regression', async () => {
    // This is how `serve({ port })` with no hostname listens. On macOS/BSD a
    // 127.0.0.1-only probe reports this port as free (SO_REUSEADDR lets the
    // specific bind coexist), which handed instance B a port instance A was
    // actively serving on.
    const { start, servers } = await reserveConsecutivePorts(2)
    held.push(servers[0]!)
    await close(servers[1]!)
    expect(await probeFreePort(start, start + 1)).toBe(start + 1)
  })

  it('skips a port held on the v4 wildcard 0.0.0.0', async () => {
    const { start, servers } = await reserveConsecutivePorts(2, '0.0.0.0')
    held.push(servers[0]!)
    await close(servers[1]!)
    expect(await probeFreePort(start, start + 1)).toBe(start + 1)
  })

  it('fails loud when the whole window is held', async () => {
    const { start, servers } = await reserveConsecutivePorts(2, '127.0.0.1')
    held.push(...servers)
    await expect(probeFreePort(start, start + 1)).rejects.toThrow(/no free port/)
  })
})
