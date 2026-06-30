/**
 * Tests for runScript() — focuses on the platform branch added for
 * Windows compatibility. The actual subprocess is mocked; we only
 * verify the spawn call shape (cmd + args) and the ENOENT-on-Windows
 * error message.
 *
 * We can't run the real bash on a non-Windows CI when testing the
 * win32 branch (and vice versa on Windows), so this test stubs
 * `process.platform` and `child_process.spawn` to exercise both
 * branches deterministically regardless of where vitest runs.
 */

import { EventEmitter } from 'node:events';
import * as childProcess from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { resolveCreateAgents, runScript } from './workspace-creator.js';

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

const mockSpawn = vi.mocked(childProcess.spawn);

interface FakeChild extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
}

function makeFakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  child.exitCode = null;
  return child;
}

function setPlatform(value: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value, configurable: true });
}

describe('resolveCreateAgents — single home of the agent policy', () => {
  const ALL = ['claude', 'codex', 'opencode', 'pi', 'shell'];

  it('enables EVERY registered adapter when the caller pins nothing', () => {
    // The quick-chat bug: it called create() with no explicit set, so it used
    // to get only the template head (claude+codex). Policy now expands here.
    expect(resolveCreateAgents(undefined, ['claude', 'codex'], ALL)).toEqual(ALL);
  });

  it('honors template defaultAgents as the agent-runtime order head', () => {
    // A template that wants codex first still gets all four, codex leading.
    expect(resolveCreateAgents(undefined, ['codex'], ALL)).toEqual([
      'codex', 'claude', 'opencode', 'pi', 'shell',
    ]);
  });

  it('first-wins dedupes when the head repeats a registered id', () => {
    expect(resolveCreateAgents(undefined, ['pi', 'claude'], ALL)).toEqual([
      'pi', 'claude', 'codex', 'opencode', 'shell',
    ]);
  });

  it('keeps shell enabled but never ahead of agent runtimes', () => {
    expect(resolveCreateAgents(undefined, ['shell', 'codex'], ALL)).toEqual([
      'codex', 'claude', 'opencode', 'pi', 'shell',
    ]);
  });

  it('an explicit non-empty request wins verbatim (subset pinning)', () => {
    expect(resolveCreateAgents(['claude'], ['claude', 'codex'], ALL)).toEqual(['claude']);
  });

  it('treats an empty explicit request as "not pinned" → full expansion', () => {
    expect(resolveCreateAgents([], ['claude', 'codex'], ALL)).toEqual(ALL);
  });
});

describe('runScript platform branching', () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    setPlatform(originalPlatform);
    mockSpawn.mockReset();
  });

  it('on macOS / Linux, spawns the script directly so kernel reads the shebang', async () => {
    setPlatform('darwin');
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child as unknown as childProcess.ChildProcess);

    const promise = runScript('/tmp/foo/bootstrap.sh', ['tag-1', '/out'], { FOO: 'bar' }, 60_000);
    child.emit('close', 0);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledTimes(1);
    expect(mockSpawn).toHaveBeenCalledWith(
      '/tmp/foo/bootstrap.sh',
      ['tag-1', '/out'],
      expect.objectContaining({
        env: expect.objectContaining({ FOO: 'bar' }),
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    );
  });

  it('on win32, wraps bash with the script as first arg (kernel does not read shebang)', async () => {
    setPlatform('win32');
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child as unknown as childProcess.ChildProcess);

    const promise = runScript(
      'C:\\Users\\me\\templates\\chat\\bootstrap.sh',
      ['tag-1', 'C:\\out'],
      {},
      60_000,
    );
    child.emit('close', 0);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      'bash',
      ['C:\\Users\\me\\templates\\chat\\bootstrap.sh', 'tag-1', 'C:\\out'],
      expect.any(Object),
    );
  });

  it('a .mjs bootstrap runs on the bundled Node (process.execPath), NOT bash, on win32', async () => {
    setPlatform('win32');
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child as unknown as childProcess.ChildProcess);

    const promise = runScript(
      'C:\\Users\\me\\templates\\chat\\bootstrap.mjs',
      ['tag-1', 'C:\\out'],
      { FOO: 'bar' },
      60_000,
    );
    child.emit('close', 0);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      ['C:\\Users\\me\\templates\\chat\\bootstrap.mjs', 'tag-1', 'C:\\out'],
      expect.objectContaining({
        env: expect.objectContaining({ FOO: 'bar', ELECTRON_RUN_AS_NODE: '1' }),
      }),
    );
  });

  it('a .mjs bootstrap runs on process.execpath on macOS too (no shebang/bash reliance)', async () => {
    setPlatform('darwin');
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child as unknown as childProcess.ChildProcess);

    const promise = runScript('/tmp/foo/bootstrap.mjs', ['t', '/out'], {}, 60_000);
    child.emit('close', 0);
    const res = await promise;

    expect(res.ok).toBe(true);
    expect(mockSpawn).toHaveBeenCalledWith(
      process.execPath,
      ['/tmp/foo/bootstrap.mjs', 't', '/out'],
      expect.objectContaining({ env: expect.objectContaining({ ELECTRON_RUN_AS_NODE: '1' }) }),
    );
  });

  it('on win32, ENOENT spawn error surfaces a Git-for-Windows install hint', async () => {
    setPlatform('win32');
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child as unknown as childProcess.ChildProcess);

    const promise = runScript('C:\\bootstrap.sh', [], {}, 60_000);
    child.emit('error', new Error('spawn bash ENOENT'));
    const res = await promise;

    expect(res.ok).toBe(false);
    expect(res.stderr).toMatch(/spawn bash ENOENT/);
    expect(res.stderr).toMatch(/gitforwindows\.org/);
    expect(res.stderr).toMatch(/WSL2/);
  });

  it('on macOS / Linux, ENOENT does NOT add the Windows hint', async () => {
    setPlatform('darwin');
    const child = makeFakeChild();
    mockSpawn.mockReturnValue(child as unknown as childProcess.ChildProcess);

    const promise = runScript('/tmp/missing.sh', [], {}, 60_000);
    child.emit('error', new Error('spawn /tmp/missing.sh ENOENT'));
    const res = await promise;

    expect(res.ok).toBe(false);
    expect(res.stderr).not.toMatch(/gitforwindows\.org/);
  });
});
