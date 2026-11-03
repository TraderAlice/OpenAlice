/**
 * Origin gate for the PTY WebSocket upgrade — unit tests for
 * `isWsOriginAllowed`. The upgrade path itself is event-driven on
 * `http.Server` and is exercised via integration; the origin decision
 * is pure and testable here.
 */

import { describe, it, expect } from 'vitest';
import { isWsOriginAllowed } from './workspaces-ws.js';

function cfg(origins: string[] = [], allowAnyOrigin = false) {
  return { allowAnyOrigin, allowedOrigins: new Set(origins) };
}

describe('isWsOriginAllowed', () => {
  it('allows same-origin via a LAN / Tailscale IP (the #upgrade.origin_rejected case)', () => {
    expect(isWsOriginAllowed('http://100.64.1.2:47331', '100.64.1.2:47331', cfg())).toBe(true);
    expect(isWsOriginAllowed('http://192.168.1.50:47331', '192.168.1.50:47331', cfg())).toBe(true);
  });

  it('allows same-origin via a domain (reverse proxy forwarding Host)', () => {
    expect(isWsOriginAllowed('https://alice.example.com', 'alice.example.com', cfg())).toBe(true);
  });

  it('rejects cross-origin even when auth would pass', () => {
    expect(isWsOriginAllowed('http://evil.example.com', '100.64.1.2:47331', cfg())).toBe(false);
  });

  it('rejects same host but different port (true cross-origin)', () => {
    expect(isWsOriginAllowed('http://100.64.1.2:9999', '100.64.1.2:47331', cfg())).toBe(false);
  });

  it('still honors the static allowlist for cross-origin topologies (Vite dev)', () => {
    const c = cfg(['http://localhost:5173']);
    expect(isWsOriginAllowed('http://localhost:5173', 'localhost:47331', c)).toBe(true);
  });

  it('allows missing Origin (non-browser callers; auth still gates)', () => {
    expect(isWsOriginAllowed(undefined, 'localhost:47331', cfg())).toBe(true);
    expect(isWsOriginAllowed('', 'localhost:47331', cfg())).toBe(true);
  });

  it('rejects unparseable Origin (including the literal "null" from sandboxed iframes)', () => {
    expect(isWsOriginAllowed('null', 'localhost:47331', cfg())).toBe(false);
    expect(isWsOriginAllowed('not a url', 'localhost:47331', cfg())).toBe(false);
  });

  it('rejects cross-origin when Host header is absent', () => {
    expect(isWsOriginAllowed('http://100.64.1.2:47331', undefined, cfg())).toBe(false);
  });

  it('wildcard allowAnyOrigin admits everything', () => {
    expect(isWsOriginAllowed('http://evil.example.com', 'localhost:47331', cfg([], true))).toBe(true);
  });
});
