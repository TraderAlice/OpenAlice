import { describe, expect, it, vi } from 'vitest';

import type { Logger } from './logger.js';

vi.mock('./win-command.js', () => ({
  resolveLaunchCommand: vi.fn(() => ({
    argv: ['node', '-e', 'process.stdout.write("shim-ok")'],
    viaShell: true,
  })),
}));

const { runHeadlessTask } = await import('./headless-task.js');

const noopLogger = {
  info() {},
  warn() {},
  error() {},
  debug() {},
  child() {
    return noopLogger;
  },
} as unknown as Logger;

describe('runHeadlessTask Windows shim guard', () => {
  it('rejects shell shims by default', async () => {
    const result = await runHeadlessTask({
      command: ['pi.cmd', '-p', 'user prompt'],
      cwd: process.cwd(),
      env: { PATH: process.env['PATH'] ?? '' },
      timeoutMs: 5_000,
      logger: noopLogger,
    });

    expect(result.exitCode).toBe(-1);
    expect(result.stderrTail).toContain('headless dispatch is unsupported');
  });

  it('allows shell shims for launcher-owned readiness probes', async () => {
    const result = await runHeadlessTask({
      command: ['pi.cmd', '-p', 'Reply exactly with OPENALICE_READY and no extra words.'],
      cwd: process.cwd(),
      env: { PATH: process.env['PATH'] ?? '' },
      timeoutMs: 5_000,
      logger: noopLogger,
      allowShellShim: true,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdoutTail).toBe('shim-ok');
  });
});
