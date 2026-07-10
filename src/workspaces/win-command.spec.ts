import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { resolveLaunchCommand, resolveStockNpmShim } from './win-command.js';

// A fake Windows PATHEXT — order intentionally puts .CMD before .EXE to prove
// the resolver prefers a real executable regardless of PATHEXT ordering.
const PATHEXT = '.CMD;.EXE;.BAT;.PS1';

let dir: string;
let env: NodeJS.ProcessEnv;

async function touch(name: string): Promise<void> {
  await writeFile(join(dir, name), '');
}

async function stockNpmShim(name: string, entry = 'node_modules\\pkg\\cli.js'): Promise<void> {
  await writeFile(join(dir, name), `@ECHO off\n"%_prog%"  "%dp0%\\${entry}" %*\n`);
  const entryPath = join(dir, ...entry.split('\\'));
  await mkdir(dirname(entryPath), { recursive: true });
  await writeFile(entryPath, '');
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

  it('win32: runs a stock npm shim entrypoint directly with Node', async () => {
    await stockNpmShim('pi.cmd');
    const nodeExecPath = 'C:\\Program Files\\nodejs\\node.exe';
    const r = resolveLaunchCommand(['pi', '-p', 'a & b'], {
      platform: 'win32',
      env,
      nodeExecPath,
    });
    expect(r).toEqual({
      argv: [nodeExecPath, join(dir, 'node_modules', 'pkg', 'cli.js'), '-p', 'a & b'],
      viaShell: false,
    });
  });

  it('win32: runs a stock pnpm linked-bin shim directly with Node', async () => {
    const nodeModules = join(dir, 'node_modules');
    const bin = join(nodeModules, '.bin');
    const entry = join(nodeModules, 'tsx', 'dist', 'cli.mjs');
    const shim = join(bin, 'tsx.cmd');
    await mkdir(join(nodeModules, 'tsx', 'dist'), { recursive: true });
    await mkdir(bin, { recursive: true });
    await writeFile(entry, '');
    await writeFile(shim, [
      '@IF EXIST "%~dp0\\node.exe" (',
      '  "%~dp0\\node.exe" "%~dp0\\..\\tsx\\dist\\cli.mjs" %*',
      ') ELSE (',
      '  node "%~dp0\\..\\tsx\\dist\\cli.mjs" %*',
      ')',
    ].join('\n'));

    expect(resolveStockNpmShim(shim, ['watch', 'app.ts'], 'node.exe')).toEqual([
      'node.exe', entry, 'watch', 'app.ts',
    ]);
  });

  it('win32: refuses to direct-run an npm-shaped shim outside its directory', async () => {
    await touch('pi.cmd');
    await writeFile(
      join(dir, 'pi.cmd'),
      '@ECHO off\n"%_prog%" "%dp0%\\..\\outside\\cli.js" %*\n',
    );
    const r = resolveLaunchCommand(['pi', '-p', 'hello'], { platform: 'win32', env });
    expect(r.viaShell).toBe(true);
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
