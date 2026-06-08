import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveLaunchCommand } from './win-command.js';

// A fake Windows PATHEXT — order intentionally puts .CMD before .EXE to prove
// the resolver prefers a real executable regardless of PATHEXT ordering.
const PATHEXT = '.CMD;.EXE;.BAT;.PS1';

let dir: string;
let env: NodeJS.ProcessEnv;

async function touch(name: string): Promise<void> {
  await writeFile(join(dir, name), '');
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'wincmd-'));
  env = { PATH: dir, PATHEXT, ComSpec: 'C:\\Windows\\System32\\cmd.exe' };
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('resolveLaunchCommand', () => {
  it('is the identity function off win32', () => {
    const r = resolveLaunchCommand(['pi', '--continue'], { platform: 'linux', env });
    expect(r).toEqual({ argv: ['pi', '--continue'], viaShell: false });
  });

  it('win32: a native .exe resolves to its full path, run directly', async () => {
    await touch('codex.exe');
    const r = resolveLaunchCommand(['codex', 'exec'], { platform: 'win32', env });
    expect(r.viaShell).toBe(false);
    expect(r.argv).toEqual([join(dir, 'codex.exe'), 'exec']);
  });

  it('win32: a .cmd npm shim is wrapped through cmd.exe', async () => {
    await touch('pi.cmd');
    const r = resolveLaunchCommand(['pi', '--session-id', 'abc'], { platform: 'win32', env });
    expect(r.viaShell).toBe(true);
    expect(r.argv).toEqual([
      'C:\\Windows\\System32\\cmd.exe',
      '/d',
      '/c',
      join(dir, 'pi.cmd'),
      '--session-id',
      'abc',
    ]);
  });

  it('win32: prefers .exe over a .cmd shim when both exist', async () => {
    await touch('opencode.cmd');
    await touch('opencode.exe');
    const r = resolveLaunchCommand(['opencode', 'run'], { platform: 'win32', env });
    expect(r.viaShell).toBe(false);
    expect(r.argv).toEqual([join(dir, 'opencode.exe'), 'run']);
  });

  it('win32: an unresolved name passes through unchanged (fails loudly later)', () => {
    const r = resolveLaunchCommand(['nope', '--x'], { platform: 'win32', env });
    expect(r).toEqual({ argv: ['nope', '--x'], viaShell: false });
  });

  it('win32: a name with an explicit extension is trusted, not re-resolved', async () => {
    await touch('pi.cmd');
    const r = resolveLaunchCommand(['pi.cmd', '-p'], { platform: 'win32', env });
    expect(r).toEqual({ argv: ['pi.cmd', '-p'], viaShell: false });
  });

  it('win32: a name that is already a path is trusted as-is', () => {
    const r = resolveLaunchCommand(['C:\\tools\\pi', '-p'], { platform: 'win32', env });
    expect(r).toEqual({ argv: ['C:\\tools\\pi', '-p'], viaShell: false });
  });

  it('win32: searches multiple PATH entries', async () => {
    const other = await mkdtemp(join(tmpdir(), 'wincmd2-'));
    try {
      await writeFile(join(other, 'claude.exe'), '');
      const r = resolveLaunchCommand(['claude'], {
        platform: 'win32',
        env: { ...env, PATH: `${dir}${delimiter}${other}` },
      });
      expect(r.argv).toEqual([join(other, 'claude.exe')]);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('falls back to a default PATHEXT when the env var is absent', async () => {
    await touch('pi.cmd');
    const r = resolveLaunchCommand(['pi'], {
      platform: 'win32',
      env: { PATH: dir, ComSpec: 'cmd.exe' },
    });
    expect(r.viaShell).toBe(true);
    expect(r.argv[0]).toBe('cmd.exe');
    expect(r.argv).toContain(join(dir, 'pi.cmd'));
  });

  it('handles an empty argv', () => {
    expect(resolveLaunchCommand([], { platform: 'win32', env })).toEqual({
      argv: [],
      viaShell: false,
    });
  });
});
