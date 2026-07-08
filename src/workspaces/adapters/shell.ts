import type { CliAdapter, SpawnContext } from '../cli-adapter.js';
import { runtimeProfileFromEnv } from '@/core/runtime-profile.js';

/**
 * The bare-metal terminal — `zsh --login` (or whatever's on `$SHELL`),
 * dropped into the workspace's cwd. No transcript discovery, no resume.
 * This is the "I just want a terminal, leave me alone" path the user
 * articulated: "反正 terminal 都开了，用户自己开个 vim 我也管不着".
 *
 * The shell inherits the launcher-built env (with TERM_PROGRAM and other
 * IDE-leaking vars already stripped by spawn-env.ts), so it feels like
 * a fresh login session.
 */
export const shellAdapter: CliAdapter = {
  id: 'shell',
  displayName: 'Shell',
  kind: 'utility',
  namePrefix: 'sh',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: false,
    resumeById: false,
    transcriptDiscovery: 'none',
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    return composeShellCommand(ctx.env);
  },
};

export function composeShellCommand(
  env: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  const managedShell = runtimeProfileFromEnv(env, { platform }).managedShellPath;
  if (managedShell) return [managedShell, '--login'];
  if (platform === 'win32') {
    return [env['SHELL'] ?? env['ComSpec'] ?? env['COMSPEC'] ?? 'cmd.exe'];
  }
  return [env['SHELL'] ?? '/bin/zsh', '--login'];
}
