/**
 * WebSocket upgrade handler for /api/workspaces/pty.
 *
 * OpenAlice serves HTTP via Hono on @hono/node-server, which exposes the
 * underlying Node http.Server. We attach a `ws.WebSocketServer({ noServer:
 * true })` and listen for `upgrade` events ourselves so the launcher's
 * existing raw-`ws` PTY frame handling (binary frames, backpressure,
 * close codes) ports over byte-faithfully.
 */

import type { Server as HttpServer, IncomingMessage } from 'node:http';
import { URL } from 'node:url';

import { WebSocketServer, type WebSocket } from 'ws';

import { logger as launcherLogger } from '../workspaces/logger.js';
import type { WorkspaceService } from '../workspaces/service.js';
import { validateAndTouch } from '@/services/auth/session-store.js';
import { isLoopbackIp, SESSION_COOKIE_NAME } from './middleware/auth.js';

const WS_PATH = '/api/workspaces/pty';

/**
 * WS upgrade requests don't traverse the Hono middleware chain (we own
 * the `upgrade` event ourselves). So we re-apply the same auth check
 * here: same localhost passthrough rules, same cookie lookup, same
 * default-deny. See safe/playbooks/07-websocket-auth.md.
 */
function readSessionCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const raw of cookieHeader.split(';')) {
    const entry = raw.trim();
    const eq = entry.indexOf('=');
    if (eq < 0) continue;
    if (entry.slice(0, eq) === SESSION_COOKIE_NAME) {
      const value = entry.slice(eq + 1).trim();
      return value.length > 0 ? decodeURIComponent(value) : null;
    }
  }
  return null;
}

async function isUpgradeAuthorized(req: IncomingMessage): Promise<boolean> {
  if (process.env['OPENALICE_DISABLE_AUTH'] === '1') return true;

  const trustedProxies = (process.env['OPENALICE_TRUSTED_PROXIES'] ?? '')
    .split(',').map((s) => s.trim()).filter(Boolean);

  // Localhost trust passthrough — only when no trusted proxy is configured.
  // Same rule as the HTTP middleware: with a trusted proxy in front,
  // every request looks like localhost, so we MUST require a cookie.
  if (trustedProxies.length === 0) {
    const remote = req.socket.remoteAddress ?? '';
    if (isLoopbackIp(remote)) return true;
  }

  const sid = readSessionCookie(req.headers.cookie);
  if (!sid) return false;
  const session = await validateAndTouch(sid);
  return session !== null;
}

export interface AttachedWS {
  /** Tear down the WebSocketServer and detach upgrade listener. */
  dispose(): void;
}

export function attachWorkspacesWS(httpServer: HttpServer, svc: WorkspaceService): AttachedWS {
  const wss = new WebSocketServer({ noServer: true });

  const onUpgrade = (req: IncomingMessage, socket: import('node:net').Socket, head: Buffer): void => {
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    if (url.pathname !== WS_PATH) {
      // Not ours — leave for other upgrade listeners (none currently in OpenAlice).
      return;
    }

    if (svc.isShuttingDown()) {
      socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n');
      socket.destroy();
      return;
    }

    if (!isOriginAllowed(req, svc)) {
      launcherLogger.warn('upgrade.origin_rejected', {
        origin: req.headers.origin ?? null,
        host: req.headers.host ?? null,
        remoteAddress: req.socket.remoteAddress ?? null,
      });
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    // Auth check — same gate as the HTTP middleware.
    // Promise needed because session lookup is async (file-backed).
    isUpgradeAuthorized(req).then((authorized) => {
      if (!authorized) {
        launcherLogger.warn('upgrade.auth_rejected', {
          remoteAddress: req.socket.remoteAddress ?? null,
        });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit('connection', ws, req, url);
      });
    }).catch((err) => {
      launcherLogger.error('upgrade.auth_check_failed', { err });
      socket.write('HTTP/1.1 500 Internal Server Error\r\n\r\n');
      socket.destroy();
    });
  };

  httpServer.on('upgrade', onUpgrade);

  wss.on('connection', (ws: WebSocket, req: IncomingMessage, url: URL) => {
    const cols = clampQuery(url.searchParams.get('cols'), 80, 1, 1000);
    const rows = clampQuery(url.searchParams.get('rows'), 24, 1, 1000);
    const sinceRaw = url.searchParams.get('since');
    const since = sinceRaw === null ? undefined : parseSince(sinceRaw);
    const controllerId = cleanToken(url.searchParams.get('client'), 128);
    const controllerKind = cleanToken(url.searchParams.get('kind'), 32) ?? 'web';
    const takeover = url.searchParams.get('takeover') === '1';

    const sessionId = (url.searchParams.get('session') ?? '').slice(0, 64);
    if (!sessionId) {
      launcherLogger.warn('upgrade.missing_session_id');
      try { ws.close(4000, 'session id required'); } catch { /* ignore */ }
      return;
    }
    const session = svc.pool.get(sessionId);
    if (!session) {
      launcherLogger.warn('upgrade.unknown_session', { sessionId });
      try { ws.close(4404, 'session not found'); } catch { /* ignore */ }
      return;
    }
    launcherLogger.event('upgrade.accepted', {
      sessionId,
      wsId: session.wsId,
      cols,
      rows,
      since: since ?? null,
      controllerId: controllerId ?? null,
      controllerKind,
      takeover,
      origin: req.headers.origin ?? null,
      // Host the browser actually connected to. Discriminates the dev
      // transport: `localhost:<backendPort>` = direct (proxy bypassed),
      // `localhost:5173` = forwarded through the Vite dev proxy (which
      // preserves the inbound Host). origin stays 5173 either way, so host is
      // the only field that tells them apart.
      host: req.headers.host ?? null,
      remoteAddress: req.socket.remoteAddress ?? null,
    });
    try {
      const result = svc.pool.attachById(
        sessionId,
        ws,
        cols,
        rows,
        since,
        controllerId ? { controllerId, controllerKind, takeover } : undefined,
      );
      if (!result.ok && result.reason === 'missing') {
        try { ws.close(4404, 'session not found'); } catch { /* ignore */ }
      }
    } catch (err) {
      launcherLogger.error('pool.attach_failed', { sessionId, err });
      try { ws.close(1011, 'attach failed'); } catch { /* ignore */ }
    }
  });

  return {
    dispose: () => {
      httpServer.off('upgrade', onUpgrade);
      wss.close();
    },
  };
}

function isOriginAllowed(req: IncomingMessage, svc: WorkspaceService): boolean {
  return isWsOriginAllowed(req.headers.origin, req.headers.host, svc.config);
}

/**
 * Origin gate for the PTY WS upgrade. Mirrors the HTTP middleware's CSRF
 * rule (`isAllowedOrigin` in middleware/auth.ts): a same-origin request —
 * Origin host equal to the Host the browser actually connected to — is
 * always allowed, so direct access through any bind (LAN IP, Tailscale
 * IP, a domain) works without configuration. A browser's Origin is not
 * forgeable from a foreign page, so this admits exactly the pages we
 * served ourselves. The static allowlist covers cross-origin topologies
 * (the Vite dev port — Guardian-resolved, 5173 by default — and the future
 * cloud demo) and stays env-extensible via WEB_TERMINAL_ALLOWED_ORIGINS.
 */
export function isWsOriginAllowed(
  origin: string | undefined,
  host: string | undefined,
  cfg: { readonly allowAnyOrigin: boolean; readonly allowedOrigins: ReadonlySet<string> },
): boolean {
  if (cfg.allowAnyOrigin) return true;
  // Non-browser callers (websocat, CLI tooling) send no Origin — allowed
  // here; the auth gate still applies.
  if (typeof origin !== 'string' || origin.length === 0) return true;
  if (cfg.allowedOrigins.has(origin)) return true;
  if (host) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  return false;
}

function clampQuery(raw: string | null, fallback: number, lo: number, hi: number): number {
  if (raw === null) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

function parseSince(raw: string): number | undefined {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return n;
}

function cleanToken(raw: string | null, max: number): string | undefined {
  if (raw === null) return undefined;
  const value = raw.trim().slice(0, max);
  return value.length > 0 ? value : undefined;
}
