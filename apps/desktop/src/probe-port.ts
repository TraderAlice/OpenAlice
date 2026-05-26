import { createServer } from 'node:net'

/**
 * Try sequential ports starting from `start`, returning the first one
 * that can be bound. The window is intentionally bounded — we want to
 * fail loud rather than scan to 65535 if something is very wrong (e.g.
 * the entire upper range is locked down).
 *
 * Guardian uses this at boot to pick the backend's web + MCP ports.
 * Default starting point lives in `main.ts`; this helper is unaware of
 * the "47331" default and is reusable for any port range.
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
