import { describe, expect, it } from 'vitest';

import { composeShellCommand } from './shell.js';

describe('composeShellCommand', () => {
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

  it('keeps POSIX login-shell behavior without a managed shell', () => {
    expect(composeShellCommand({ SHELL: '/bin/bash' }, 'darwin')).toEqual(['/bin/bash', '--login']);
    expect(composeShellCommand({}, 'linux')).toEqual(['/bin/zsh', '--login']);
  });
});
