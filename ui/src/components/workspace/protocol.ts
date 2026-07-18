/**
 * Mirror of server/src/protocol.ts. Kept as a separate file so the two
 * packages stay independently buildable without a shared workspace.
 */

// ── client → server ─────────────────────────────────────────────────────────

export interface AttachMessage {
  readonly type: 'attach';
  readonly wsId: string;
  readonly cols: number;
  readonly rows: number;
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
  /** Stable session record id. */
  readonly sessionId: string;
  readonly name: string;
  readonly pid: number;
  readonly command: readonly string[];
  readonly replayFromSeq: number;
  readonly seq: number;
  readonly scrollbackTruncated: boolean;
  readonly kittyKeyboardFlags: number;
}

export interface CursorMessage {
  readonly type: 'cursor';
  readonly seq: number;
}

export interface ChildExitLifecycle {
  readonly type: 'lifecycle';
  readonly kind: 'child-exit';
  readonly code: number;
  readonly signal: number | null;
}

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

// ── parser ──────────────────────────────────────────────────────────────────

export function parseServerControl(text: string): ServerControlMessage | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  switch (v['type']) {
    case 'attached':
      if (
        typeof v['wsId'] === 'string' &&
        typeof v['sessionId'] === 'string' &&
        typeof v['name'] === 'string' &&
        typeof v['pid'] === 'number' &&
        Array.isArray(v['command']) &&
        v['command'].every((c) => typeof c === 'string') &&
        typeof v['replayFromSeq'] === 'number' &&
        typeof v['seq'] === 'number' &&
        typeof v['scrollbackTruncated'] === 'boolean'
      ) {
        return {
          type: 'attached',
          wsId: v['wsId'],
          sessionId: v['sessionId'],
          name: v['name'],
          pid: v['pid'],
          command: v['command'] as string[],
          replayFromSeq: v['replayFromSeq'],
          seq: v['seq'],
          scrollbackTruncated: v['scrollbackTruncated'],
          kittyKeyboardFlags:
            typeof v['kittyKeyboardFlags'] === 'number' ? v['kittyKeyboardFlags'] : 0,
        };
      }
      return null;
    case 'cursor':
      if (typeof v['seq'] === 'number') {
        return { type: 'cursor', seq: v['seq'] };
      }
      return null;
    case 'lifecycle':
      if (v['kind'] === 'child-exit' && typeof v['code'] === 'number') {
        return {
          type: 'lifecycle',
          kind: 'child-exit',
          code: v['code'],
          signal: typeof v['signal'] === 'number' ? v['signal'] : null,
        };
      }
      if (v['kind'] === 'child-respawn' && typeof v['pid'] === 'number') {
        return { type: 'lifecycle', kind: 'child-respawn', pid: v['pid'] };
      }
      return null;
    case 'exit':
      if (typeof v['code'] === 'number') {
        return {
          type: 'exit',
          code: v['code'],
          signal: typeof v['signal'] === 'number' ? v['signal'] : null,
        };
      }
      return null;
    default:
      return null;
  }
}
