import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { HeadlessTerminalSnapshot } from './headless-terminal-snapshot.js';
import type { Logger } from './logger.js';
import {
  PersistentSession,
  type PersistentSessionOptions,
} from './persistent-session.js';

const silentLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  event: () => {},
  child: () => silentLogger,
};

function makeFakeTerm() {
  let dataListener: ((data: Buffer | string) => void) | undefined;
  const exitListeners = new Set<(event: { exitCode: number; signal?: number }) => void>();
  return {
    pid: 1234,
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    onData(listener: (data: Buffer | string) => void) {
      dataListener = listener;
      return { dispose: () => { dataListener = undefined; } };
    },
    onExit(listener: (event: { exitCode: number; signal?: number }) => void) {
      exitListeners.add(listener);
      return { dispose: () => { exitListeners.delete(listener); } };
    },
    emitData(data: string) {
      dataListener?.(Buffer.from(data, 'utf8'));
    },
    emitExit(exitCode = 0) {
      for (const listener of exitListeners) listener({ exitCode });
    },
  };
}

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

describe('HeadlessTerminalSnapshot pointer state', () => {
  it('tracks the latest OSC title and resets it on dispose', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 100, rows: 12 });
    expect(terminal.getTitle()).toBe('');

    terminal.write('\x1b]0;first title\x07');
    expect(terminal.getTitle()).toBe('first title');
    terminal.write('\x1b]2;second title\x07');
    expect(terminal.getTitle()).toBe('second title');

    terminal.dispose();
    expect(terminal.getTitle()).toBe('');
  });

  it('detects braille, clock, and textual busy spinners without false positives', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 100, rows: 12 });
    try {
      expect(terminal.isSpinnerInTitle()).toBe(false);
      terminal.write('\x1b]0;agent ⠋\x07');
      expect(terminal.isSpinnerInTitle()).toBe(true);
      terminal.write('\x1b]0;agent ◐\x07');
      expect(terminal.isSpinnerInTitle()).toBe(true);
      terminal.write('\x1b]0;Thinking about the task\x07');
      expect(terminal.isSpinnerInTitle()).toBe(true);
      terminal.write('\x1b]0;Ready for input\x07');
      expect(terminal.isSpinnerInTitle()).toBe(false);
      terminal.write('\x1b]0;Notetworking\x07');
      expect(terminal.isSpinnerInTitle()).toBe(false);
    } finally {
      terminal.dispose();
    }
  });

  it('reads only non-empty screen-tail lines in top-to-bottom order', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 100, rows: 6 });
    try {
      terminal.write('one  \r\n\r\ntwo\t\r\nthree\r\nfour');
      expect(terminal.readScreenTail(2)).toEqual(['three', 'four']);
      expect(terminal.readScreenTail()).toEqual(['one', 'two', 'three', 'four']);
      expect(terminal.readScreenTail(0)).toEqual([]);
    } finally {
      terminal.dispose();
    }
    expect(terminal.readScreenTail()).toEqual([]);
  });

  it.each([
    'Allow this command once',
    'Approve the edit tool always',
    'Do you want to proceed?',
    'Do you want to make this edit now?',
    'Continue? [y/n]',
    'Continue? [Y/n]',
    'Continue? [yes/no]',
    'Yes, allow this operation',
  ])('detects interactive permission prompt %s', (prompt) => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 120, rows: 12 });
    try {
      terminal.write(`status\r\n${prompt}`);
      expect(terminal.isPermissionPromptVisible()).toBe(true);
    } finally {
      terminal.dispose();
    }
  });

  it('does not classify ordinary output as a permission prompt', () => {
    const terminal = new HeadlessTerminalSnapshot({ cols: 100, rows: 12 });
    try {
      terminal.write('Build complete\r\nReady for input');
      expect(terminal.isPermissionPromptVisible()).toBe(false);
    } finally {
      terminal.dispose();
    }
  });
});

describe('PersistentSession pointer delivery', () => {
  const sessions: PersistentSession[] = [];

  function startSession(overrides: Partial<PersistentSessionOptions> = {}) {
    const term = makeFakeTerm();
    const session = new PersistentSession({
      wsId: 'ws-1',
      recordId: 'record-1',
      name: 'agent',
      command: ['agent'],
      cwd: '/tmp',
      env: {},
      initialCols: 120,
      initialRows: 24,
      logger: silentLogger,
      replayBufferBytes: 1 << 20,
      highWatermarkBytes: 64 * 1024,
      lowWatermarkBytes: 16 * 1024,
      onDisposed: () => {},
      ...overrides,
      pty: { name: 'node-pty', supportsFlowControl: true, spawn: () => term },
    });
    sessions.push(session);
    return { session, term };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-08T12:00:00.000Z'));
  });

  afterEach(() => {
    for (const session of sessions) session.dispose('test complete');
    sessions.length = 0;
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it('requires both output and human-input quiescence windows', () => {
    const { session, term } = startSession();
    expect(session.isTuiSettledForDelivery()).toBe(false);

    vi.advanceTimersByTime(2999);
    expect(session.isTuiSettledForDelivery()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(session.isTuiSettledForDelivery()).toBe(true);

    vi.advanceTimersByTime(123);
    term.emitData('new output');
    expect(session.lastOutputAtMs).toBe(Date.now());
    expect(session.isTuiSettledForDelivery()).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(session.isTuiSettledForDelivery()).toBe(true);

    const ws = new FakeWs();
    session.attach(ws as never, 120, 24, undefined);
    ws.emit('message', Buffer.from('x'), true);
    expect(session.isTuiSettledForDelivery()).toBe(false);
    vi.advanceTimersByTime(2999);
    expect(session.isTuiSettledForDelivery()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(session.isTuiSettledForDelivery()).toBe(true);
  });

  it('blocks delivery while the OSC title contains a spinner', () => {
    const { session, term } = startSession();
    term.emitData('\x1b]0;agent ⣾ working\x07');
    vi.advanceTimersByTime(3000);
    expect(session.isTuiSettledForDelivery()).toBe(false);

    term.emitData('\x1b]0;Ready\x07');
    vi.advanceTimersByTime(3000);
    expect(session.isTuiSettledForDelivery()).toBe(true);
  });

  it('blocks delivery while a permission prompt is visible', () => {
    const { session, term } = startSession();
    term.emitData('Do you want to proceed? [y/n]');
    vi.advanceTimersByTime(3000);
    expect(session.isTuiSettledForDelivery()).toBe(false);
    expect(session.readScreenTail(1)).toEqual(['Do you want to proceed? [y/n]']);
  });

  it('sanitizes pointer text and writes Enter as a delayed second phase', async () => {
    const { session, term } = startSession();
    vi.advanceTimersByTime(3000);

    const pointer = session.sendPointerPrompt('  hello\r\n\x00world\x07  ', { enterDelayMs: 500 });
    expect(term.write).toHaveBeenCalledTimes(1);
    expect(term.write).toHaveBeenNthCalledWith(1, 'hello world');

    vi.advanceTimersByTime(499);
    expect(term.write).not.toHaveBeenCalledWith('\r');
    vi.advanceTimersByTime(1);

    await expect(pointer).resolves.toEqual({ ok: true });
    expect(term.write).toHaveBeenCalledTimes(2);
    expect(term.write).toHaveBeenNthCalledWith(2, '\r');
  });

  it('rejects unsettled and empty deliveries without writing', async () => {
    const { session, term } = startSession();
    await expect(session.sendPointerPrompt('wake up')).resolves.toEqual({
      ok: false,
      reason: 'not_settled',
    });
    await expect(session.sendPointerPrompt('\r\n\x00', { requireSettled: false })).resolves.toEqual({
      ok: false,
      reason: 'write_error',
    });
    expect(term.write).not.toHaveBeenCalled();
  });

  it('cancels pending Enter when human WebSocket input arrives', async () => {
    const { session, term } = startSession();
    const ws = new FakeWs();
    session.attach(ws as never, 120, 24, undefined);
    vi.advanceTimersByTime(3000);

    const pointer = session.sendPointerPrompt('wake up', { enterDelayMs: 500 });
    vi.advanceTimersByTime(250);
    ws.emit('message', Buffer.from('human input'), true);

    await expect(pointer).resolves.toEqual({ ok: false, reason: 'interrupted' });
    vi.advanceTimersByTime(500);
    expect(term.write).toHaveBeenCalledWith('wake up');
    expect(term.write).toHaveBeenCalledWith(Buffer.from('human input'));
    expect(term.write).not.toHaveBeenCalledWith('\r');
  });

  it('aborts pending Enter when a permission prompt appears', async () => {
    const { session, term } = startSession();
    vi.advanceTimersByTime(3000);

    const pointer = session.sendPointerPrompt('wake up', { enterDelayMs: 500 });
    vi.advanceTimersByTime(250);
    term.emitData('Allow this bash command once?');
    vi.advanceTimersByTime(250);

    await expect(pointer).resolves.toEqual({ ok: false, reason: 'interrupted' });
    expect(term.write).toHaveBeenCalledTimes(1);
    expect(term.write).toHaveBeenCalledWith('wake up');
  });

  it('notifies onQuiescent once after the latest output settles', () => {
    const onQuiescent = vi.fn();
    const { session, term } = startSession({ onQuiescent });

    term.emitData('working');
    vi.advanceTimersByTime(2000);
    term.emitData('still working');
    vi.advanceTimersByTime(2999);
    expect(onQuiescent).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onQuiescent).toHaveBeenCalledTimes(1);
    expect(onQuiescent).toHaveBeenCalledWith(session);
    vi.advanceTimersByTime(6000);
    expect(onQuiescent).toHaveBeenCalledTimes(1);
  });
});
