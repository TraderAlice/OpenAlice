import { describe, it, expect } from 'vitest'
import { buildDefaultOrigins, loadConfig } from './config.js'

describe('buildDefaultOrigins', () => {
  it('derives backend origin entries from webPort, UI entries default to 5173', () => {
    expect(buildDefaultOrigins(4444)).toEqual([
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:4444',
      'http://127.0.0.1:4444',
    ])
  })

  it('tracks the real Vite port when Guardian probed off 5173', () => {
    // When 5173 was taken, Guardian resolves e.g. 5174 and injects it; the
    // allowlist must follow the actual frontend, not the stale convention —
    // a leftover 5173 entry would admit whatever unrelated app sits there.
    const origins = buildDefaultOrigins(47331, 5174)
    expect(origins).toContain('http://localhost:5174')
    expect(origins).toContain('http://127.0.0.1:5174')
    expect(origins).not.toContain('http://localhost:5173')
  })
})

describe('loadConfig (workspaces)', () => {
  it('uses buildDefaultOrigins(webPort) when WEB_TERMINAL_ALLOWED_ORIGINS unset', () => {
    const cfg = loadConfig({ webPort: 47331, env: {} })
    expect(cfg.allowedOrigins.has('http://localhost:5173')).toBe(true)
    expect(cfg.allowedOrigins.has('http://127.0.0.1:47331')).toBe(true)
    expect(cfg.allowAnyOrigin).toBe(false)
  })

  it('derives the UI origin from OPENALICE_UI_PORT when Guardian injected it', () => {
    const cfg = loadConfig({ webPort: 47331, env: { OPENALICE_UI_PORT: '5174' } })
    expect(cfg.allowedOrigins.has('http://localhost:5174')).toBe(true)
    expect(cfg.allowedOrigins.has('http://localhost:5173')).toBe(false)
  })

  it('respects WEB_TERMINAL_ALLOWED_ORIGINS env override', () => {
    const cfg = loadConfig({
      webPort: 4444,
      env: { WEB_TERMINAL_ALLOWED_ORIGINS: 'https://app.openalice.io,http://localhost:9000' },
    })
    expect(cfg.allowedOrigins.has('https://app.openalice.io')).toBe(true)
    expect(cfg.allowedOrigins.has('http://localhost:9000')).toBe(true)
    // Derived defaults are NOT included when env override is set
    expect(cfg.allowedOrigins.has('http://localhost:4444')).toBe(false)
  })

  it('supports * wildcard in env override', () => {
    const cfg = loadConfig({
      webPort: 4444,
      env: { WEB_TERMINAL_ALLOWED_ORIGINS: '*' },
    })
    expect(cfg.allowAnyOrigin).toBe(true)
  })

  it('keeps workspaces inside an explicitly selected OpenAlice home', () => {
    const cfg = loadConfig({
      webPort: 4444,
      env: { OPENALICE_HOME: '/tmp/openalice-isolated' },
    })
    expect(cfg.launcherRoot).toBe('/tmp/openalice-isolated/workspaces')
  })

  it('still allows AQ_LAUNCHER_ROOT to split workspace storage explicitly', () => {
    const cfg = loadConfig({
      webPort: 4444,
      env: {
        OPENALICE_HOME: '/tmp/openalice-isolated',
        AQ_LAUNCHER_ROOT: '/tmp/openalice-workspaces-only',
      },
    })
    expect(cfg.launcherRoot).toBe('/tmp/openalice-workspaces-only')
  })
})
