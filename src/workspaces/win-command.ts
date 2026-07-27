/**
 * Cross-platform launch-command resolution for the workspace spawners.
 *
 * The bug this fixes: the agent CLIs are spawned by BARE NAME (`opencode`,
 * `pi`, `claude`, `codex`). On Windows, node-pty hands that name straight to
 * ConPTY's `CreateProcessW`, which searches PATH but only ever appends `.exe`
 * — it never tries `.cmd`/`.bat`. So:
 *
 *   - claude / codex ship NATIVE executables (`claude.exe`, `codex.exe`) →
 *     resolve fine.
 *   - opencode / pi install as npm shims — on Windows that's a `.cmd` (+ a
 *     `.ps1` and an extensionless sh script), NO `.exe`. CreateProcess looking
 *     for `opencode.exe` / `pi.exe` finds nothing → the workspace never
 *     launches. This is the "Windows can't start opencode/pi from the
 *     frontend" report.
 *
 * Fix: on win32, do the PATH × PATHEXT lookup ourselves.
 *   - resolves to a real executable (.exe/.com) → spawn that full path directly.
 *   - resolves to a stock npm/pnpm batch shim   → run its JS entry with Node.
 *   - resolves to another batch shim with the usual extensionless POSIX sibling
 *                                               → run that sibling with Bash.
 *   - resolves to a batch-only shim             → retain the legacy cmd.exe
 *     form for launcher-owned probes; untrusted headless callers reject it.
 *   - not found                                 → passthrough unchanged and let
 *     spawn report the missing executable.
 *
 * On non-Windows this is the identity function: the kernel reads shebangs and a
 * bare-name PATH lookup finds shell-script shims fine.
 */
import { existsSync, readFileSync } from 'node:fs';
import { basename, delimiter, dirname, join, relative, resolve } from 'node:path';

import { resolveBashPath } from '../core/shell-resolver.js';

export type LaunchMode = 'direct' | 'node-shim' | 'bash-shim' | 'cmd-shim';

export interface ResolvedCommand {
  readonly argv: readonly string[];
  /**
   * True iff the command was wrapped through `cmd.exe` to run a `.cmd`/`.bat`
   * shim (win32 only). Callers that append an UNTRUSTED positional arg (e.g. a
   * headless prompt) must NOT use this form — cmd.exe re-parses shell
   * metacharacters (`& | < > ^ %`) in that arg, which is a command-injection
   * surface. The interactive/probe paths only pass flags + trusted generated
   * ids, so the wrap is safe there.
   */
  readonly viaShell: boolean;
  /** Operator-safe launch strategy; never contains prompt or argument values. */
  readonly mode: LaunchMode;
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

export function resolveLaunchCommand(
  argv: readonly string[],
  opts: {
    platform?: NodeJS.Platform;
    env?: NodeJS.ProcessEnv;
    nodeExecPath?: string;
    cwd?: string;
  } = {},
): ResolvedCommand {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform !== 'win32' || argv.length === 0) {
    return { argv, viaShell: false, mode: 'direct' };
  }

  const [name, ...rest] = argv;
  if (!name) return { argv, viaShell: false, mode: 'direct' };

  const explicitPath = name.includes('/') || name.includes('\\');
  const explicitExt = extensionOf(name);
  let resolved: string | null;
  if (explicitPath) {
    const candidate = explicitCandidate(name, opts.cwd);
    if (!isBatchExtension(explicitExt) || !existsSync(candidate)) {
      return { argv, viaShell: false, mode: 'direct' };
    }
    resolved = candidate;
  } else if (explicitExt) {
    if (!isBatchExtension(explicitExt)) {
      return { argv, viaShell: false, mode: 'direct' };
    }
    resolved = lookupExactOnWindowsPath(name, env);
    if (!resolved) return { argv, viaShell: false, mode: 'direct' };
  } else {
    resolved = lookupOnWindowsPath(name, env);
    if (!resolved) return { argv, viaShell: false, mode: 'direct' };
  }

  const ext = extensionOf(resolved);
  if (isBatchExtension(ext)) {
    // npm's Windows shims are small, deterministic wrappers around a JS
    // entrypoint.  Run that entrypoint directly with Node when we can prove the
    // wrapper has the stock shape.  Besides avoiding an unnecessary shell,
    // this is what makes user-controlled headless prompts safe: cmd.exe never
    // gets a chance to re-parse &, |, %, ^, and friends.
    const direct = resolveStockNpmShim(resolved, rest, opts.nodeExecPath ?? process.execPath);
    if (direct) return { argv: direct, viaShell: false, mode: 'node-shim' };

    // npm-style installs also publish an extensionless POSIX shim next to the
    // `.cmd`. Git Bash can execute that script while receiving the prompt as a
    // separate argv item, so neither Bash nor cmd.exe evaluates prompt text.
    const posixShim = resolved.slice(0, -ext.length);
    const bash = resolveBashPath(env, 'win32');
    if (existsSync(posixShim) && bash && existsSync(bash)) {
      return {
        argv: [bash, windowsPathForBash(posixShim), ...rest],
        viaShell: false,
        mode: 'bash-shim',
      };
    }

    const comspec = env['ComSpec'] || env['COMSPEC'] || 'cmd.exe';
    // /d skips any AutoRun registry command; /c runs then exits. The shim path
    // is a single arg (node-pty/Node quote it if it contains spaces); cmd's
    // default rule preserves a single quoted-executable + bare args correctly.
    return {
      argv: [comspec, '/d', '/c', resolved, ...rest],
      viaShell: true,
      mode: 'cmd-shim',
    };
  }
  return { argv: [resolved, ...rest], viaShell: false, mode: 'direct' };
}

/**
 * Resolve the stock npm.cmd wrapper to `node <entry> ...args` without a shell.
 *
 * This intentionally recognizes only npm's generated final invocation:
 *
 *   "%_prog%" "%dp0%\\node_modules\\some-package\\cli.js" %*
 *
 * Anything hand-written, outside the shim directory, or with extra shell
 * syntax falls back to the existing cmd.exe path (and remains rejected by the
 * headless runner for untrusted prompts).
 */
export function resolveStockNpmShim(
  shimPath: string,
  args: readonly string[],
  nodeExecPath: string,
): readonly string[] | null {
  let source: string;
  try {
    source = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }

  // npm uses `%dp0%\\node_modules\\...`; pnpm's linked `.bin` shims use
  // `%~dp0\\..\\package\\...` and repeat the same entry in their local-node
  // and PATH-node branches. Accept both generated shapes only when every
  // captured entry is identical.
  const matches = [...source.matchAll(/"(?:%dp0%|%~dp0)\\([^"\r\n]+\.(?:c|m)?js)"\s+%\*/gim)];
  const entries = [...new Set(matches.map((match) => match[1]).filter((value): value is string => !!value))];
  if (entries.length !== 1) return null;
  const rawRelative = entries[0];
  if (!rawRelative || /[&|<>^%]/.test(rawRelative)) return null;

  const root = dirname(shimPath);
  const allowedRoot = basename(root).toLowerCase() === '.bin'
    ? dirname(root)
    : root;
  const entry = resolve(root, rawRelative.replace(/\\/g, '/'));
  const rel = relative(allowedRoot, entry);
  if (!rel || rel.startsWith('..') || rel.includes(':') || !existsSync(entry)) return null;
  return [nodeExecPath, entry, ...args];
}

function lookupOnWindowsPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const exts = (env['PATHEXT'] ?? DEFAULT_PATHEXT)
    .split(';')
    .map((e) => e.trim())
    .filter(Boolean)
    .sort((a, b) => rank(a) - rank(b)); // prefer a real .exe over a .cmd shim
  // Windows env var casing is unstable across hosts; check both.
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const ext of exts) {
      // PATHEXT is conventionally uppercase but npm shims are lowercase on disk.
      // Windows' filesystem is case-insensitive, so we normalize the appended
      // extension to lowercase for a clean, deterministic command string.
      const candidate = join(dir, name + ext.toLowerCase());
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function lookupExactOnWindowsPath(name: string, env: NodeJS.ProcessEnv): string | null {
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function explicitCandidate(name: string, cwd: string | undefined): string {
  if (!cwd || name.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(name)) return name;
  return resolve(cwd, name);
}

function extensionOf(path: string): string {
  const leaf = path.split(/[\\/]/).pop() ?? path;
  const dot = leaf.lastIndexOf('.');
  return dot >= 0 ? leaf.slice(dot).toLowerCase() : '';
}

function isBatchExtension(ext: string): boolean {
  return ext === '.cmd' || ext === '.bat';
}

function windowsPathForBash(path: string): string {
  return path.replace(/\\/g, '/');
}

function rank(ext: string): number {
  const e = ext.toLowerCase();
  if (e === '.exe' || e === '.com') return 0;
  if (e === '.cmd' || e === '.bat') return 1;
  return 2;
}
