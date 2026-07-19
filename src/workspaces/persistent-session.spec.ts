/**
 * Regression tests for the backpressure-pause / socket-drop deadlock.
 *
 * The PTY read stream is paused when an attached WebSocket falls behind
 * (bufferedAmount >= high watermark). If that socket then dies *while paused*
 * — e.g. a vite ws-proxy ECONNRESET — the session must resume the PTY, or the
 * child blocks forever on its next stdout write ("running along and then
 * freezes"). These tests pin the resume on both the detach (socket dropped)
 * and the attach-kick (a new client replaces the stalled one) paths.
 *
 * node-pty is mocked so we can drive onData / pause / resume deterministically
 * without spawning a real child.
 */

import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as pty from 'node-pty';

import { PersistentSession, type PersistentSessionOptions } from './persistent-session.js';
import type { Logger } from './logger.js';
import type { TerminalViewAttributes } from './terminal-view-attributes.js';

vi.mock('node-pty', () => ({ spawn: vi.fn() }));

const mockSpawn = vi.mocked(pty.spawn);

/** Minimal IPty stand-in that lets the test inject PTY output and observe
 *  pause/resume calls. */
function makeFakeTerm() {
  let dataCb: ((d: unknown) => void) | undefined;
  return {
    pid: 4321,
    pause: vi.fn(),
    resume: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    write: vi.fn(),
    clear: vi.fn(),
    onData: (cb: (d: unknown) => void) => {
      dataCb = cb;
      return { dispose: () => {} };
    },
    onExit: () => ({ dispose: () => {} }),
    /** test helper — push bytes through the captured onData handler */
    emitData: (d: Buffer) => dataCb?.(d),
  };
}

/** ws.WebSocket stand-in: EventEmitter (for on/off) + send/close + the two
 *  fields the backpressure logic reads. */
class FakeWs extends EventEmitter {
  readonly OPEN = 1;
  readyState = 1;
  bufferedAmount = 0;
  send = vi.fn((data: unknown, optsOrCb?: unknown, cb?: unknown) => {
    const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
    if (typeof callback === 'function') callback(undefined);
  });
  close = vi.fn();
}

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  event: () => {},
  child: () => silentLogger,
};

function makeOptions(over: Partial<PersistentSessionOptions> = {}): PersistentSessionOptions {
  return {
    wsId: 'ws-1',
    recordId: 'rec-1',
    name: 'c1',
    command: ['claude'],
    cwd: '/tmp',
    env: {},
    initialCols: 80,
    initialRows: 24,
    logger: silentLogger,
    replayBufferBytes: 1 << 20,
    highWatermarkBytes: 1024, // small so one write trips backpressure
    lowWatermarkBytes: 256,
    onDisposed: () => {},
    ...over,
  };
}

function terminalViewAttributes(mode: 'dark' | 'light'): TerminalViewAttributes {
  return {
    foreground: mode === 'dark' ? [223, 225, 230] : [28, 42, 65],
    background: mode === 'dark' ? [11, 12, 14] : [251, 250, 246],
    cursor: [35, 185, 154],
    ansi: Array.from({ length: 256 }, (_, index) => [index, index, index]),
    colorSchemeMode: mode,
    cursorStyle: 'block',
    cursorBlink: true,
  };
}

describe('PersistentSession backpressure / socket-drop deadlock', () => {
  let term: ReturnType<typeof makeFakeTerm>;

  beforeEach(() => {
    term = makeFakeTerm();
    mockSpawn.mockReturnValue(term as unknown as pty.IPty);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('resumes the PTY when a backpressure-paused socket drops (detach)', () => {
    const session = new PersistentSession(makeOptions());
    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, undefined);

    // Socket is full: the next chunk of PTY output trips the high watermark
    // and pauses the read stream.
    ws.bufferedAmount = 2048;
    term.emitData(Buffer.from('a lot of output'));
    expect(term.pause).toHaveBeenCalledTimes(1);
    expect(term.resume).not.toHaveBeenCalled();

    // The socket dies mid-backpressure (ECONNRESET) → 'close' → detach().
    ws.emit('close');

    // Without the fix the PTY stays paused forever and the agent freezes.
    expect(term.resume).toHaveBeenCalledTimes(1);

    session.dispose('test');
  });

  it('resumes a stalled PTY when a new client kicks the old one (attach)', () => {
    const session = new PersistentSession(makeOptions());
    const ws1 = new FakeWs();
    session.attach(ws1 as never, 80, 24, undefined);

    ws1.bufferedAmount = 2048;
    term.emitData(Buffer.from('a lot of output'));
    expect(term.pause).toHaveBeenCalledTimes(1);

    // A fresh tab attaches and kicks ws1. The new attach must un-stick the PTY
    // even though the kick path (not detach) cleared the old socket.
    const ws2 = new FakeWs();
    session.attach(ws2 as never, 80, 24, undefined);

    expect(term.resume).toHaveBeenCalledTimes(1);

    session.dispose('test');
  });

  it('does not resume a PTY that was never paused', () => {
    const session = new PersistentSession(makeOptions());
    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, undefined);

    // Output flows while the socket drains fine — no pause, no resume churn.
    term.emitData(Buffer.from('small'));
    ws.emit('close');

    expect(term.pause).not.toHaveBeenCalled();
    expect(term.resume).not.toHaveBeenCalled();

    session.dispose('test');
  });

  it('writes browser stdin binary frames to the PTY byte-for-byte', () => {
    const session = new PersistentSession(makeOptions());
    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, undefined);

    const input = Buffer.from('，。\n', 'utf8');
    ws.emit('message', input, true);

    expect(term.write).toHaveBeenCalledTimes(1);
    const written = term.write.mock.calls[0]?.[0];
    expect(Buffer.isBuffer(written)).toBe(true);
    expect(Buffer.compare(written as Buffer, input)).toBe(0);

    session.dispose('test');
  });

  it('answers terminal capability queries while no renderer is attached', () => {
    const session = new PersistentSession(makeOptions({ command: ['opencode'] }));
    const terminalQuery = Buffer.from('\u001b[6n');
    term.emitData(terminalQuery);

    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, undefined);

    expect(term.write).toHaveBeenCalledOnce();
    expect(term.write).toHaveBeenCalledWith('\u001b[1;1R');

    session.dispose('test');
  });

  it('leaves terminal query replies to an attached renderer', () => {
    const session = new PersistentSession(makeOptions({ command: ['opencode'] }));
    const ws = new FakeWs();
    const terminalQuery = Buffer.from('\u001b[6n');
    const rendererReply = Buffer.from('\u001b[24;80R');
    session.attach(ws as never, 80, 24, undefined);
    term.write.mockClear();
    ws.send.mockImplementation((data: unknown, optsOrCb?: unknown, cb?: unknown) => {
      const callback = typeof optsOrCb === 'function' ? optsOrCb : cb;
      if (Buffer.isBuffer(data) && data.equals(terminalQuery)) {
        ws.emit('message', rendererReply, true);
      }
      if (typeof callback === 'function') callback(undefined);
    });

    term.emitData(terminalQuery);

    expect(term.write).toHaveBeenCalledOnce();
    expect(term.write).toHaveBeenCalledWith(rendererReply);

    session.dispose('test');
  });

  it('pushes mode 2031 theme flips only while the subscribed TUI is hidden', () => {
    const session = new PersistentSession(makeOptions({
      initialTerminalViewAttributes: terminalViewAttributes('dark'),
    }));
    term.emitData(Buffer.from('\x1b[?2031h'));
    term.write.mockClear();

    session.setTerminalViewAttributes(terminalViewAttributes('light'));
    expect(term.write).toHaveBeenCalledWith('\x1b[?997;2n');

    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, undefined);
    term.write.mockClear();
    session.setTerminalViewAttributes(terminalViewAttributes('dark'));
    expect(term.write).not.toHaveBeenCalled();

    session.dispose('test');
  });

  it('uses a compact current-screen snapshot for cold attach', () => {
    const session = new PersistentSession(makeOptions());
    const raw = Buffer.from('stale frame\x1b[2J\x1b[Hcurrent frame');
    term.emitData(raw);

    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, undefined);

    const binaryFrames = ws.send.mock.calls
      .map(([data]) => data)
      .filter((data): data is Buffer => Buffer.isBuffer(data));
    expect(binaryFrames).toHaveLength(1);
    expect(binaryFrames[0]?.toString('utf8')).toContain('current frame');
    expect(binaryFrames[0]?.toString('utf8')).not.toContain('stale frame');

    session.dispose('test');
  });

  it('keeps raw byte replay for hot attach cursors', () => {
    const session = new PersistentSession(makeOptions());
    const raw = Buffer.from('raw hot attach\x1b[6n');
    term.emitData(raw);

    const ws = new FakeWs();
    session.attach(ws as never, 80, 24, 0);

    const binaryFrames = ws.send.mock.calls
      .map(([data]) => data)
      .filter((data): data is Buffer => Buffer.isBuffer(data));
    expect(binaryFrames).toEqual([raw]);

    session.dispose('test');
  });
});

describe('PersistentSession controller lease', () => {
  let term: ReturnType<typeof makeFakeTerm>;

  beforeEach(() => {
    term = makeFakeTerm();
    mockSpawn.mockReturnValue(term as unknown as pty.IPty);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects a second controller without kicking the current controller', () => {
    const session = new PersistentSession(makeOptions());
    const ws1 = new FakeWs();
    const ws2 = new FakeWs();

    const first = session.attach(ws1 as never, 80, 24, undefined, {
      controllerId: 'web:tab-a',
      controllerKind: 'web',
    });
    expect(first.ok).toBe(true);

    const second = session.attach(ws2 as never, 80, 24, undefined, {
      controllerId: 'web:tab-b',
      controllerKind: 'web',
    });

    expect(second).toEqual({
      ok: false,
      reason: 'locked',
      owner: { id: 'web:tab-a', kind: 'web' },
    });
    expect(ws1.close).not.toHaveBeenCalled();
    expect(ws2.close).toHaveBeenCalledWith(4409, 'session locked by another controller');

    session.dispose('test');
  });

  it('allows an explicit takeover and kicks the previous controller', () => {
    const session = new PersistentSession(makeOptions());
    const ws1 = new FakeWs();
    const ws2 = new FakeWs();

    expect(session.attach(ws1 as never, 80, 24, undefined, {
      controllerId: 'web:tab-a',
      controllerKind: 'web',
    }).ok).toBe(true);

    const takeover = session.attach(ws2 as never, 80, 24, undefined, {
      controllerId: 'telegram:chat-1',
      controllerKind: 'telegram',
      takeover: true,
    });

    expect(takeover.ok).toBe(true);
    expect(ws1.close).toHaveBeenCalledWith(4001, 'kicked by new attach');
    expect(ws2.close).not.toHaveBeenCalled();

    session.dispose('test');
  });
});
