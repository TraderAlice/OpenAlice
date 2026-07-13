import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { detectAgentBinary, detectBinary, findExecutableOnPath, runtimeInstallOverride } from './agent-detect.js';

let dir: string;

async function touch(name: string): Promise<string> {
  const p = join(dir, name);
  await writeFile(p, '');
  await chmod(p, 0o755);
  return p;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'agent-detect-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('findExecutableOnPath (posix)', () => {
  it('resolves a bare name to its absolute path on PATH', async () => {
    const p = await touch('claude');
    expect(findExecutableOnPath('claude', { platform: 'linux', env: { PATH: dir } })).toBe(p);
  });

  it('returns null when the binary is absent', () => {
    expect(findExecutableOnPath('codex', { platform: 'linux', env: { PATH: dir } })).toBeNull();
  });

  it('searches every PATH entry, not just the first', async () => {
    const other = await mkdtemp(join(tmpdir(), 'agent-detect-2-'));
    try {
      const p = await touch('pi');
      const env = { PATH: [other, dir].join(delimiter) };
      expect(findExecutableOnPath('pi', { platform: 'linux', env })).toBe(p);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('checks an explicit path directly without walking PATH', async () => {
    const p = await touch('opencode');
    expect(findExecutableOnPath(p, { platform: 'linux', env: { PATH: '' } })).toBe(p);
    expect(findExecutableOnPath(join(dir, 'nope'), { platform: 'linux', env: { PATH: dir } })).toBeNull();
  });
});

describe('findExecutableOnPath (win32)', () => {
  it('appends PATHEXT to a bare name', async () => {
    const p = await touch('codex.exe');
    const env = { PATH: dir, PATHEXT: '.COM;.EXE;.CMD' };
    expect(findExecutableOnPath('codex', { platform: 'win32', env })).toBe(p);
  });

  it('finds a .cmd npm shim when no .exe exists (opencode/pi case)', async () => {
    const p = await touch('opencode.cmd');
    const env = { PATH: dir, PATHEXT: '.COM;.EXE;.CMD' };
    expect(findExecutableOnPath('opencode', { platform: 'win32', env })).toBe(p);
  });
});

describe('detectBinary', () => {
  it('reports installed:true with the resolved path when present', async () => {
    const p = await touch('claude');
    expect(detectBinary('claude', { platform: 'linux', env: { PATH: dir } })).toEqual({
      installed: true,
      path: p,
    });
  });

  it('reports installed:false with null path when missing', () => {
    expect(detectBinary('claude', { platform: 'linux', env: { PATH: dir } })).toEqual({
      installed: false,
      path: null,
    });
  });
});

describe('detectAgentBinary', () => {
  it('reports managed Pi as installed before searching PATH', async () => {
    const managedPi = await touch('managed-pi');
    const pathPi = await touch('pi');
    expect(detectAgentBinary('pi', 'pi', {
      platform: 'linux',
      env: {
        OPENALICE_MANAGED_PI_PATH: managedPi,
        PATH: dir,
      },
    })).toEqual({ installed: true, path: managedPi });
    expect(findExecutableOnPath('pi', { platform: 'linux', env: { PATH: dir } })).toBe(pathPi);
  });

  it('falls back to PATH when managed Pi path is absent or invalid', async () => {
    const pathPi = await touch('pi');
    expect(detectAgentBinary('pi', 'pi', {
      platform: 'linux',
      env: {
        OPENALICE_MANAGED_PI_PATH: join(dir, 'missing-pi'),
        PATH: dir,
      },
    })).toEqual({ installed: true, path: pathPi });
  });
});

describe('runtimeInstallOverride', () => {
  it('only applies in onboarding test mode', () => {
    expect(runtimeInstallOverride('claude', { OPENALICE_AGENT_RUNTIME_INSTALLS: 'none' })).toBeNull();
  });

  it('can simulate no installed agent runtimes', () => {
    expect(runtimeInstallOverride('claude', {
      OPENALICE_ONBOARDING_TEST: '1',
      OPENALICE_AGENT_RUNTIME_INSTALLS: 'none',
    })).toEqual({ installed: false, path: null });
  });

  it('can simulate only selected installed runtimes', () => {
    const env = {
      OPENALICE_ONBOARDING_TEST: '1',
      OPENALICE_AGENT_RUNTIME_INSTALLS: 'only:codex,opencode',
    };
    expect(runtimeInstallOverride('codex', env)).toEqual({ installed: true, path: null });
    expect(runtimeInstallOverride('claude', env)).toEqual({ installed: false, path: null });
  });

  it('can simulate selected missing runtimes', () => {
    const env = {
      OPENALICE_ONBOARDING_TEST: '1',
      OPENALICE_AGENT_RUNTIME_INSTALLS: 'missing:pi',
    };
    expect(runtimeInstallOverride('codex', env)).toEqual({ installed: true, path: null });
    expect(runtimeInstallOverride('pi', env)).toEqual({ installed: false, path: null });
  });
});
