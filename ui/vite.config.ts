import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * Resolve the backend port Vite should proxy /api/* to. Two source paths:
 *
 *   1. `OPENALICE_BACKEND_PORT` env — set by `scripts/guardian/dev.ts` orchestrator
 *      when invoked via `pnpm dev`. Guaranteed to match the port the
 *      backend was spawned on; drift-free.
 *
 *   2. `data/config/connectors.json` web.port — used when Vite is run
 *      standalone (`pnpm dev:ui`), without orchestrator. Stale only if
 *      the user manually started backend on a different port than
 *      configured, in which case the standalone workflow is on them.
 *
 * Default 3002 if both sources unusable, with a clear warning.
 */
function readBackendPort(): number {
  // Env wins — set by the dev orchestrator. No drift with backend.
  const envPort = Number.parseInt(process.env['OPENALICE_BACKEND_PORT'] ?? '', 10)
  if (Number.isFinite(envPort) && envPort > 0 && envPort <= 65535) return envPort

  // Fallback: read the same file backend reads.
  const configPath = resolve(__dirname, '..', 'data', 'config', 'connectors.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    const parsed = JSON.parse(raw) as { web?: { port?: number } }
    const port = parsed.web?.port
    if (typeof port === 'number' && port > 0 && port <= 65535) return port
    console.warn(`[vite] ${configPath}: web.port missing or invalid, falling back to 3002`)
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`[vite] could not read ${configPath} (${msg}), falling back to 3002`)
  }
  return 3002
}

const backendPort = readBackendPort()

/**
 * Resolve the dev-server port. Two modes:
 *
 *   1. `OPENALICE_UI_PORT` env — set by `scripts/guardian/dev.ts`, which
 *      already probed the port for availability. Bind exactly it
 *      (strictPort): if Vite silently drifted off the value Guardian
 *      printed and injected into the backend's WS-origin allowlist, the
 *      banner URL would lie and the workspace terminal would break.
 *   2. standalone (`pnpm --filter open-alice-ui dev`, no orchestrator) —
 *      Vite's classic 5173 + auto-increment behavior, unchanged.
 */
function readUiPort(): { port: number; strictPort: boolean } {
  const envPort = Number.parseInt(process.env['OPENALICE_UI_PORT'] ?? '', 10)
  if (Number.isFinite(envPort) && envPort > 0 && envPort <= 65535) {
    return { port: envPort, strictPort: true }
  }
  return { port: 5173, strictPort: false }
}

const { port: uiPort, strictPort } = readUiPort()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Inject the backend port as a compile-time constant so the dev client can
  // open the PTY WebSocket *directly* against the backend, bypassing the Vite
  // dev proxy. node-http-proxy's WS upgrade forwarding chokes under the
  // terminal's high-throughput byte stream (read ECONNRESET), and adds a
  // buffer+copy hop per frame. API traffic still goes through the proxy (low
  // frequency, convenient). Dev-only: in production the UI is same-origin with
  // the backend, so `location.host` is already correct and this is unused.
  // `0` sentinel means "no override" — the client falls back to location.host.
  define: {
    __OPENALICE_DEV_BACKEND_PORT__: JSON.stringify(backendPort),
  },
  // Dev server with API proxy to the backend.
  // Backend port is read from `data/config/connectors.json` (web.port) so
  // changing the backend port in one place propagates to Vite automatically.
  server: {
    port: uiPort,
    strictPort,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        // WS upgrade forwarding — required for /api/workspaces/pty.
        ws: true,
      },
    },
  },
  build: {
    // Output lives inside the package (was '../dist/ui' — a leftover from
    // when the UI was bolted on as an afterthought to a Telegram-only
    // engine; cf. memory: linear-vscode-hybrid). Keeping the output inside
    // ui/ lets turbo's default `outputs: ['dist/**']` track it correctly
    // and eliminates the "rm -rf dist → dist/ui never rebuilds" footgun.
    outDir: 'dist',
    emptyOutDir: true,
    // ES2022 unlocks top-level await — used in main.tsx for the demo-mode
    // dynamic import. All evergreen browsers (Chrome 89+, Safari 15+,
    // Firefox 89+) support it; we have no legacy IE/old-Edge constraint.
    target: 'es2022',
  },
})
