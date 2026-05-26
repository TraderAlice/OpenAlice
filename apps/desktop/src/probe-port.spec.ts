import { describe, it, expect, afterEach } from 'vitest'
import { createServer, type Server } from 'node:net'
import { probeFreePort } from './probe-port.js'

async function holdPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.once('error', reject)
    srv.once('listening', () => resolve(srv))
    srv.listen(port, '127.0.0.1')
  })
}

describe('probeFreePort', () => {
  const held: Server[] = []

  afterEach(async () => {
    await Promise.all(held.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))))
  })

  it('returns the starting port when it is free', async () => {
    // Use a high random port unlikely to collide on CI / dev machines.
    const port = await probeFreePort(48732, 48732 + 10)
    expect(port).toBe(48732)
  })

  it('falls back to the next port when the starting port is taken', async () => {
    const srv = await holdPort(48800)
    held.push(srv)
    const port = await probeFreePort(48800, 48800 + 10)
    expect(port).toBe(48801)
  })

  it('skips consecutive occupied ports', async () => {
    held.push(await holdPort(48810))
    held.push(await holdPort(48811))
    held.push(await holdPort(48812))
    const port = await probeFreePort(48810, 48810 + 10)
    expect(port).toBe(48813)
  })

  it('throws when no port in range is available', async () => {
    held.push(await holdPort(48820))
    held.push(await holdPort(48821))
    held.push(await holdPort(48822))
    await expect(probeFreePort(48820, 48822)).rejects.toThrow(/no free port/)
  })
})
