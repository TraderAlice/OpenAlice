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
 *   - resolves to a batch shim (.cmd/.bat)      → spawn via `cmd.exe /d /c
 *     <shim> <args>` (CreateProcess cannot execute a batch file directly; it
 *     must go through the command interpreter).
 *   - not found, or the caller already passed a path / an explicit extension →
 *     passthrough unchanged (let it fail loudly with the original name).
 *
 * On non-Windows this is the identity function: the kernel reads shebangs and a
 * bare-name PATH lookup finds shell-script shims fine.
 */
import { existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

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
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

export function resolveLaunchCommand(
  argv: readonly string[],
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): ResolvedCommand {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (platform !== 'win32' || argv.length === 0) return { argv, viaShell: false };

  const [name, ...rest] = argv;
  if (!name) return { argv, viaShell: false };
  // Caller gave an explicit path or extension → trust it, don't re-resolve.
  if (name.includes('/') || name.includes('\\') || /\.[^.\\/]+$/.test(name)) {
    return { argv, viaShell: false };
  }

  const resolved = lookupOnWindowsPath(name, env);
  if (!resolved) return { argv, viaShell: false }; // fail loudly with original name

  const dot = resolved.lastIndexOf('.');
  const ext = dot >= 0 ? resolved.slice(dot).toLowerCase() : '';
  if (ext === '.cmd' || ext === '.bat') {
    const comspec = env['ComSpec'] || env['COMSPEC'] || 'cmd.exe';
    // /d skips any AutoRun registry command; /c runs then exits. The shim path
    // is a single arg (node-pty/Node quote it if it contains spaces); cmd's
    // default rule preserves a single quoted-executable + bare args correctly.
    return { argv: [comspec, '/d', '/c', resolved, ...rest], viaShell: true };
  }
  return { argv: [resolved, ...rest], viaShell: false };
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

function rank(ext: string): number {
  const e = ext.toLowerCase();
  if (e === '.exe' || e === '.com') return 0;
  if (e === '.cmd' || e === '.bat') return 1;
  return 2;
}
