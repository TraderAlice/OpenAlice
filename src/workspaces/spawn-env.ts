/**
 * Build the env that the spawned PTY command will inherit.
 *
 * The server inherits the parent shell's env, which may contain stale
 * "I'm-inside-VSCode/iTerm/etc." breadcrumbs that confuse TUI apps. The
 * canonical example: when this server is launched from a VSCode integrated
 * terminal, the parent env carries `TERM_PROGRAM=vscode` and
 * `CLAUDE_CODE_SSE_PORT`. Claude Code's CLI sees those, assumes it's running
 * inside the VSCode extension, and routes multiline input through an SSE
 * channel that doesn't exist on our side — so Shift+Enter silently no-ops
 * even though our `\x1b\r` bytes arrive at the PTY correctly.
 *
 * Fix: strip every terminal-identification env var the parent shell might
 * have, then announce ourselves with `TERM_PROGRAM=auto-quant-launcher`.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';

import { runtimeProfileFromEnv } from '@/core/runtime-profile.js';

const STRIP_EXACT = new Set<string>([
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'OPENALICE_MCP_URL',
  'OPENALICE_TOOL_URL',
  'OPENALICE_TOOL_SOCKET',
  'OPENALICE_TERMINAL_THEME',
  'OPENALICE_WORKSPACE_CLI_BIN_PATH',
  'OPENCODE_CONFIG_CONTENT',
  'COLORFGBG',
]);

const STRIP_PREFIXES = [
  'VSCODE_',
  'CLAUDE_CODE_',
  'ITERM_',
  'WT_',
  'KITTY_',
  'ALACRITTY_',
  'TERMINUS_',
  'WEZTERM_',
  'GHOSTTY_',
];

const SELF_VERSION = '0.1.0';

const POSIX_SYSTEM_BIN_DIRS = [
  '/opt/homebrew/bin',
  '/opt/homebrew/sbin',
  '/usr/local/bin',
  '/usr/local/sbin',
  '/usr/bin',
  '/bin',
  '/usr/sbin',
  '/sbin',
] as const;

const POSIX_USER_BIN_DIRS = [
  '.local/bin',
  '.npm-global/bin',
  'Library/pnpm',
  '.yarn/bin',
  '.bun/bin',
  '.cargo/bin',
  '.volta/bin',
] as const;

export function buildSpawnEnv(
  parent: NodeJS.ProcessEnv,
  extras: { [key: string]: string } = {},
  cwd?: string,
): { [key: string]: string } {
  const out: { [key: string]: string } = {};
  for (const [k, v] of Object.entries(parent)) {
    if (typeof v !== 'string') continue;
    if (shouldStrip(k)) continue;
    out[k] = v;
  }
  // Announce ourselves honestly so well-behaved TUI apps can detect us.
  out['TERM'] = 'xterm-256color';
  out['COLORTERM'] = 'truecolor';
  out['TERM_PROGRAM'] = 'openalice-workspaces';
  out['TERM_PROGRAM_VERSION'] = SELF_VERSION;
  if (!out['LANG']) out['LANG'] = 'en_US.UTF-8';
  if (!out['LC_CTYPE'] && !out['LC_ALL']) out['LC_CTYPE'] = 'en_US.UTF-8';
  // Override PWD to match the spawn cwd. PTY spawn does chdir() to `cwd`,
  // but env PWD is just the parent's PWD passed verbatim. Claude Code CLI
  // selects its `~/.claude/projects/<projectKey>/` from $PWD (not from
  // process.cwd()), so without this override claude writes the workspace's
  // session jsonl into the backend's projectKey — mixing it with whatever
  // happens to be running there. On resume, `--continue` looks in the
  // workspace's own projectKey, finds it empty, and exits 1 → PTY respawn
  // loop into the circuit breaker. Verified end-to-end against the
  // `path.trace` log: pre-fix `envPWD` was the OpenAlice repo root while
  // `spawnCwd` was the workspace dir.
  if (cwd) out['PWD'] = cwd;
  // Caller-supplied per-session env (e.g. AQ_WS_ID, AQ_LAUNCHER_REPO_ROOT)
  // wins over the inherited env so .mcp.json `${VAR}` expansion at Claude
  // startup resolves to the right values.
  for (const [k, v] of Object.entries(extras)) {
    out[k] = v;
  }
  const cliPath = buildCliPath(out);
  // Windows environment names are case-insensitive, but JavaScript objects are
  // not. A typical host contributes `Path`; adding a separate `PATH` leaves two
  // entries in node-pty's environment block. The first Pi process can still
  // launch, but Node normalizes the duplicate back to the unaugmented `Path`,
  // so Pi's nested bash tool loses the OpenAlice CLI shim directory. Keep one
  // canonical spelling before crossing the process boundary.
  for (const key of Object.keys(out)) {
    if (key.toUpperCase() === 'PATH') delete out[key];
  }
  out['PATH'] = cliPath;
  delete out['OPENALICE_WORKSPACE_CLI_BIN_PATH'];
  return out;
}

/**
 * Build a PATH suitable for launching user-installed agent CLIs from a GUI app.
 *
 * macOS apps launched from Finder do not inherit the user's login-shell PATH,
 * so Homebrew / pnpm / ~/.local installs disappear even though `codex` or
 * `claude` works in Terminal. Keep this pure and synchronous: it is used both
 * for `/agents` availability probes and for the actual PTY spawn env.
 */
export function buildCliPath(env: NodeJS.ProcessEnv = process.env): string {
  const path = env['PATH'] ?? env['Path'] ?? '';
  const profile = runtimeProfileFromEnv(env);
  const managedPiDir = profile.managedPiPath && !profile.managedPiNodePath && existsSync(profile.managedPiPath)
    ? dirname(profile.managedPiPath)
    : null;

  const home = env['HOME'] ?? homedir();
  const pathEntries = path.split(delimiter);
  const candidates = [
    env['OPENALICE_WORKSPACE_CLI_BIN_PATH'],
    managedPiDir,
    ...profile.managedToolchainPath,
    ...(env['OPENALICE_EXTRA_AGENT_PATH'] ?? '').split(delimiter),
    ...pathEntries,
    ...(process.platform === 'win32'
      ? []
      : [
          env['PNPM_HOME'],
          ...POSIX_USER_BIN_DIRS.map((p) => join(home, p)),
          ...POSIX_SYSTEM_BIN_DIRS,
        ]),
  ];

  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of candidates) {
    const dir = raw?.trim();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    // Keep existing PATH entries even if the directory is currently missing:
    // they came from the host and may be intentional. For inferred fallbacks,
    // include only real directories to avoid bloating every spawned shell.
    if (pathEntries.includes(dir) || existsSync(dir)) out.push(dir);
  }
  return out.join(delimiter);
}

function shouldStrip(name: string): boolean {
  if (STRIP_EXACT.has(name)) return true;
  return STRIP_PREFIXES.some((p) => name.startsWith(p));
}
