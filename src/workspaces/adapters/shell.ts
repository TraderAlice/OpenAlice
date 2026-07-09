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
 *
 * Headless mode turns the same adapter into a zero-LLM automation runner:
 * the issue `what` is executed as a shell script (`sh -lc`), so scheduled
 * jobs that are already a `node work/….mjs` (or any CLI pipeline) don't
 * need to burn an agent turn just to `exec` a command.
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
    headless: true,
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    return composeShellCommand(ctx.env);
  },

  composeHeadlessCommand(_base: readonly string[], _ctx: SpawnContext, prompt: string): readonly string[] {
    // `sh -lc` keeps PATH / alice* shims from the launcher env while still
    // accepting a multi-line script from the issue `what`. Prefer the user's
    // login shell when available so workspace-local aliases still work.
    const shell = process.env['SHELL'] ?? '/bin/sh';
    return [shell, '-lc', prompt];
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
