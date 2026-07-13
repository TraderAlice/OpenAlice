import { existsSync } from 'node:fs';
import { delimiter, dirname, join } from 'node:path';

type EnvLike = Readonly<Record<string, string | undefined>>;

/**
 * Find a real Bash executable for Windows without requiring `bash.exe` itself
 * to be on PATH.  Git for Windows normally adds only `<Git>\\cmd` (for
 * git.exe), while its Bash lives in `<Git>\\bin`; relying on `spawn('bash')`
 * therefore fails on a perfectly normal installation.
 */
export function resolveBashPath(
  env: EnvLike = process.env,
  platform: NodeJS.Platform = process.platform,
): string | null {
  // User-selected workspace shell is a Windows-only machine preference. Keep
  // it ahead of the packaged runtime so an explicit override actually wins,
  // while leaving the existing macOS/Linux resolution path untouched.
  if (platform === 'win32') {
    const preferred = clean(env['OPENALICE_WORKSPACE_SHELL_PATH']);
    if (preferred) return preferred;
  }
  const managed = clean(env['OPENALICE_MANAGED_SHELL_PATH']);
  if (managed) return managed;
  if (platform !== 'win32') return null;

  const shell = clean(env['SHELL']);
  if (shell && /(?:^|[\\/])bash(?:\.exe)?$/i.test(shell)) return shell;

  const pathDirs = (env['PATH'] ?? env['Path'] ?? '')
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
  for (const dir of pathDirs) {
    const direct = join(dir, 'bash.exe');
    if (existsSync(direct)) return direct;
    if (existsSync(join(dir, 'git.exe'))) {
      const root = /^(?:cmd|bin)$/i.test(dirnameLeaf(dir)) ? dirname(dir) : dir;
      const fromGit = firstExisting([
        join(root, 'bin', 'bash.exe'),
        join(root, 'usr', 'bin', 'bash.exe'),
      ]);
      if (fromGit) return fromGit;
    }
  }

  const roots = [
    clean(env['ProgramFiles']),
    clean(env['ProgramW6432']),
    clean(env['ProgramFiles(x86)']),
    clean(env['LOCALAPPDATA']) ? join(clean(env['LOCALAPPDATA'])!, 'Programs') : null,
  ].filter((value): value is string => !!value);
  return firstExisting(roots.flatMap((root) => [
    join(root, 'Git', 'bin', 'bash.exe'),
    join(root, 'Git', 'usr', 'bin', 'bash.exe'),
  ]));
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function dirnameLeaf(path: string): string {
  return path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? '';
}

function firstExisting(paths: readonly string[]): string | null {
  return paths.find((path) => existsSync(path)) ?? null;
}
