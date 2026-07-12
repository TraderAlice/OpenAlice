import { mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { composeShellCommand } from './shell.js';

describe('composeShellCommand', () => {
  const cleanup: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  it('uses the managed shell when provided', () => {
    expect(composeShellCommand({
      OPENALICE_MANAGED_SHELL_PATH: 'C:\\OpenAlice\\vendor\\git\\win32-x64\\bin\\bash.exe',
      SHELL: '/bin/zsh',
    }, 'win32')).toEqual([
      'C:\\OpenAlice\\vendor\\git\\win32-x64\\bin\\bash.exe',
      '--login',
    ]);
  });

  it('falls back to ComSpec on unmanaged Windows hosts', () => {
    expect(composeShellCommand({
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }, 'win32')).toEqual(['C:\\Windows\\System32\\cmd.exe']);
  });

  it('uses Git Bash when Git for Windows adds only its cmd directory to PATH', async () => {
    const root = join(tmpdir(), `openalice-git-bash-${Date.now()}-${Math.random()}`);
    cleanup.push(root);
    await mkdir(join(root, 'cmd'), { recursive: true });
    await mkdir(join(root, 'bin'), { recursive: true });
    await writeFile(join(root, 'cmd', 'git.exe'), '');
    await writeFile(join(root, 'bin', 'bash.exe'), '');

    expect(composeShellCommand({
      PATH: [join(root, 'cmd'), 'C:\\Windows\\System32'].join(delimiter),
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
    }, 'win32')).toEqual([join(root, 'bin', 'bash.exe'), '--login']);
  });

  it('keeps POSIX login-shell behavior without a managed shell', () => {
    expect(composeShellCommand({ SHELL: '/bin/bash' }, 'darwin')).toEqual(['/bin/bash', '--login']);
    expect(composeShellCommand({}, 'darwin')).toEqual(['/bin/zsh', '--login']);
    expect(composeShellCommand({}, 'linux')).toEqual(['/bin/bash', '--login']);
  });
});
