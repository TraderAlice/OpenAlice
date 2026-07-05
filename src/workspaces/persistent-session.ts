import * as pty from 'node-pty';
import type { WebSocket } from 'ws';

import type { Logger } from './logger.js';
import {
  isClientControlMessage,
  type ServerControlMessage,
} from './protocol.js';
import { ReplayBuffer } from './replay-buffer.js';
import { resolveLaunchCommand } from './win-command.js';

export interface PersistentSessionOptions {
  /** The workspace this session belongs to (for routing, logging, cwd context). */
  readonly wsId: string;
  /** Stable record id (also serves as the PTY's routing key in the pool). */
  readonly recordId: string;
  /** Display name for tab UI (e.g. "c1", "x2", "sh1"). Sticky across pause/resume. */
  readonly name: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly env: { [key: string]: string };
  readonly initialCols: number;
  readonly initialRows: number;
  readonly logger: Logger;
  readonly replayBufferBytes: number;
  readonly highWatermarkBytes: number;
  readonly lowWatermarkBytes: number;
  readonly onDisposed: () => void;
  /**
   * V3.S5 — bytes prepended to the ReplayBuffer before the PTY spawns. Used
   * by shell resume: the prior session's scrollback is pushed back into the
   * fresh PTY's buffer so the first WebSocket attach sees the old screen
   * with the new prompt below. Capped per `ScrollbackStore`; truncated to
   * the buffer's `replayBufferBytes` tail if it would overflow.
   */
  readonly initialReplayBytes?: Buffer;
}

export interface SessionControllerClaim {
  readonly controllerId: string;
  readonly controllerKind: string;
  /** Explicit user/operator action: replace the current controller. */
  readonly takeover?: boolean;
}

export interface SessionControllerOwner {
  readonly id: string;
  readonly kind: string;
}

export type SessionAttachResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: 'locked'; readonly owner: SessionControllerOwner };

const MAX_DIM = 1000;
const CURSOR_TICK_MS = 2000;
const CURSOR_BYTES_INTERVAL = 64 * 1024;
const RESPAWN_DEBOUNCE_MS = 1000;
const RESPAWN_WINDOW_MS = 30_000;
const RESPAWN_WINDOW_LIMIT = 3;

/**
 * A PTY whose lifetime is decoupled from any single WebSocket.
 *
 * The session owns the child process, a `ReplayBuffer` of recent output, and
 * (at most one at a time, for v1) an attached WebSocket. On `attach`, any
 * prior client is kicked, the replay tail is shipped as a binary frame, then
 * an `attached` text frame tells the client where the seq starts.
 *
 * Output flow:
 *   pty.onData → buffer.append(buf) → if ws is attached, ws.send(buf, binary)
 * Cursor heartbeats (text `cursor` messages) are emitted every
 * CURSOR_BYTES_INTERVAL bytes of output or CURSOR_TICK_MS of idle time, so
 * the client can persist `lastSeq` and request a tight replay window on
 * reattach.
 */
export class PersistentSession {
  private term: pty.IPty;
  private readonly buffer: ReplayBuffer;
  private readonly opts: PersistentSessionOptions;
  private readonly log: Logger;
  private ws: WebSocket | null = null;
  private paused = false;
  private disposed = false;
  private cursorTimer: NodeJS.Timeout | null = null;
  private lastCursorSeq = 0;
  private messageHandler: ((raw: unknown, isBinary: boolean) => void) | null = null;
  private closeHandler: (() => void) | null = null;
  private errorHandler: (() => void) | null = null;
  private controller: SessionControllerOwner | null = null;
  private currentCols: number;
  private currentRows: number;
  private respawnTimes: number[] = [];
  private respawnTimer: NodeJS.Timeout | null = null;
  /**
   * The CLI's own session id (claude: UUID in JSONL filename; codex: rollout
   * UUID; etc.). Discovered post-spawn by the transcript watcher when the
   * adapter supports it. Null on adapters with `transcriptDiscovery: 'none'`.
   */
  private _agentSessionId: string | null = null;
  /** Wall-clock spawn time; surfaced via the GET /sessions endpoint for tab ordering. */
  private readonly _startedAt = Date.now();
  /**
   * Latched on the FIRST child exit; lets the resume/spawn route find out the
   * child died (instead of returning 200 OK while the PTY respawn-loops itself
   * into the circuit breaker behind the user's back). Subsequent exits are
   * still logged, just not re-broadcast through this hook.
   */
  private firstExit: { code: number; signal: number | null } | null = null;
  private exitWaiters: Set<(info: { code: number; signal: number | null }) => void> = new Set();

  constructor(opts: PersistentSessionOptions) {
    this.opts = opts;
    this.log = opts.logger.child({
      wsId: opts.wsId,
      recordId: opts.recordId,
      name: opts.name,
    });
    this.buffer = new ReplayBuffer(opts.replayBufferBytes);
    if (opts.initialReplayBytes && opts.initialReplayBytes.length > 0) {
      // Seed the buffer so the very first WebSocket attach replays this as
      // scrollback. Subsequent PTY output appends below.
      this.buffer.append(opts.initialReplayBytes);
    }
    this.currentCols = clamp(opts.initialCols, 1, MAX_DIM);
    this.currentRows = clamp(opts.initialRows, 1, MAX_DIM);

    this.term = this.spawnChild();
    this.log.info('session.spawned', {
      pid: this.term.pid,
      command: opts.command,
      cwd: opts.cwd,
    });
  }

  private spawnChild(): pty.IPty {
    if (this.opts.command.length === 0) {
      throw new Error('command must contain at least one argv element');
    }
    // win32: resolve the bare CLI name to its real `.exe`, or wrap a `.cmd`/
    // `.ps1` npm shim through cmd.exe — ConPTY's CreateProcess only appends
    // `.exe`, so npm-shim CLIs (opencode, pi) otherwise never launch. No-op off
    // Windows. The interactive command is flags + launcher/adapter-generated
    // ids, so the shell wrap is injection-safe here. See win-command.ts.
    const [argv0, ...args] = resolveLaunchCommand(this.opts.command, {
      env: this.opts.env,
    }).argv;
    if (!argv0) throw new Error('command must contain at least one argv element');

    const term = pty.spawn(argv0, args, {
      name: 'xterm-256color',
      cols: this.currentCols,
      rows: this.currentRows,
      cwd: this.opts.cwd,
      env: this.opts.env,
      // Raw bytes; xterm.js decodes UTF-8 with proper streaming state.
      encoding: null,
    });

    term.onData((data) => this.onPtyData(data as unknown as Buffer | string));
    term.onExit(({ exitCode, signal }) => this.onChildExit(term, exitCode, signal));
    return term;
  }

  /**
   * Child process exited but the session itself is sticking around. We tell
   * the client (lifecycle child-exit), then schedule a respawn after a short
   * debounce — unless the child has been crashing too often, in which case
   * we open the circuit breaker and dispose for real.
   */
  private onChildExit(
    exited: pty.IPty,
    exitCode: number,
    signalRaw: number | undefined,
  ): void {
    if (this.disposed) return;
    // Ignore exits from an already-replaced term (paranoia).
    if (exited !== this.term) return;
    const signal = typeof signalRaw === 'number' ? signalRaw : null;
    this.log.info('session.child_exit', {
      pid: exited.pid,
      code: exitCode,
      signal,
    });
    if (this.firstExit === null) {
      this.firstExit = { code: exitCode, signal };
      for (const w of this.exitWaiters) w(this.firstExit);
      this.exitWaiters.clear();
    }
    this.sendControl({
      type: 'lifecycle',
      kind: 'child-exit',
      code: exitCode,
      signal,
    });

    const now = Date.now();
    this.respawnTimes = this.respawnTimes.filter((t) => now - t < RESPAWN_WINDOW_MS);
    this.respawnTimes.push(now);
    if (this.respawnTimes.length > RESPAWN_WINDOW_LIMIT) {
      this.log.warn('session.respawn_circuit_open', {
        recentCrashes: this.respawnTimes.length,
      });
      this.sendControl({ type: 'exit', code: exitCode, signal });
      this.dispose('respawn circuit open');
      return;
    }

    if (this.respawnTimer) clearTimeout(this.respawnTimer);
    this.respawnTimer = setTimeout(() => this.respawnNow(), RESPAWN_DEBOUNCE_MS);
    this.respawnTimer.unref();
  }

  private respawnNow(): void {
    this.respawnTimer = null;
    if (this.disposed) return;
    try {
      this.term = this.spawnChild();
      this.log.info('session.respawned', { pid: this.term.pid });
      this.sendControl({ type: 'lifecycle', kind: 'child-respawn', pid: this.term.pid });
    } catch (err) {
      this.log.error('session.respawn_failed', { err });
      this.sendControl({ type: 'exit', code: -1, signal: null });
      this.dispose('respawn failed');
    }
  }

  get pid(): number {
    return this.term.pid;
  }

  get command(): readonly string[] {
    return this.opts.command;
  }

  get wsId(): string {
    return this.opts.wsId;
  }

  get cwd(): string {
    return this.opts.cwd;
  }

  get recordId(): string {
    return this.opts.recordId;
  }

  get name(): string {
    return this.opts.name;
  }

  get agentSessionId(): string | null {
    return this._agentSessionId;
  }

  get startedAt(): number {
    return this._startedAt;
  }

  /**
   * Resolve when the FIRST PTY child exits, or null when `timeoutMs` elapses
   * with the child still alive. Lets the REST spawn/resume handlers report
   * "I started a PTY but it died immediately" instead of blindly returning
   * 200 OK while the respawn loop tips over the circuit breaker.
   *
   * If the child already died before this is called, returns the latched
   * info synchronously (wrapped in a resolved Promise).
   */
  waitForFirstExit(timeoutMs: number): Promise<{ code: number; signal: number | null } | null> {
    if (this.firstExit) return Promise.resolve(this.firstExit);
    return new Promise((resolve) => {
      const waiter = (info: { code: number; signal: number | null }): void => {
        clearTimeout(timer);
        resolve(info);
      };
      const timer = setTimeout(() => {
        this.exitWaiters.delete(waiter);
        resolve(null);
      }, timeoutMs);
      timer.unref();
      this.exitWaiters.add(waiter);
    });
  }

  /**
   * Snapshot the full replay buffer (from head to tail). Called by the
   * launcher right before disposing a shell session for pause, so the
   * scrollback can be persisted and pushed back on resume.
   */
  dumpReplayBuffer(): Buffer {
    return this.buffer.since(this.buffer.headSeq).bytes;
  }

  /** Called by the transcript watcher once it identifies which file this PTY is writing. */
  setAgentSessionId(id: string): void {
    if (this._agentSessionId !== null) return;
    this._agentSessionId = id;
    this.log.info('session.agent_id_detected', { agentSessionId: id });
  }

  /** Swap in `ws` as the attached client. A controller claim makes ownership
   *  explicit: a second controller is rejected unless it deliberately takes
   *  over. This is the shared rule for browser, Electron IPC, future IM bridges,
   *  and any debug client that can write to the PTY. */
  attach(
    ws: WebSocket,
    cols: number,
    rows: number,
    since: number | undefined,
    claim?: SessionControllerClaim,
  ): SessionAttachResult {
    if (this.disposed) {
      try {
        ws.close(1011, 'session disposed');
      } catch {
        // ignore
      }
      return { ok: false, reason: 'locked', owner: this.controller ?? { id: 'disposed', kind: 'session' } };
    }

    const owner = normalizeClaim(claim);
    if (
      owner &&
      this.ws !== null &&
      this.controller !== null &&
      this.controller.id !== owner.id &&
      !claim?.takeover
    ) {
      try {
        ws.close(4409, 'session locked by another controller');
      } catch {
        // ignore
      }
      return { ok: false, reason: 'locked', owner: this.controller };
    }

    // Kick previous client.
    if (this.ws !== null && this.ws !== ws) {
      const prev = this.ws;
      this.unwireWs(prev);
      this.ws = null;
      try {
        prev.close(4001, 'kicked by new attach');
      } catch {
        // ignore
      }
    }

    this.ws = ws;
    this.controller = owner;
    // A previous client may have dropped mid-backpressure, leaving the PTY
    // paused at the OS level. Clearing only the flag (not resuming the term)
    // would strand it paused forever; resumePty() un-sticks both.
    this.resumePty();
    this.resize(cols, rows);

    // Compute replay window. Cold attach (since=undefined) replays the full
    // buffer — without that, a fresh browser tab on a workspace where the
    // agent is already idle would just see a black void instead of the prompt
    // and recent output. Hot attach (since=N) only fills in what was missed.
    const requested = since ?? 0;
    const slice = this.buffer.since(requested);
    const scrollbackTruncated = since !== undefined && slice.effectiveSeq > since;

    if (slice.bytes.length > 0) {
      ws.send(slice.bytes, { binary: true });
    }
    const attached: ServerControlMessage = {
      type: 'attached',
      wsId: this.opts.wsId,
      sessionId: this.opts.recordId,
      name: this.opts.name,
      agentSessionId: this._agentSessionId,
      pid: this.term.pid,
      command: this.opts.command,
      replayFromSeq: slice.effectiveSeq,
      seq: slice.tailSeq,
      scrollbackTruncated,
    };
    ws.send(JSON.stringify(attached));
    this.lastCursorSeq = slice.tailSeq;

    this.wireWs(ws);
    this.startCursorTimer();

    this.log.event('session.attached', {
      since: since ?? null,
      replayFromSeq: slice.effectiveSeq,
      replayBytes: slice.bytes.length,
      scrollbackTruncated,
      controller: this.controller,
    });
    return { ok: true };
  }

  /** Drop the current client without killing the PTY. */
  detach(): void {
    if (this.ws === null) return;
    const ws = this.ws;
    this.ws = null;
    this.controller = null;
    this.unwireWs(ws);
    // No consumer left — let the PTY run free into the in-memory ring buffer
    // (onPtyData appends regardless of socket). If the socket dropped while
    // we were backpressure-paused, NOT resuming here strands the PTY paused
    // forever and the agent blocks on its next stdout write — the "running
    // along and then freezes" symptom.
    this.resumePty();
    if (this.cursorTimer) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = null;
    }
    this.log.event('session.detached');
  }

  dispose(reason: string): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.cursorTimer) {
      clearInterval(this.cursorTimer);
      this.cursorTimer = null;
    }
    if (this.respawnTimer) {
      clearTimeout(this.respawnTimer);
      this.respawnTimer = null;
    }
    try {
      this.term.kill();
    } catch {
      // already dead
    }
    const ws = this.ws;
    if (ws !== null) {
      this.unwireWs(ws);
      this.ws = null;
      this.controller = null;
      try {
        ws.close(1000, `disposed: ${reason}`);
      } catch {
        // ignore
      }
    }
    this.log.info('session.disposed', { reason });
    this.opts.onDisposed();
  }

  private onPtyData(data: Buffer | string): void {
    if (this.disposed) return;
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
    this.buffer.append(buf);

    const ws = this.ws;
    if (ws !== null) {
      ws.send(buf, { binary: true }, (err) => {
        if (err) {
          this.log.warn('session.send_error', { err });
          return;
        }
        if (this.paused && ws.bufferedAmount <= this.opts.lowWatermarkBytes) {
          this.paused = false;
          try {
            this.term.resume();
          } catch {
            // ignore
          }
        }
      });

      if (!this.paused && ws.bufferedAmount >= this.opts.highWatermarkBytes) {
        this.paused = true;
        try {
          this.term.pause();
        } catch {
          // ignore
        }
      }
    }

    if (this.buffer.tailSeq - this.lastCursorSeq >= CURSOR_BYTES_INTERVAL) {
      this.maybeSendCursor();
    }
  }

  /** Un-pause the PTY read stream if backpressure paused it. Safe to call when
   *  already running. Keeping the `paused` flag and the term stream in lockstep
   *  is the whole point — clearing one without the other deadlocks the PTY. */
  private resumePty(): void {
    if (!this.paused) return;
    this.paused = false;
    try {
      this.term.resume();
    } catch {
      // PTY may be dying; ignore.
    }
  }

  private onWsMessage(ws: WebSocket, raw: unknown, isBinary: boolean): void {
    if (this.disposed) return;
    if (this.ws !== ws) return; // stale (this ws was kicked)

    if (isBinary) {
      const buf = toBuffer(raw);
      if (!buf) return;
      try {
        // Browser stdin arrives as UTF-8 bytes. Keep this edge byte-faithful:
        // converting through string corrupts arbitrary terminal sequences and
        // makes CJK/IME behavior depend on JS decoding instead of the PTY.
        this.term.write(buf as unknown as string);
      } catch (err) {
        this.log.warn('session.write_error', { err });
      }
      return;
    }

    const buf = toBuffer(raw);
    if (!buf) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(buf.toString('utf8'));
    } catch {
      return;
    }
    if (!isClientControlMessage(parsed)) return;

    if (parsed.type === 'resize') {
      this.resize(parsed.cols, parsed.rows);
    }
    // `attach` mid-stream is ignored — the initial attach already happened.
  }

  private wireWs(ws: WebSocket): void {
    const messageHandler = (raw: unknown, isBinary: boolean): void =>
      this.onWsMessage(ws, raw, isBinary);
    const closeHandler = (): void => {
      if (this.ws === ws) this.detach();
    };
    const errorHandler = closeHandler;
    ws.on('message', messageHandler);
    ws.on('close', closeHandler);
    ws.on('error', errorHandler);
    this.messageHandler = messageHandler;
    this.closeHandler = closeHandler;
    this.errorHandler = errorHandler;
  }

  private unwireWs(ws: WebSocket): void {
    if (this.messageHandler) ws.off('message', this.messageHandler);
    if (this.closeHandler) ws.off('close', this.closeHandler);
    if (this.errorHandler) ws.off('error', this.errorHandler);
    this.messageHandler = null;
    this.closeHandler = null;
    this.errorHandler = null;
  }

  private resize(cols: number, rows: number): void {
    const c = clamp(Math.floor(cols), 1, MAX_DIM);
    const r = clamp(Math.floor(rows), 1, MAX_DIM);
    this.currentCols = c;
    this.currentRows = r;
    try {
      this.term.resize(c, r);
    } catch {
      // PTY may be dying; ignore.
    }
  }

  private sendControl(msg: ServerControlMessage): void {
    const ws = this.ws;
    if (ws === null || ws.readyState !== ws.OPEN) return;
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      // ignore — ws may have just closed
    }
  }

  private startCursorTimer(): void {
    if (this.cursorTimer) clearInterval(this.cursorTimer);
    const t = setInterval(() => this.maybeSendCursor(), CURSOR_TICK_MS);
    t.unref();
    this.cursorTimer = t;
  }

  private maybeSendCursor(): void {
    if (this.disposed || this.ws === null) return;
    const seq = this.buffer.tailSeq;
    if (seq === this.lastCursorSeq) return;
    this.lastCursorSeq = seq;
    this.sendControl({ type: 'cursor', seq });
  }
}

function normalizeClaim(claim: SessionControllerClaim | undefined): SessionControllerOwner | null {
  if (!claim?.controllerId) return null;
  return { id: claim.controllerId, kind: claim.controllerKind || 'unknown' };
}

function toBuffer(raw: unknown): Buffer | null {
  if (Buffer.isBuffer(raw)) return raw;
  if (raw instanceof ArrayBuffer) return Buffer.from(raw);
  if (Array.isArray(raw)) {
    return Buffer.concat(raw.map((r) => toBuffer(r) ?? Buffer.alloc(0)));
  }
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
