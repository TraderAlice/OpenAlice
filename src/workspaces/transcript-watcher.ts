import { mkdir, readdir, stat } from 'node:fs/promises';
import { watch, type FSWatcher } from 'node:fs';
import { basename, join } from 'node:path';

import type { CliAdapter, OnDiskSession } from './cli-adapter.js';
import type { Logger } from './logger.js';
import type { PersistentSession } from './persistent-session.js';
import type { SessionRegistry } from './session-registry.js';

interface Pending {
  readonly session: PersistentSession;
  readonly adapter: CliAdapter;
  /** Identifiers (fs-watch: filenames; subprocess: session ids) present at
   *  register time — ignored when matching, so we only claim what's NEW. */
  readonly existingBefore: ReadonlySet<string>;
}

interface PerKey {
  readonly dir: string;
  readonly fileRe: RegExp;
  readonly watcher: FSWatcher;
  readonly pending: Pending[];
}

/** subprocess-discovery (codex/opencode): no fs event for a DB/global-dir
 *  write, so we poll `adapter.listOnDisk(cwd)` until each pending session's id
 *  appears, then persist it as the record's resumeHint (same channel fs-watch
 *  uses). Keyed by (wsId, cwd). */
interface PollEntry {
  readonly cwd: string;
  readonly adapter: CliAdapter;
  readonly pending: Pending[];
  timer: ReturnType<typeof setInterval> | null;
  readonly startedAtMs: number;
}

const POLL_INTERVAL_MS = 1500;
// Give up after this long unresolved — the session never produced a
// discoverable id (e.g. opened then idle before any turn). Resume then falls
// back to `--continue`/last, exactly as today. Not load-bearing.
const POLL_MAX_MS = 90_000;

function watchKey(wsId: string, dir: string): string {
  return `${wsId}\x00${dir}`;
}

/**
 * Maps PTY sessions to their CLI's on-disk transcript file.
 *
 * Adapter-driven (generalized from the M4-era `ClaudeSessionWatcher`):
 *   - `adapter.transcriptDir(cwd)` decides which directory to watch.
 *   - `adapter.transcriptFileRe` filters watch events.
 *   - `adapter.extractSessionId(filename)` extracts the session id.
 *
 * The watcher is per-(wsId, dir) — most adapters land sessions of the same
 * workspace in the same directory, so we share an `FSWatcher`. Codex (M2)
 * uses `transcriptDiscovery: 'none'` so it never reaches this code; if a
 * future adapter wants a global dir (e.g. `~/.codex/sessions`) we'd need to
 * extend this to read cwd from the file contents — out of v2 scope.
 *
 * Same matching heuristic as before: snapshot existing files at register
 * time, assign each new file to the oldest pending session in spawn order.
 * Reliable for chat flows; rapid concurrent spawns can cross-match (impact
 * is just a misleading tooltip, never anything load-bearing).
 */
export class TranscriptWatcher {
  private readonly entries = new Map<string, PerKey>();
  private readonly pollEntries = new Map<string, PollEntry>();

  constructor(
    private readonly logger: Logger,
    /**
     * Optional registry. When provided, the watcher fans out the discovered
     * agent-session-id into the corresponding record's `resumeHint`, so
     * `POST /sessions/:id/resume` can later invoke `claude --resume <uuid>`.
     */
    private readonly sessionRegistry?: SessionRegistry,
    /** Backend identity mapper; keeps native ids out of product protocols. */
    private readonly onAgentSessionId?: (wsId: string, recordId: string, agentSessionId: string) => void,
  ) {}

  async register(session: PersistentSession, adapter: CliAdapter): Promise<void> {
    const discovery = adapter.capabilities.transcriptDiscovery;
    if (discovery === 'subprocess') {
      await this.registerSubprocess(session, adapter);
      return;
    }
    if (discovery !== 'fs-watch') return;
    if (!adapter.transcriptDir || !adapter.transcriptFileRe || !adapter.extractSessionId) {
      this.logger.warn('transcript_watch.adapter_missing_fs_methods', { adapter: adapter.id });
      return;
    }

    const dir = adapter.transcriptDir(session.cwd);
    const key = watchKey(session.wsId, dir);

    let existing: ReadonlySet<string>;
    try {
      existing = await snapshotFiles(dir, adapter.transcriptFileRe);
    } catch (err) {
      if (!isENOENT(err)) {
        this.logger.warn('transcript_watch.snapshot_failed', {
          wsId: session.wsId,
          adapter: adapter.id,
          dir,
          err,
        });
      }
      existing = new Set();
    }

    try {
      await mkdir(dir, { recursive: true });
    } catch (err) {
      this.logger.warn('transcript_watch.mkdir_failed', {
        wsId: session.wsId,
        adapter: adapter.id,
        dir,
        err,
      });
      return;
    }

    let entry = this.entries.get(key);
    if (!entry) {
      try {
        const w = watch(dir, (event, filename) => {
          if (typeof filename === 'string') {
            void this.onEvent(key, event, filename);
          }
        });
        w.on('error', (err) => {
          this.logger.warn('transcript_watch.error', {
            wsId: session.wsId,
            adapter: adapter.id,
            dir,
            err,
          });
        });
        entry = { dir, fileRe: adapter.transcriptFileRe, watcher: w, pending: [] };
        this.entries.set(key, entry);
      } catch (err) {
        this.logger.warn('transcript_watch.watch_failed', {
          wsId: session.wsId,
          adapter: adapter.id,
          dir,
          err,
        });
        return;
      }
    }

    entry.pending.push({ session, adapter, existingBefore: existing });
    this.logger.info('transcript_watch.registered', {
      wsId: session.wsId,
      adapter: adapter.id,
      recordId: session.recordId,
      preexisting: existing.size,
      pending: entry.pending.length,
    });
    // path.trace — what the watcher is actually watching for THIS session.
    // Compare watchDir + projectKey against the spawn path.trace; any
    // divergence means the CLI will write jsonl to a place we're not
    // watching, and resumeHint will never be populated.
    this.logger.event('path.trace', {
      where: 'transcript.watch.register',
      wsId: session.wsId,
      recordId: session.recordId,
      agent: adapter.id,
      sessionCwd: session.cwd,
      watchDir: dir,
      projectKey: basename(dir),
      watchDirJsonlCount: existing.size,
    });
  }

  /**
   * subprocess discovery: snapshot existing session ids, then poll
   * `listOnDisk(cwd)` until each pending session's NEW id shows up. Used by
   * codex (global session dir, attributed by reading each rollout's cwd) and
   * opencode (SQLite-backed, listed cwd-scoped via the CLI) — neither emits an
   * fs event we could watch.
   */
  private async registerSubprocess(session: PersistentSession, adapter: CliAdapter): Promise<void> {
    if (!adapter.listOnDisk) {
      this.logger.warn('transcript_watch.adapter_missing_list_on_disk', { adapter: adapter.id });
      return;
    }
    let existing: ReadonlySet<string>;
    try {
      existing = new Set((await adapter.listOnDisk(session.cwd)).map((s) => s.sessionId));
    } catch (err) {
      this.logger.warn('transcript_watch.list_on_disk_failed', { adapter: adapter.id, cwd: session.cwd, err });
      existing = new Set();
    }
    const key = watchKey(session.wsId, session.cwd);
    let entry = this.pollEntries.get(key);
    if (!entry) {
      entry = { cwd: session.cwd, adapter, pending: [], timer: null, startedAtMs: Date.now() };
      this.pollEntries.set(key, entry);
    }
    entry.pending.push({ session, adapter, existingBefore: existing });
    if (!entry.timer) {
      entry.timer = setInterval(() => void this.pollOnce(key), POLL_INTERVAL_MS);
    }
    this.logger.info('transcript_watch.subprocess_registered', {
      wsId: session.wsId,
      recordId: session.recordId,
      agent: adapter.id,
      preexisting: existing.size,
      pending: entry.pending.length,
    });
  }

  /** One poll tick: assign each NEW (since-register) session id to the oldest
   *  unresolved pending in spawn order — same heuristic as the fs-watch path. */
  private async pollOnce(key: string): Promise<void> {
    const entry = this.pollEntries.get(key);
    if (!entry) return;
    const live = entry.pending.filter((p) => p.session.agentSessionId === null);
    entry.pending.length = 0;
    entry.pending.push(...live);
    if (entry.pending.length === 0 || Date.now() - entry.startedAtMs > POLL_MAX_MS) {
      this.stopPoll(key);
      return;
    }
    let list: readonly OnDiskSession[];
    try {
      list = await entry.adapter.listOnDisk!(entry.cwd);
    } catch (err) {
      this.logger.warn('transcript_watch.poll_list_failed', { agent: entry.adapter.id, cwd: entry.cwd, err });
      return;
    }
    const byOldest = [...list].sort((a, b) => a.mtime.localeCompare(b.mtime));
    const claimedThisRound = new Set<string>();
    for (const p of entry.pending) {
      if (p.session.agentSessionId !== null) continue;
      const pick = byOldest.find((s) => !p.existingBefore.has(s.sessionId) && !claimedThisRound.has(s.sessionId));
      if (!pick) continue;
      p.session.setAgentSessionId(pick.sessionId);
      this.onAgentSessionId?.(p.session.wsId, p.session.recordId, pick.sessionId);
      claimedThisRound.add(pick.sessionId);
      this.logger.info('transcript.session.captured', {
        wsId: p.session.wsId,
        recordId: p.session.recordId,
        agent: p.adapter.id,
        agentSessionId: pick.sessionId,
      });
      if (this.sessionRegistry) {
        void this.sessionRegistry
          .update(p.session.wsId, p.session.recordId, {
            resumeHint: { kind: 'agent-session-id', value: pick.sessionId },
          })
          .catch((err) =>
            this.logger.warn('transcript_watch.registry_update_failed', {
              wsId: p.session.wsId,
              id: p.session.recordId,
              err,
            }),
          );
      }
    }
  }

  private stopPoll(key: string): void {
    const entry = this.pollEntries.get(key);
    if (entry?.timer) clearInterval(entry.timer);
    this.pollEntries.delete(key);
  }

  /** Called when a session is disposed OR resolved. Closes idle watchers. */
  unregister(session: PersistentSession): void {
    for (const [key, entry] of this.entries.entries()) {
      const idx = entry.pending.findIndex((p) => p.session === session);
      if (idx < 0) continue;
      entry.pending.splice(idx, 1);
      if (entry.pending.length === 0) {
        try {
          entry.watcher.close();
        } catch {
          // ignore
        }
        this.entries.delete(key);
      }
    }
    for (const [key, entry] of this.pollEntries.entries()) {
      const idx = entry.pending.findIndex((p) => p.session === session);
      if (idx < 0) continue;
      entry.pending.splice(idx, 1);
      if (entry.pending.length === 0) this.stopPoll(key);
    }
  }

  disposeAll(): void {
    for (const entry of this.entries.values()) {
      try {
        entry.watcher.close();
      } catch {
        // ignore
      }
    }
    this.entries.clear();
    for (const entry of this.pollEntries.values()) {
      if (entry.timer) clearInterval(entry.timer);
    }
    this.pollEntries.clear();
  }

  private async onEvent(key: string, _event: string, filename: string): Promise<void> {
    const entry = this.entries.get(key);
    if (!entry || entry.pending.length === 0) return;
    if (!entry.fileRe.test(filename)) return;

    try {
      await stat(join(entry.dir, filename));
    } catch {
      return;
    }

    for (const p of entry.pending) {
      if (p.existingBefore.has(filename)) continue;
      if (p.session.agentSessionId !== null) continue;
      const sessionId = p.adapter.extractSessionId?.(filename);
      if (!sessionId) return;
      p.session.setAgentSessionId(sessionId);
      this.onAgentSessionId?.(p.session.wsId, p.session.recordId, sessionId);
      this.logger.info('transcript.jsonl.detected', {
        wsId: p.session.wsId,
        recordId: p.session.recordId,
        agent: p.adapter.id,
        filename,
        agentSessionId: sessionId,
      });
      if (this.sessionRegistry) {
        // Fire-and-forget — failed write just means we don't get the
        // resumeHint persisted, which downgrades resume to `--continue`
        // semantics next time.
        void this.sessionRegistry
          .update(p.session.wsId, p.session.recordId, {
            resumeHint: { kind: 'agent-session-id', value: sessionId },
          })
          .catch((err) => {
            this.logger.warn('transcript_watch.registry_update_failed', {
              wsId: p.session.wsId,
              id: p.session.recordId,
              err,
            });
          });
      }
      this.unregister(p.session);
      return;
    }
  }
}

async function snapshotFiles(dir: string, fileRe: RegExp): Promise<Set<string>> {
  const out = new Set<string>();
  const entries = await readdir(dir);
  for (const name of entries) {
    if (fileRe.test(name)) out.add(name);
  }
  return out;
}

function isENOENT(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
