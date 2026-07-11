/**
 * Wire protocol shared between the WebSocket server and browser client.
 *
 * Binary frames carry raw PTY bytes in both directions.
 * Text frames carry small JSON control messages described below.
 *
 * v1 introduces persistent sessions:
 * - Client sends `attach` immediately after WS open (with `since`? for reattach)
 * - Server replies `attached` with the seq the replay starts at
 * - Server pushes `cursor` periodically so the client can persist `lastSeq`
 * - `ready` is gone — its info now lives in `attached`
 * - `lifecycle` reports child-process events while the session stays alive
 *   (e.g. claude exited but session will respawn it)
 */

// ── client → server ─────────────────────────────────────────────────────────

export interface AttachMessage {
  readonly type: 'attach';
  readonly wsId: string;
  readonly cols: number;
  readonly rows: number;
  /** Seq the client last saw. If absent or stale, server treats as cold attach. */
  readonly since?: number;
}

export interface ResizeMessage {
  readonly type: 'resize';
  readonly cols: number;
  readonly rows: number;
}

export type ClientControlMessage = AttachMessage | ResizeMessage;

// ── server → client ─────────────────────────────────────────────────────────

export interface AttachedMessage {
  readonly type: 'attached';
  readonly wsId: string;
  /** Stable session record id. Same value across pause/resume of the same record. */
  readonly sessionId: string;
  /** Display name for tabs (e.g. "c1", "x2", "sh1"). */
  readonly name: string;
  readonly pid: number;
  readonly command: readonly string[];
  /** Seq the replay bytes (sent as binary frames just before this) start at. */
  readonly replayFromSeq: number;
  /** Seq of the byte just past the end of the replay (== buffer.tailSeq). */
  readonly seq: number;
  /** True if `since` in attach was older than the buffer's headSeq. */
  readonly scrollbackTruncated: boolean;
}

export interface CursorMessage {
  readonly type: 'cursor';
  readonly seq: number;
}

/** PTY's child (e.g. claude) ended but the session itself is sticking around. */
export interface ChildExitLifecycle {
  readonly type: 'lifecycle';
  readonly kind: 'child-exit';
  readonly code: number;
  readonly signal: number | null;
}

/** A new child has been spawned to replace one that exited. */
export interface ChildRespawnLifecycle {
  readonly type: 'lifecycle';
  readonly kind: 'child-respawn';
  readonly pid: number;
}

export type LifecycleMessage = ChildExitLifecycle | ChildRespawnLifecycle;

export interface ExitMessage {
  readonly type: 'exit';
  readonly code: number;
  readonly signal: number | null;
}

export type ServerControlMessage =
  | AttachedMessage
  | CursorMessage
  | LifecycleMessage
  | ExitMessage;

// ── runtime validators (used only by the server for client→server msgs) ─────

export function isClientControlMessage(value: unknown): value is ClientControlMessage {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  if (v['type'] === 'attach') {
    return (
      isNonEmptyString(v['wsId']) &&
      isPositiveInt(v['cols']) &&
      isPositiveInt(v['rows']) &&
      (v['since'] === undefined || isNonNegativeInt(v['since']))
    );
  }
  if (v['type'] === 'resize') {
    return isPositiveInt(v['cols']) && isPositiveInt(v['rows']);
  }
  return false;
}

function isNonEmptyString(x: unknown): x is string {
  return typeof x === 'string' && x.length > 0;
}

function isPositiveInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x > 0;
}

function isNonNegativeInt(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0;
}
