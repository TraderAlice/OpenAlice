import { createServer } from 'node:net'

/**
 * Try sequential ports starting from `start`, returning the first one
 * that can be bound. Bounded window — fail loud rather than scanning to
 * 65535 if something is very wrong.
 *
 * Used by `scripts/guardian/` (the dev-mode L2 port authority) to pick the
 * backend's web / MCP / UTA ports before spawning. Intentionally duplicated
 * from `apps/desktop/src/probe-port.ts` — dev script tooling and packaged
 * Electron runtime are different release surfaces, sharing through src/
 * would require breaking the desktop tsconfig rootDir boundary.
 *
 * Keep the two copies in sync if you ever fix a bug here.
 *
 * @throws if no port in `[start, end]` is available.
 */
export async function probeFreePort(start: number, end: number = start + 100): Promise<number> {
  for (let port = start; port <= end; port++) {
    if (await isPortFree(port)) return port
  }
  throw new Error(`probeFreePort: no free port in range ${start}..${end}`)
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer()
    let settled = false
    const done = (free: boolean) => {
      if (settled) return
      settled = true
      try { srv.close() } catch { /* noop */ }
      res(free)
    }
    srv.once('error', () => done(false))
    srv.once('listening', () => done(true))
    srv.listen(port, '127.0.0.1')
  })
}
