import { delimiter } from 'node:path';

import { describe, expect, it } from 'vitest';

import { runtimeProfileFromEnv } from './runtime-profile.js';

describe('runtimeProfileFromEnv', () => {
  it('defaults to dev with no managed runtime paths', () => {
    expect(runtimeProfileFromEnv({}, {
      appHome: '/app',
      userDataHome: '/home/openalice',
      nodeExecPath: '/electron',
      platform: 'linux',
      arch: 'x64',
    })).toEqual({
      launcher: 'dev',
      platform: 'linux',
      arch: 'x64',
      appHome: '/app',
      userDataHome: '/home/openalice',
      nodeExecPath: '/electron',
      managedPiPath: null,
      managedPiNodePath: null,
      managedGitDir: null,
      managedGitBin: null,
      managedShellPath: null,
      managedToolchainPath: [],
    });
  });

  it('parses managed runtime capability paths from env', () => {
    const env = {
      OPENALICE_RUNTIME_PROFILE: 'electron-packaged',
      OPENALICE_APP_HOME: '/Applications/OpenAlice.app/Contents/Resources/app',
      OPENALICE_HOME: '/Users/alice/.openalice',
      OPENALICE_MANAGED_PI_PATH: '/app/vendor/pi/pi',
      OPENALICE_MANAGED_PI_NODE_PATH: '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
      OPENALICE_MANAGED_GIT_DIR: '/app/vendor/git/win32-x64',
      OPENALICE_MANAGED_GIT_BIN: '/app/vendor/git/win32-x64/cmd/git.exe',
      OPENALICE_MANAGED_SHELL_PATH: '/app/vendor/git/win32-x64/bin/bash.exe',
      OPENALICE_MANAGED_TOOLCHAIN_PATH: ['/tool/bin', '/tool/usr/bin'].join(delimiter),
    };
    expect(runtimeProfileFromEnv(env, {
      nodeExecPath: '/electron',
      platform: 'darwin',
      arch: 'arm64',
    })).toMatchObject({
      launcher: 'electron-packaged',
      appHome: '/Applications/OpenAlice.app/Contents/Resources/app',
      userDataHome: '/Users/alice/.openalice',
      nodeExecPath: '/electron',
      managedPiPath: '/app/vendor/pi/pi',
      managedPiNodePath: '/Applications/OpenAlice.app/Contents/MacOS/OpenAlice',
      managedGitDir: '/app/vendor/git/win32-x64',
      managedGitBin: '/app/vendor/git/win32-x64/cmd/git.exe',
      managedShellPath: '/app/vendor/git/win32-x64/bin/bash.exe',
      managedToolchainPath: ['/tool/bin', '/tool/usr/bin'],
    });
  });

  it('maps legacy OPENALICE_LAUNCHER values into a launcher profile', () => {
    expect(runtimeProfileFromEnv({ OPENALICE_LAUNCHER: 'electron' }).launcher).toBe('electron-dev');
    expect(runtimeProfileFromEnv({ OPENALICE_LAUNCHER: 'docker' }).launcher).toBe('docker');
  });
});
