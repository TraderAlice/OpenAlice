import { delimiter } from 'node:path';

import { appResourcesHome, userDataHome } from './paths.js';

export type RuntimeLauncher = 'dev' | 'electron-dev' | 'electron-packaged' | 'docker';
type EnvLike = Readonly<Record<string, string | undefined>>;

export interface RuntimeProfile {
  readonly launcher: RuntimeLauncher;
  readonly platform: NodeJS.Platform;
  readonly arch: NodeJS.Architecture;
  readonly appHome: string;
  readonly userDataHome: string;
  readonly nodeExecPath: string;
  readonly managedPiPath: string | null;
  readonly managedPiNodePath: string | null;
  readonly managedGitDir: string | null;
  readonly managedGitBin: string | null;
  readonly managedShellPath: string | null;
  readonly managedToolchainPath: readonly string[];
}

export function runtimeProfileFromEnv(
  env: EnvLike = process.env,
  opts: {
    readonly platform?: NodeJS.Platform;
    readonly arch?: NodeJS.Architecture;
    readonly nodeExecPath?: string;
    readonly appHome?: string;
    readonly userDataHome?: string;
  } = {},
): RuntimeProfile {
  return {
    launcher: normalizeLauncher(env['OPENALICE_RUNTIME_PROFILE'], env['OPENALICE_LAUNCHER']),
    platform: opts.platform ?? process.platform,
    arch: opts.arch ?? process.arch,
    appHome: cleanPath(opts.appHome) ?? cleanPath(env['OPENALICE_APP_HOME']) ?? appResourcesHome,
    userDataHome: cleanPath(opts.userDataHome) ?? cleanPath(env['OPENALICE_HOME']) ?? userDataHome,
    nodeExecPath: cleanPath(opts.nodeExecPath) ?? process.execPath,
    managedPiPath: cleanPath(env['OPENALICE_MANAGED_PI_PATH']),
    managedPiNodePath: cleanPath(env['OPENALICE_MANAGED_PI_NODE_PATH']),
    managedGitDir: cleanPath(env['OPENALICE_MANAGED_GIT_DIR']),
    managedGitBin: cleanPath(env['OPENALICE_MANAGED_GIT_BIN']),
    managedShellPath: cleanPath(env['OPENALICE_MANAGED_SHELL_PATH']),
    managedToolchainPath: splitPathList(env['OPENALICE_MANAGED_TOOLCHAIN_PATH']),
  };
}

function normalizeLauncher(rawProfile: string | undefined, rawLauncher: string | undefined): RuntimeLauncher {
  const profile = rawProfile?.trim();
  if (
    profile === 'dev' ||
    profile === 'electron-dev' ||
    profile === 'electron-packaged' ||
    profile === 'docker'
  ) {
    return profile;
  }

  const launcher = rawLauncher?.trim();
  if (launcher === 'electron') return 'electron-dev';
  if (launcher === 'docker') return 'docker';
  return 'dev';
}

function cleanPath(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function splitPathList(value: string | undefined): readonly string[] {
  const raw = value?.trim();
  if (!raw) return [];
  return raw
    .split(delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
}
