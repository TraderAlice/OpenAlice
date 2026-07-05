import { describe, expect, it } from 'vitest';

import { runHeadlessTask } from './headless-task.js';
import type { Logger } from './logger.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
} as unknown as Logger;

// node must resolve on PATH for these to spawn.
const baseEnv = { PATH: process.env['PATH'] ?? '' };

describe('runHeadlessTask', () => {
  it('captures clean exit + stdout tail on a one-shot command', async () => {
    const r = await runHeadlessTask({
      command: ['node', '-e', 'process.stdout.write("hello-headless")'],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 5_000,
      logger: noopLogger,
    });
    expect(r.exitCode).toBe(0);
    expect(r.killed).toBe(false);
    expect(r.stdoutTail).toContain('hello-headless');
  });

  it('keeps stdout and stderr separated (clean pipe, not a PTY)', async () => {
    const r = await runHeadlessTask({
      command: ['node', '-e', 'process.stdout.write("OUT"); process.stderr.write("ERR")'],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 5_000,
      logger: noopLogger,
    });
    expect(r.stdoutTail).toBe('OUT');
    expect(r.stderrTail).toBe('ERR');
  });

  it('watchdog SIGTERMs a process that overruns timeoutMs', async () => {
    const r = await runHeadlessTask({
      command: ['node', '-e', 'setInterval(() => {}, 1000)'],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 200,
      logger: noopLogger,
    });
    expect(r.killed).toBe(true);
    expect(r.signal === 'SIGTERM' || r.exitCode !== 0).toBe(true);
  });

  it('reports a missing binary as exitCode -1 instead of throwing', async () => {
    const r = await runHeadlessTask({
      command: ['definitely-not-a-real-binary-xyz123'],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 5_000,
      logger: noopLogger,
    });
    expect(r.exitCode).toBe(-1);
    expect(r.killed).toBe(false);
  });

  it('scans stdout lines for the agent session id and fires onSessionId once', async () => {
    // Emit a non-matching line, the id announcement, then another id-bearing
    // line — the scanner must stop at the FIRST match.
    const script =
      'process.stdout.write(\'{"type":"noise"}\\n\');' +
      'process.stdout.write(\'{"type":"session","id":"abc-123-def"}\\n\');' +
      'process.stdout.write(\'{"type":"session","id":"NOT-THIS-ONE"}\\n\');';
    const seen: string[] = [];
    const r = await runHeadlessTask({
      command: ['node', '-e', script],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 5_000,
      logger: noopLogger,
      extractSessionId: (line) => {
        try {
          const evt = JSON.parse(line) as Record<string, unknown>;
          return evt['type'] === 'session' && typeof evt['id'] === 'string' ? evt['id'] : null;
        } catch {
          return null;
        }
      },
      onSessionId: (id) => seen.push(id),
    });
    expect(r.agentSessionId).toBe('abc-123-def');
    expect(seen).toEqual(['abc-123-def']);
  });

  it('returns agentSessionId null when stdout never announces one', async () => {
    const r = await runHeadlessTask({
      command: ['node', '-e', 'process.stdout.write("plain text, no json\\n")'],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 5_000,
      logger: noopLogger,
      extractSessionId: () => null,
    });
    expect(r.agentSessionId).toBeNull();
  });

  it('streams the FULL stdout/stderr to log files (beyond the 16KB tails)', async () => {
    const { mkdtemp, readFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'headless-log-'));
    try {
      // 64KB of stdout — far past the 16KB tail budget.
      const script =
        'process.stdout.write("S".repeat(64 * 1024)); process.stderr.write("E-DIAG");';
      const stdoutFile = join(dir, 't1.stdout.log');
      const stderrFile = join(dir, 't1.stderr.log');
      const r = await runHeadlessTask({
        command: ['node', '-e', script],
        cwd: process.cwd(),
        env: baseEnv,
        timeoutMs: 10_000,
        logger: noopLogger,
        stdoutFile,
        stderrFile,
      });
      expect(r.exitCode).toBe(0);
      expect(r.stdoutTail.length).toBeLessThanOrEqual(16 * 1024); // tail stays bounded
      // The log file has everything. The write stream is end()ed at exit but
      // not awaited; poll briefly for the flush.
      let full = '';
      for (let i = 0; i < 40 && full.length < 64 * 1024; i++) {
        await new Promise((res) => setTimeout(res, 25));
        full = await readFile(stdoutFile, 'utf8').catch(() => '');
      }
      expect(full.length).toBe(64 * 1024);
      expect(await readFile(stderrFile, 'utf8')).toBe('E-DIAG');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
