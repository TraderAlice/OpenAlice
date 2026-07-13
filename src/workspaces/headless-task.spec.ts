import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { headlessTaskStatus, runHeadlessTask } from './headless-task.js';
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

  it('decodes the latest completed assistant reply from structured stdout', async () => {
    const first = JSON.stringify({ type: 'assistant', text: 'Hello' });
    const second = JSON.stringify({ type: 'assistant', text: 'Hello 👋' });
    const script =
      `process.stdout.write(${JSON.stringify(first + '\n')});` +
      `process.stdout.write(${JSON.stringify(second)});`;
    const r = await runHeadlessTask({
      command: ['node', '-e', script],
      cwd: process.cwd(),
      env: baseEnv,
      timeoutMs: 5_000,
      logger: noopLogger,
      extractAssistantText: (line) => {
        throw new Error(`structured translator should own text parsing: ${line}`);
      },
      extractOutputEvents: (line) => {
        try {
          const evt = JSON.parse(line) as Record<string, unknown>;
          return evt['type'] === 'assistant' && typeof evt['text'] === 'string'
            ? [{ type: 'text' as const, text: evt['text'] }]
            : [];
        } catch {
          return [];
        }
      },
    });
    expect(r.assistantText).toBe('Hello 👋');
    expect(r.structured.assistantText).toBe('Hello 👋');
    expect(r.structured.blocks).toHaveLength(2);
  });

  it('streams stdout/stderr diagnostics beyond the 16KB in-memory tails', async () => {
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
      // This output is below the 16MB raw cap, so the log file has everything.
      // The write stream is end()ed at exit but
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

  it('compacts line-oriented diagnostics without hiding lines from structured parsing', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'headless-filtered-log-'));
    try {
      const stdoutFile = join(dir, 't1.stdout.log');
      const lines = [
        JSON.stringify({ type: 'message_update', text: 'cumulative snapshot' }),
        JSON.stringify({ type: 'tool_execution_update', text: 'partial tool output' }),
        JSON.stringify({ type: 'message_end', text: 'Final reply' }),
      ];
      const seen: string[] = [];
      const result = await runHeadlessTask({
        command: ['node', '-e', `process.stdout.write(${JSON.stringify(`${lines.join('\n')}\n`)})`],
        cwd: process.cwd(),
        env: baseEnv,
        timeoutMs: 5_000,
        logger: noopLogger,
        stdoutFile,
        keepDiagnosticLine: (line) => !line.includes('_update"'),
        extractOutputEvents: (line) => {
          seen.push(line);
          const event = JSON.parse(line) as { type?: string; text?: string };
          return event.type === 'message_end' && event.text
            ? [{ type: 'text' as const, text: event.text }]
            : [];
        },
      });
      let diagnostic = '';
      for (let i = 0; i < 40 && !diagnostic.includes('message_end'); i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        diagnostic = await readFile(stdoutFile, 'utf8').catch(() => '');
      }
      expect(seen).toHaveLength(3);
      expect(result.structured.assistantText).toBe('Final reply');
      expect(result.stdoutTail).toContain('message_end');
      expect(result.stdoutTail).not.toContain('message_update');
      expect(diagnostic).toContain('message_end');
      expect(diagnostic).not.toContain('message_update');
      expect(diagnostic).not.toContain('tool_execution_update');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('writes a compact structured snapshot for live Automation polling', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'headless-structured-'));
    try {
      const structuredFile = join(dir, 't1.structured.json');
      const event = JSON.stringify({ type: 'assistant', text: 'Snapshot reply' });
      const result = await runHeadlessTask({
        command: ['node', '-e', `process.stdout.write(${JSON.stringify(`${event}\n`)})`],
        cwd: process.cwd(),
        env: baseEnv,
        timeoutMs: 5_000,
        logger: noopLogger,
        structuredFile,
        extractAssistantText: (line) => {
          const parsed = JSON.parse(line) as { type?: string; text?: string };
          return parsed.type === 'assistant' ? parsed.text ?? null : null;
        },
        extractOutputEvents: (line) => {
          const parsed = JSON.parse(line) as { type?: string; text?: string };
          return parsed.type === 'assistant' && parsed.text
            ? [{ type: 'text' as const, text: parsed.text }]
            : [];
        },
      });
      const stored = JSON.parse(await readFile(structuredFile, 'utf8')) as typeof result.structured;
      expect(stored).toEqual(result.structured);
      expect(stored.assistantText).toBe('Snapshot reply');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('caps each diagnostic stream at 16MB', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'headless-log-cap-'));
    try {
      const stdoutFile = join(dir, 't1.stdout.log');
      const result = await runHeadlessTask({
        command: ['node', '-e', 'process.stdout.write(Buffer.alloc(17 * 1024 * 1024, 83))'],
        cwd: process.cwd(),
        env: baseEnv,
        timeoutMs: 10_000,
        logger: noopLogger,
        stdoutFile,
      });
      expect(result.exitCode).toBe(0);
      let size = 0;
      for (let i = 0; i < 80 && size < 16 * 1024 * 1024; i++) {
        await new Promise((resolve) => setTimeout(resolve, 25));
        size = (await stat(stdoutFile).catch(() => ({ size: 0 }))).size;
      }
      const stored = await readFile(stdoutFile, 'utf8');
      expect(size).toBeLessThan(16 * 1024 * 1024 + 256);
      expect(stored).toContain('diagnostic log capped at 16MB');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('headlessTaskStatus', () => {
  const structured = (blocks: Array<{ type: 'error'; message: string } | { type: 'text'; text: string }>) => ({
    schemaVersion: 1 as const,
    assistantText: blocks.findLast((block) => block.type === 'text')?.text ?? null,
    blocks,
    metrics: {
      textBlocks: blocks.filter((block) => block.type === 'text').length,
      toolCalls: 0,
      toolFailures: 0,
    },
    truncated: false,
  });

  it('keeps a recovered runtime retry as done', () => {
    expect(headlessTaskStatus({
      exitCode: 0,
      killed: false,
      structured: structured([
        { type: 'error', message: 'Reconnecting... 2/5' },
        { type: 'text', text: 'Recovered reply' },
      ]),
    })).toBe('done');
  });

  it('fails a terminal runtime error even when earlier text was emitted', () => {
    expect(headlessTaskStatus({
      exitCode: 0,
      killed: false,
      structured: structured([
        { type: 'text', text: 'Partial reply' },
        { type: 'error', message: 'Provider unavailable' },
      ]),
    })).toBe('failed');
  });

  it('fails killed and non-zero-exit runs', () => {
    const output = structured([{ type: 'text', text: 'Reply before exit' }]);
    expect(headlessTaskStatus({ exitCode: 0, killed: true, structured: output })).toBe('failed');
    expect(headlessTaskStatus({ exitCode: 1, killed: false, structured: output })).toBe('failed');
  });
});
