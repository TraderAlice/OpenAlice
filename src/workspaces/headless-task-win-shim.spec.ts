import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { Logger } from './logger.js';

vi.mock('./win-command.js', () => ({
  resolveLaunchCommand: vi.fn(() => ({
    argv: ['node', '-e', 'process.stdout.write("shim-ok")'],
    viaShell: true,
    mode: 'cmd-shim',
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
    const dir = await mkdtemp(join(tmpdir(), 'headless-shim-'));
    try {
      const stderrFile = join(dir, 'run.stderr.log');
      const result = await runHeadlessTask({
        command: ['pi.cmd', '-p', 'user prompt'],
        cwd: process.cwd(),
        env: { PATH: process.env['PATH'] ?? '' },
        timeoutMs: 5_000,
        logger: noopLogger,
        stderrFile,
      });

      expect(result).toMatchObject({
        exitCode: -1,
        processStarted: false,
        launchErrorCode: 'unsupported_windows_batch_shim',
      });
      expect(result.error).toContain('batch-only shim');
      expect(result.stderrTail).toContain('will not route an unattended task prompt through cmd.exe');
      await expect(readFile(stderrFile, 'utf8')).resolves.toContain('batch-only shim');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
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
    expect(result.processStarted).toBe(true);
    expect(result.launchErrorCode).toBeUndefined();
    expect(result.stdoutTail).toBe('shim-ok');
  });
});
