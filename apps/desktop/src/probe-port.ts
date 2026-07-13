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

/**
 * A port only counts as free when the IPv4 AND IPv6 wildcard/loopback binds
 * all succeed. One bind is not enough on macOS/BSD or Windows:
 * SO_REUSEADDR (node's default) lets a specific-address bind succeed while
 * a wildcard listener holds the port — and vice versa — so probing only
 * 127.0.0.1 reported ports held by wildcard listeners (e.g. a default
 * `serve({ port })` with no hostname) as free. Empirical matrix (macOS,
 * node 22): holder default/`::`/0.0.0.0/127.0.0.1 × probe 127.0.0.1 OR
 * 0.0.0.0 each miss one mode; the conjunction catches all four.
 */
async function isPortFree(port: number): Promise<boolean> {
  return (await bindable(port, '0.0.0.0'))
    && (await bindable(port, '127.0.0.1'))
    && (await bindable(port, '::'))
    && (await bindable(port, '::1'))
}

function bindable(port: number, host: string): Promise<boolean> {
  return new Promise((res) => {
    const srv = createServer()
    let settled = false
    const done = (free: boolean) => {
      if (settled) return
      settled = true
      try { srv.close() } catch { /* noop */ }
      res(free)
    }
    srv.once('error', (err: NodeJS.ErrnoException) => {
      // A host with IPv6 disabled should still be able to use IPv4 ports.
      // EADDRINUSE remains a real collision; unsupported-family/address
      // errors make this particular probe neutral.
      done(err.code === 'EAFNOSUPPORT' || err.code === 'EADDRNOTAVAIL')
    })
    srv.once('listening', () => done(true))
    srv.listen(port, host)
  })
}
