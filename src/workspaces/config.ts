import { join, resolve } from 'node:path';
import { templatesPath, userDataHome } from '@/core/paths.js';

export interface ServerConfig {
  readonly command: readonly string[];
  readonly allowedOrigins: ReadonlySet<string>;
  readonly allowAnyOrigin: boolean;
  /** Outbound buffer high-watermark before we pause the PTY. */
  readonly bpHighWatermarkBytes: number;
  /** Outbound buffer low-watermark before we resume the PTY. */
  readonly bpLowWatermarkBytes: number;
  /** Time we wait for clean shutdown before forcing the process to exit. */
  readonly shutdownTimeoutMs: number;
  /** Per-session replay ring-buffer cap, in bytes. */
  readonly replayBufferBytes: number;
  /** Launcher state root — registry, workspaces dir, shared data live here. */
  readonly launcherRoot: string;
  /** Directory containing one subdirectory per template (each with bootstrap.sh). */
  readonly templatesDir: string;
  /**
   * Legacy fallback: path to a single bootstrap script set via the old
   * `AQ_BOOTSTRAP_SCRIPT` env var. When present, registered as a synthetic
   * template named `legacy` so old configurations keep working.
   */
  readonly legacyBootstrapScript: string | null;
  /** Optional Auto-Quant clone override (power-user; default is the managed mirror under launcherRoot). */
  readonly templateDir: string;
  /** Bootstrap script kill timeout. */
  readonly bootstrapTimeoutMs: number;
  /** Absolute path to the launcher repo root (used for `${AQ_LAUNCHER_REPO_ROOT}` expansion). */
  readonly launcherRepoRoot: string;
}

const DEFAULT_HIGH_WM = 1 * 1024 * 1024;
const DEFAULT_LOW_WM = 256 * 1024;
const DEFAULT_SHUTDOWN_MS = 5_000;
const DEFAULT_REPLAY_BYTES = 512 * 1024;
const DEFAULT_BOOTSTRAP_TIMEOUT_MS = 60_000;

/**
 * Build the CORS allowlist for the workspace WS upgrade. Derived from the
 * backend's actual bound web port (not from a hardcoded literal), so the
 * three valid client topologies are explicitly represented:
 *
 *   - `localhost:<webPort>` / `127.0.0.1:<webPort>` — self-hosted: the
 *     backend serves the UI bundle at the same origin, browser hits it
 *     directly. Same-origin in practice but Origin header is still set
 *     and CORS check fires.
 *   - `localhost:<uiPort>` / `127.0.0.1:<uiPort>` — contributor-dev: Vite
 *     dev server proxies API/WS to the backend; browser's origin is the
 *     Vite port. Guardian resolves it (probe from 5173) and injects
 *     `OPENALICE_UI_PORT` so the allowlist tracks the real frontend even
 *     when 5173 was taken; standalone Vite (no orchestrator) keeps the
 *     5173 default.
 *
 * The cloud-demo topology (future https://app.openalice.io) is intentionally
 * NOT in the default list — that's an opt-in addition driven by config when
 * the cloud demo ships.
 */
export function buildDefaultOrigins(webPort: number, uiPort = 5173): string[] {
  return [
    `http://localhost:${uiPort}`,
    `http://127.0.0.1:${uiPort}`,
    `http://localhost:${webPort}`,
    `http://127.0.0.1:${webPort}`,
  ];
}

export interface LoadConfigOptions {
  /** Backend's actual bound web port; used to derive the CORS allowlist. */
  readonly webPort: number;
  /** Process env (defaults to `process.env`). */
  readonly env?: NodeJS.ProcessEnv;
}

/** Keep workspace state inside the selected OpenAlice home unless the user
 *  explicitly splits it with AQ_LAUNCHER_ROOT. */
export function resolveLauncherRoot(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(
    env['AQ_LAUNCHER_ROOT'] ?? join(env['OPENALICE_HOME'] ?? userDataHome, 'workspaces'),
  );
}

export function loadConfig(opts: LoadConfigOptions): ServerConfig {
  const env = opts.env ?? process.env;

  const command = parseCommand(env['WEB_TERMINAL_COMMAND']);

  // Guardian-injected Vite dev-server port; 5173 when running without the
  // orchestrator (standalone Vite, prod — where no UI origin drift exists).
  const uiPort = parseIntEnv(env['OPENALICE_UI_PORT'], 5173, 1, 65535);
  const originsRaw = (env['WEB_TERMINAL_ALLOWED_ORIGINS'] ?? buildDefaultOrigins(opts.webPort, uiPort).join(','))
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowAnyOrigin = originsRaw.includes('*');
  const allowedOrigins = new Set(originsRaw.filter((s) => s !== '*'));

  const bpHigh = parseIntEnv(env['WEB_TERMINAL_BP_HIGH'], DEFAULT_HIGH_WM, 1024, 1024 * 1024 * 1024);
  const bpLow = parseIntEnv(env['WEB_TERMINAL_BP_LOW'], DEFAULT_LOW_WM, 0, bpHigh);
  const shutdownTimeoutMs = parseIntEnv(
    env['WEB_TERMINAL_SHUTDOWN_MS'],
    DEFAULT_SHUTDOWN_MS,
    100,
    60_000,
  );
  const replayBufferBytes = parseIntEnv(
    env['WEB_TERMINAL_REPLAY_BYTES'],
    DEFAULT_REPLAY_BYTES,
    1024,
    64 * 1024 * 1024,
  );

  const launcherRoot = resolveLauncherRoot(env);
  const templatesDir = resolve(env['AQ_TEMPLATES_DIR'] ?? templatesPath());
  const legacyBootstrapScript = env['AQ_BOOTSTRAP_SCRIPT']
    ? resolve(env['AQ_BOOTSTRAP_SCRIPT'])
    : null;
  const templateDir = env['AQ_TEMPLATE_DIR'] ? resolve(env['AQ_TEMPLATE_DIR']) : '';
  const bootstrapTimeoutMs = parseIntEnv(
    env['AQ_BOOTSTRAP_TIMEOUT_MS'],
    DEFAULT_BOOTSTRAP_TIMEOUT_MS,
    1_000,
    600_000,
  );
  const launcherRepoRoot = computeLauncherRepoRoot();

  return {
    command,
    allowedOrigins,
    allowAnyOrigin,
    bpHighWatermarkBytes: bpHigh,
    bpLowWatermarkBytes: bpLow,
    shutdownTimeoutMs,
    replayBufferBytes,
    launcherRoot,
    templatesDir,
    legacyBootstrapScript,
    templateDir,
    bootstrapTimeoutMs,
    launcherRepoRoot,
  };
}

function parseCommand(raw: string | undefined): readonly string[] {
  if (raw && raw.trim().length > 0) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('[')) {
      try {
        const parsed: unknown = JSON.parse(trimmed);
        if (
          Array.isArray(parsed) &&
          parsed.every((v): v is string => typeof v === 'string') &&
          parsed.length > 0
        ) {
          return parsed;
        }
      } catch {
        // fall through to whitespace split
      }
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length > 0 && parts[0]) return parts;
  }
  return ['claude'];
}

function parseIntEnv(raw: string | undefined, fallback: number, lo: number, hi: number): number {
  if (raw === undefined) return fallback;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return fallback;
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

/**
 * Compute the launcher repo root.
 *
 * In OpenAlice, both `pnpm dev` (tsx watch src/main.ts) and `node dist/main.js`
 * are invoked from the OpenAlice repo root, so `process.cwd()` is the
 * authoritative answer. The original launcher used relative-to-import-url
 * (`server/src/config.ts → ../../`) which assumed the build preserved
 * source layout — that holds for the launcher's `tsc` output but breaks
 * OpenAlice's tsup single-file bundle (`dist/main.js`'s relative `../../`
 * would resolve to the parent of the repo).
 */
function computeLauncherRepoRoot(): string {
  return process.cwd();
}
