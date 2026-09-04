import { describe, expect, it, vi } from 'vitest';
import { createBunPtyBackend } from './pty-bun.js';

describe('Bun Windows ConPTY boundary', () => {
  it('preserves input, resize, and child termination without pretending to pause a POSIX group', () => {
    const terminal = { write: vi.fn(() => 1), resize: vi.fn(), close: vi.fn() };
    const child = { pid: 42, terminal, kill: vi.fn() };
    const spawn = vi.fn(() => child);
    const backend = createBunPtyBackend({ spawn }, 'win32');
    const term = backend.spawn('agent.exe', ['argument'], {
      name: 'xterm', cols: 80, rows: 24, cwd: 'workspace', env: {},
    });
    expect(backend.supportsFlowControl).toBe(false);
    expect(term.pause).toBeUndefined();
    expect(term.resume).toBeUndefined();
    term.write('hello\r');
    term.resize(120, 40);
    term.kill('SIGTERM');
    expect(terminal.write).toHaveBeenCalledWith('hello\r');
    expect(terminal.resize).toHaveBeenCalledWith(120, 40);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(terminal.close).not.toHaveBeenCalled();
  });
});
