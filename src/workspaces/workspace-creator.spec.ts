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

import { orderCreateAdapters, resolveTemplateSource, runScript } from './workspace-creator.js';
import type { TemplateMeta } from './template-registry.js';

vi.mock('node:child_process', async (importOriginal) => ({
  ...await importOriginal<typeof import('node:child_process')>(),
  spawn: vi.fn(),
}));

// Shell discovery has its own filesystem tests. Keep these spawn-shape tests
// deterministic on Windows hosts that happen to have Git Bash installed.
vi.mock('@/core/shell-resolver.js', () => ({
  resolveBashPath: vi.fn(() => null),
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

describe('orderCreateAdapters', () => {
  const ALL = ['claude', 'codex', 'opencode', 'pi', 'shell'];

  it('uses template defaults only as a transient preparation order', () => {
    expect(orderCreateAdapters(['codex'], ALL)).toEqual([
      'codex', 'claude', 'opencode', 'pi', 'shell',
    ]);
  });

  it('first-wins dedupes when the head repeats a registered id', () => {
    expect(orderCreateAdapters(['pi', 'claude'], ALL)).toEqual([
      'pi', 'claude', 'codex', 'opencode', 'shell',
    ]);
  });

  it('keeps utility adapters behind agent runtimes', () => {
    expect(orderCreateAdapters(['shell', 'codex'], ALL)).toEqual([
      'codex', 'claude', 'opencode', 'pi', 'shell',
    ]);
  });

  it('falls back to registry order when a template has no defaults', () => {
    expect(orderCreateAdapters([], ALL)).toEqual(ALL);
  });

  it('ignores stale template defaults that are not registered', () => {
    expect(orderCreateAdapters(['future-agent', 'codex'], ALL)).toEqual([
      'codex', 'claude', 'opencode', 'pi', 'shell',
    ]);
  });
});

describe('resolveTemplateSource', () => {
  const template = {
    name: 'auto-quant-v2',
    bootstrapScript: '',
    filesDir: '',
    templateDir: '',
    version: '1.0.0',
    defaultAgents: ['codex'],
    injectTools: true,
    injectPersona: false,
    bundledSkills: [],
    source: {
      repository: 'https://github.com/TraderAlice/Auto-Quant-V2.git',
      defaultVersion: 'v0.8.31',
      versions: [
        { version: 'v0.8.31', commit: '426d815b18450172fbcf4c6b6af77c6ae05a4967' },
        { version: 'v0.8.30', commit: 'cba95f8718e8396a3147a9cc5f5275cd44feae5f' },
        { version: 'v0.8.27', commit: '4bf9eb45763776ab5fc2e02829b804594fc377a3' },
      ],
    },
  } satisfies TemplateMeta;

  it('uses the catalog default when the caller omits a version', () => {
    expect(resolveTemplateSource(template)).toEqual({
      version: 'v0.8.31',
      commit: '426d815b18450172fbcf4c6b6af77c6ae05a4967',
    });
  });

  it('keeps an older approved release selectable explicitly', () => {
    expect(resolveTemplateSource(template, 'v0.8.27')).toEqual({
      version: 'v0.8.27',
      commit: '4bf9eb45763776ab5fc2e02829b804594fc377a3',
    });
  });

  it('rejects versions outside the explicit source catalog', () => {
    expect(resolveTemplateSource(template, 'main')).toBeUndefined();
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
