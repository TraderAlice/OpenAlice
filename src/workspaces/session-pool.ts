import type { WebSocket } from 'ws';

import type { CliAdapter } from './cli-adapter.js';
import type { Logger } from './logger.js';
import {
  PersistentSession,
  type SessionAttachResult,
  type SessionControllerClaim,
  type PersistentSessionOptions,
} from './persistent-session.js';
import type { TranscriptWatcher } from './transcript-watcher.js';

/**
 * Per-attach context the factory uses to compose a fresh PersistentSession.
 * `recordId` + `recordName` MUST be pre-allocated by the REST handler from
 * the SessionRegistry — the pool is a pure PTY container and no longer
 * generates identities of its own.
 */
export interface SessionFactoryContext {
  readonly resume?: 'last' | { sessionId: string };
  readonly agentId?: string;
  /** Stable record id (= what the pool keys by). */
  readonly recordId: string;
  /** Sticky display name (`c1` / `x2` / `sh1`). */
  readonly recordName: string;
  /** Shell-resume preamble: bytes prepended to the new PTY's ReplayBuffer. */
  readonly initialReplayBytes?: Buffer;
  /**
   * Quick-chat seed: a first user message the FRESH interactive TUI opens
   * already working on (threaded into the adapter's `composeCommand` argv).
   * Ignored when `resume` is set; `shell` ignores it always. See
   * `SpawnContext.initialPrompt`.
   */
  readonly initialPrompt?: string;
}

/**
 * The factory hands back the PersistentSession config + the adapter that
 * owns this session (so the pool can pass it to the transcript watcher and
 * stamp the live-session payload).
 */
export interface SessionFactoryResult {
  readonly opts: Omit<
    PersistentSessionOptions,
    'wsId' | 'recordId' | 'name' | 'onDisposed'
  >;
  readonly adapter: CliAdapter;
}

export type SessionConfigFactory = (
  wsId: string,
  ctx: SessionFactoryContext,
) => SessionFactoryResult;

export interface LiveSessionInfo {
  readonly id: string;
  readonly wsId: string;
  readonly name: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly agent: string;
  readonly agentSessionId: string | null;
}

/**
 * Owns every live PTY, keyed by the record id (a stable uuid the
 * SessionRegistry pre-allocates). One PersistentSession per id; one
 * attached WebSocket per session (second attach kicks the first). PTYs
 * exist only between spawn and dispose — restart wipes the pool but the
 * SessionRegistry persists.
 */
export class SessionPool {
  private readonly sessions = new Map<string, PersistentSession>();
  private readonly byWs = new Map<string, Set<string>>();
  private readonly adapterFor = new Map<string, CliAdapter>();

  constructor(
    private readonly configFactory: SessionConfigFactory,
    private readonly logger: Logger,
    private readonly transcriptWatcher?: TranscriptWatcher,
  ) {}

  /** Spawn a PTY for a pre-allocated record. */
  spawn(wsId: string, factoryCtx: SessionFactoryContext): PersistentSession {
    const recordId = factoryCtx.recordId;
    const { opts, adapter } = this.configFactory(wsId, factoryCtx);
    const session = new PersistentSession({
      ...opts,
      wsId,
      recordId,
      name: factoryCtx.recordName,
      onDisposed: () => this.onSessionDisposed(wsId, recordId),
    });

    this.sessions.set(recordId, session);
    this.adapterFor.set(recordId, adapter);
    let ids = this.byWs.get(wsId);
    if (!ids) {
      ids = new Set();
      this.byWs.set(wsId, ids);
    }
    ids.add(recordId);
    this.logger.info('pool.session_created', {
      wsId,
      recordId,
      name: factoryCtx.recordName,
      agent: adapter.id,
      total: this.sessions.size,
      forWorkspace: ids.size,
    });
    if (this.transcriptWatcher) {
      // Fire-and-forget — the watcher logs its own errors. A failed register
      // just means agentSessionId stays null, which is a tooltip cosmetic.
      void this.transcriptWatcher.register(session, adapter);
    }
    return session;
  }

  /** Attach a WebSocket to a known record. Returns false if id is unknown. */
  attachById(
    recordId: string,
    ws: WebSocket,
    cols: number,
    rows: number,
    since: number | undefined,
    claim?: SessionControllerClaim,
  ): SessionAttachResult | { readonly ok: false; readonly reason: 'missing' } {
    const session = this.sessions.get(recordId);
    if (!session) return { ok: false, reason: 'missing' };
    return session.attach(ws, cols, rows, since, claim);
  }

  get(recordId: string): PersistentSession | undefined {
    return this.sessions.get(recordId);
  }

  /** All live sessions belonging to a workspace, oldest-spawned first. */
  liveSessionsFor(wsId: string): LiveSessionInfo[] {
    const ids = this.byWs.get(wsId);
    if (!ids || ids.size === 0) return [];
    const out: LiveSessionInfo[] = [];
    for (const id of ids) {
      const s = this.sessions.get(id);
      if (!s) continue;
      const adapter = this.adapterFor.get(id);
      out.push({
        id,
        wsId: s.wsId,
        name: s.name,
        pid: s.pid,
        startedAt: s.startedAt,
        agent: adapter?.id ?? 'unknown',
        agentSessionId: s.agentSessionId,
      });
    }
    return out;
  }

  liveSessionCount(wsId: string): number {
    return this.byWs.get(wsId)?.size ?? 0;
  }

  size(): number {
    return this.sessions.size;
  }

  /** Dispose ONE session by id. Returns false if not found. */
  disposeToken(recordId: string, reason: string): boolean {
    const session = this.sessions.get(recordId);
    if (!session) return false;
    session.dispose(reason);
    return true;
  }

  /** Dispose ALL sessions for a workspace (DELETE /workspaces/:id). */
  dispose(wsId: string, reason: string): boolean {
    const ids = this.byWs.get(wsId);
    if (!ids || ids.size === 0) return false;
    // Copy first — session.dispose() triggers onDisposed which mutates byWs.
    const snapshot = Array.from(ids);
    for (const id of snapshot) {
      const s = this.sessions.get(id);
      if (s) s.dispose(reason);
    }
    return true;
  }

  disposeAll(reason: string): void {
    for (const session of Array.from(this.sessions.values())) {
      session.dispose(reason);
    }
    this.sessions.clear();
    this.byWs.clear();
    this.adapterFor.clear();
  }

  // ── internals ────────────────────────────────────────────────────────────

  private onSessionDisposed(wsId: string, recordId: string): void {
    const session = this.sessions.get(recordId);
    const adapter = this.adapterFor.get(recordId);
    this.sessions.delete(recordId);
    this.adapterFor.delete(recordId);
    const ids = this.byWs.get(wsId);
    if (ids) {
      ids.delete(recordId);
      if (ids.size === 0) this.byWs.delete(wsId);
    }
    if (this.transcriptWatcher && session) this.transcriptWatcher.unregister(session);
    this.logger.info('pool.session_removed', {
      wsId,
      recordId,
      agent: adapter?.id ?? 'unknown',
      remaining: this.sessions.size,
      forWorkspace: ids?.size ?? 0,
    });
  }
}
