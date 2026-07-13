/**
 * Runtime detection for the agent CLIs (claude / codex / opencode / pi).
 *
 * The launcher registers all adapters unconditionally — registration means
 * "the launcher knows HOW to drive this CLI", NOT "the CLI is installed on
 * this box". Before this module, the only signal a user got that a runtime
 * was missing was a raw ENOENT at spawn time (the PTY dies the instant it
 * starts). That's a terrible first-run experience: a fresh install ships
 * zero agent CLIs, the picker lists all four as if they were ready, and the
 * user has no idea they need to `npm i -g` anything.
 *
 * This does a cross-platform PATH lookup so the `/agents` endpoint can tell
 * the frontend which runtimes are actually present, and the UI can guide the
 * user to install the missing ones. It is a pure filesystem probe (no spawn),
 * cheap enough to run on every list call — which also means a CLI installed
 * mid-session shows up on the next poll without a restart.
 *
 * NOTE: this resolves the adapter's CANONICAL binary name (`adapter.binary`).
 * A user who overrides the launch command via `WEB_TERMINAL_COMMAND` to a
 * non-standard path is an advanced case the hint doesn't try to track — the
 * detection is a UX nudge, not a hard gate (spawn still attempts regardless).
 */
import { existsSync, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';

import { runtimeProfileFromEnv } from '@/core/runtime-profile.js';

export interface AgentAvailability {
  /** True iff the binary resolved to a real file on PATH. */
  readonly installed: boolean;
  /** Absolute path the binary resolved to, or null when not found. */
  readonly path: string | null;
}

export function detectAgentBinary(
  id: string,
  binary: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): AgentAvailability {
  const env = opts.env ?? process.env;
  const managed = id === 'pi' ? runtimeProfileFromEnv(env).managedPiPath : null;
  if (managed && isFile(managed)) return { installed: true, path: managed };
  return detectBinary(binary, opts);
}

export function runtimeInstallOverride(
  id: string,
  env: NodeJS.ProcessEnv = process.env,
): AgentAvailability | null {
  if (env['OPENALICE_ONBOARDING_TEST'] !== '1') return null;
  const raw = env['OPENALICE_AGENT_RUNTIME_INSTALLS']?.trim().toLowerCase();
  if (!raw || raw === 'real') return null;
  if (raw === 'none') return { installed: false, path: null };
  if (raw === 'all') return { installed: true, path: null };

  const parseList = (prefix: string): Set<string> | null => {
    if (!raw.startsWith(prefix)) return null;
    return new Set(
      raw.slice(prefix.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
    );
  };

  const only = parseList('only:');
  if (only) return { installed: only.has(id), path: null };
  const missing = parseList('missing:');
  if (missing) return { installed: !missing.has(id), path: null };
  return null;
}

/** Windows' default executable-extension search order (PATH × PATHEXT). */
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * Locate an executable by bare name on PATH, cross-platform. Returns the
 * absolute path it resolved to, or null when nothing matches.
 *
 *   - A name that already contains a separator or extension is checked as-is.
 *   - On win32 we walk PATH × PATHEXT (npm shims install as `.cmd`, never
 *     `.exe`, so a naive `name.exe` probe misses opencode/pi — mirrors the
 *     resolution `win-command.ts` does for the actual spawn).
 *   - On POSIX we walk PATH looking for `<dir>/<name>` as a regular file.
 */
export function findExecutableOnPath(
  name: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): string | null {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  if (!name) return null;

  // Caller passed a path or an explicit extension — check it directly.
  if (name.includes('/') || name.includes('\\') || /\.[^.\\/]+$/.test(name)) {
    return isFile(name) ? name : null;
  }

  // Windows env var casing is unstable across hosts; check both.
  const dirs = (env['PATH'] ?? env['Path'] ?? '').split(delimiter).filter(Boolean);

  if (platform === 'win32') {
    const exts = (env['PATHEXT'] ?? DEFAULT_PATHEXT)
      .split(';')
      .map((e) => e.trim())
      .filter(Boolean);
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = join(dir, name + ext.toLowerCase());
        if (isFile(candidate)) return candidate;
      }
    }
    return null;
  }

  for (const dir of dirs) {
    const candidate = join(dir, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

/** Detect whether a single binary is installed. */
export function detectBinary(
  binary: string,
  opts: { platform?: NodeJS.Platform; env?: NodeJS.ProcessEnv } = {},
): AgentAvailability {
  const path = findExecutableOnPath(binary, opts);
  return { installed: path !== null, path };
}

function isFile(p: string): boolean {
  try {
    return existsSync(p) && statSync(p).isFile();
  } catch {
    return false;
  }
}
