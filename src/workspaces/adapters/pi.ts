import { existsSync } from 'node:fs';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { runtimeProfileFromEnv } from '@/core/runtime-profile.js';
import { resolveBashPath } from '@/core/shell-resolver.js';

import type { CliAdapter, SpawnContext, WorkspaceAiCred } from '../cli-adapter.js';
import type { HeadlessOutputEvent } from '../headless-output.js';
import {
  migrateLegacyPiAgentDir,
  PI_BINDING_STATE_PATH,
  readPiWorkspaceConfig,
  resolvePiAgentDir,
  syncPiWorkspaceTheme,
  syncPiWorkspaceShellPath,
  writePiWorkspaceConfig,
} from './pi-config.js';

const PI_TRUST_FILENAME = 'trust.json';

let piTrustWriteQueue: Promise<void> = Promise.resolve();

function piCommandHead(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  const profile = runtimeProfileFromEnv(env);
  if (!profile.managedPiPath) return ['pi'];
  if (profile.managedPiNodePath) return [profile.managedPiNodePath, profile.managedPiPath];
  return [profile.managedPiPath];
}

export async function syncPiWindowsShellPath(
  cwd: string,
  platform: NodeJS.Platform = process.platform,
): Promise<void> {
  if (platform !== 'win32') return;
  if (!existsSync(join(cwd, PI_BINDING_STATE_PATH))) return;
  const shellPath = resolveBashPath(process.env, 'win32');
  if (!shellPath) return;

  await syncPiWorkspaceShellPath(cwd, shellPath).catch(() => undefined);
}

/**
 * OpenAlice Workspaces are created, registered, and launched through the
 * Workspace service. Pi 0.79+ otherwise stops its first interactive launch at
 * a project-resource trust selector because OpenAlice injects `.agents/skills`.
 * Record the managed Workspace as trusted before either the TUI or WebPi RPC
 * process starts, while preserving any explicit trust/no-trust decision the
 * user already saved for this directory or one of its parents.
 *
 * Trust is always written to Pi's real user agent directory. Workspace provider
 * selection lives in `.pi/settings.json`; it must never replace the global
 * agent directory that owns packages, settings, auth, and sessions.
 */
export async function syncPiProjectTrust(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const run = async (): Promise<void> => {
    const agentDir = resolvePiAgentDir(env);
    const trustPath = join(agentDir, PI_TRUST_FILENAME);
    const canonicalCwd = await realpath(cwd).catch(() => resolve(cwd));
    const trust = await readPiTrustFile(trustPath);
    if (trust === null) return;

    // Pi applies the nearest saved parent decision. Respect an explicit yes or
    // no; only fill the genuinely undecided first-run case.
    if (nearestPiTrustDecision(trust, canonicalCwd) !== null) return;
    trust[canonicalCwd] = true;

    await mkdir(agentDir, { recursive: true });
    const tempPath = `${trustPath}.openalice-${process.pid}`;
    await writeFile(tempPath, `${JSON.stringify(sortPiTrust(trust), null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(tempPath, trustPath);
  };

  // Several Workspaces can bootstrap concurrently. Serialize read/merge/write
  // inside this process so one Workspace never drops another's trust entry.
  const queued = piTrustWriteQueue.then(run, run);
  piTrustWriteQueue = queued.catch(() => undefined);
  await queued;
}

async function readPiTrustFile(path: string): Promise<Record<string, boolean | null> | null> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    // Pi owns this file. Preserve malformed/user-edited contents and let Pi
    // surface its own recovery path instead of replacing them during launch.
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return null;
  }
  const trust: Record<string, boolean | null> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (value !== true && value !== false && value !== null) {
      return null;
    }
    trust[key] = value;
  }
  return trust;
}

function nearestPiTrustDecision(
  trust: Readonly<Record<string, boolean | null>>,
  cwd: string,
): boolean | null {
  let candidate = cwd;
  while (true) {
    const decision = trust[candidate];
    if (decision === true || decision === false) return decision;
    const parent = dirname(candidate);
    if (parent === candidate) return null;
    candidate = parent;
  }
}

function sortPiTrust(trust: Readonly<Record<string, boolean | null>>): Record<string, boolean | null> {
  return Object.fromEntries(Object.entries(trust).sort(([a], [b]) => a.localeCompare(b)));
}

function piHeadlessApproveArgs(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  // Packaged desktop and Docker both use an OpenAlice-pinned Pi. Contributor
  // dev intentionally uses whatever `pi` is on PATH; its install/version/trust
  // policy belongs to that developer, so do not attach version-specific flags.
  const profile = runtimeProfileFromEnv(env);
  return profile.managedPiPath || profile.launcher === 'docker' ? ['--approve'] : [];
}

/**
 * Pi (github.com/earendil-works/pi, by Mario Zechner; MIT). Open-source agent
 * CLI — the second non-claude/openai channel after opencode ("two suppliers",
 * the IBKR-superset dual-vendor stance). Verified against pi 0.78.1.
 *
 * TOOL ACCESS: Pi has no native MCP, and the launcher injects NO MCP into
 * workspaces at all — Pi reaches OpenAlice purely through the `alice*` CLI
 * shims on PATH (`service.ts`) + the `alice*` / `traderhub` skills
 * copied to the shared `<cwd>/.agents/skills` path (`context-injector.ts`);
 * Pi's built-in `bash`
 * tool runs `alice` / `alice-uta` / `alice-workspace` / `traderhub`. This is
 * the full surface (data, trading, workspace, market) — same as every other
 * agent; only cron is unavailable (MCP-only by design, on no CLI). The old
 * `.pi/extensions/openalice-bridge.ts` MCP bridge was removed when the launcher
 * went CLI-only. See memory feedback_cli_injection_over_mcp_bridge.
 *
 * PROVIDER override: Pi has no project-local `models.json`, so OpenAlice adds a
 * namespaced provider to Pi's real user agent directory and selects it through
 * the native `<cwd>/.pi/settings.json` project layer. This preserves Pi's own
 * global settings, packages, auth, resources, sessions, and fallback behavior.
 * Reset restores the pre-injection project defaults and removes only the
 * OpenAlice-owned provider node.
 *
 * RESUME is first-class by-id (claude-level), via launcher-ASSIGNED id rather
 * than disk harvesting: `--session-id <id>` is create-or-reopen
 * (`dist/main.js:251-257`), so on a fresh spawn the launcher mints a uuid,
 * `composeCommand` emits `--session-id <uuid>`, and the launcher persists it as
 * `resumeHint` at spawn (capability `assignsSessionId`). Reattach then resumes
 * BY ID. This sidesteps pi's lazy transcript write (file only appears after the
 * first assistant turn) because the launcher already knows the id.
 * transcriptDiscovery stays 'none'.
 */
export const piAdapter: CliAdapter = {
  id: 'pi',
  displayName: 'Pi',
  binary: 'pi',
  // c=claude, x=codex, o=opencode, sh=shell taken; 'p' is free.
  namePrefix: 'p',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'none',
    // pi `--session-id <id>` is create-or-reopen, so the launcher mints the id
    // at spawn and records it immediately — by-id resume with no disk-watching,
    // immune to pi's lazy transcript write.
    assignsSessionId: true,
    headless: true,
  },

  lifecycle: {
    // Reconcile launcher-managed Pi project defaults before every surface
    // starts. Each operation is idempotent and preserves explicit Pi-owned
    // project choices.
    async prepareWorkspace({ cwd }): Promise<void> {
      await migrateLegacyPiAgentDir(cwd);
      await syncPiWorkspaceTheme(cwd);
      await syncPiWindowsShellPath(cwd);
      await syncPiProjectTrust(cwd);
    },
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Tools come from the CLI-injection path (alice on PATH + shared
    // .agents/skills), not flags — so the command head is just the binary + a
    // resume flag (if any).
    // The runtime lifecycle records trust for this OpenAlice-managed Workspace
    // before every launch. Keeping argv free of `--approve` preserves
    // compatibility with external Pi 0.78.x runtimes that predate the flag.
    const head = [...piCommandHead(ctx.env)];
    // Quick-chat seed: `pi [--session-id <id>] <messages…>` opens the
    // interactive TUI seeded with that first message. UNLIKE the other adapters,
    // pi appends the seed REGARDLESS of the resume branch: pi assigns its own id
    // at spawn (`assignsSessionId`), so a FRESH seeded spawn arrives here with
    // BOTH a launcher-minted `{ sessionId }` AND `initialPrompt`. The launcher
    // only ever sets `initialPrompt` on a fresh spawn, so its presence is itself
    // the "this is fresh" signal — a real resume never carries one. NOTE pi
    // REJECTS a `--` terminator ("Unknown option: --", verified 0.78.1), so the
    // prompt is a bare trailing positional (a prompt starting with `-`/`--` is
    // unprotected on pi; rare for chat messages — the other adapters guard with `--`).
    const seed = ctx.initialPrompt ? [ctx.initialPrompt] : [];
    if (ctx.resume === undefined) return [...head, ...seed];
    if (ctx.resume === 'last') return [...head, '--continue', ...seed];
    return [...head, '--session-id', ctx.resume.sessionId, ...seed];
  },

  // WebPi is a second VIEW over the same Pi session, not another runtime.
  // RPC stays completely separate from the TUI argv above: selecting WebPi
  // cannot change ordinary Pi startup, trust prompts, input handling, or PTY
  // behavior. It is always by-id so switching surfaces reopens the exact
  // conversation that the OpenAlice resume registry already owns.
  composeWebCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    if (!ctx.resume || ctx.resume === 'last') {
      throw new Error('WebPi requires a concrete Pi session id');
    }
    return [
      ...piCommandHead(ctx.env),
      ...(ctx.approveProject ? ['--approve'] : piHeadlessApproveArgs(ctx.env)),
      ...(ctx.appendSystemPrompt ? ['--append-system-prompt', ctx.appendSystemPrompt] : []),
      ...(ctx.skills ?? []).flatMap((path) => ['--skill', path]),
      '--session-id',
      ctx.resume.sessionId,
      '--mode',
      'rpc',
    ];
  },

  // Headless: `pi -p <prompt>` is non-interactive and exits at the turn
  // boundary, so there is nobody to answer Pi 0.79+'s project-trust prompt.
  // Bootstrap records a missing trust decision for every OpenAlice-managed
  // Workspace. The packaged app additionally approves its pinned managed Pi;
  // contributor dev leaves its external Pi argv untouched. NOTE: pi
  // REJECTS a `--` end-of-options terminator ("Unknown option: --", verified
  // 0.78.1), so the prompt is a bare trailing positional — a prompt literally
  // starting with `-`/`--` is unprotected on pi (rare for task prompts).
  composeHeadlessCommand(_base: readonly string[], _ctx: SpawnContext, prompt: string): readonly string[] {
    return [
      ...piCommandHead(_ctx.env),
      ...piHeadlessApproveArgs(_ctx.env),
      ...(_ctx.resume === 'last'
        ? ['--continue']
        : _ctx.resume
          ? ['--session-id', _ctx.resume.sessionId]
          : []),
      '-p',
      '--mode',
      'json',
      prompt,
    ];
  },

  // pi `--mode json` line 1 is `{"type":"session","id":…,"cwd":…}` — pi mints
  // its own id on a fresh headless run and announces it immediately (verified
  // 0.78.x, 2026-06-11; `--session-id` is also accepted alongside `-p`, but
  // harvesting the echo keeps headless uniform with the other adapters).
  extractHeadlessSessionId(line: string): string | null {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (evt['type'] !== 'session') return null;
      return typeof evt['id'] === 'string' ? evt['id'] : null;
    } catch {
      return null;
    }
  },

  extractHeadlessAssistantText(line: string): string | null {
    // Pi's message_update frames contain cumulative content and dominate large
    // runs. JSON mode uses JSON.stringify, so cheaply reject them before parse.
    if (!line.startsWith('{"type":"message_end"')) return null;
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (evt['type'] !== 'message_end') return null;
      const message = evt['message'];
      if (!message || typeof message !== 'object') return null;
      const record = message as Record<string, unknown>;
      if (record['role'] !== 'assistant' || !Array.isArray(record['content'])) return null;
      const text = record['content']
        .flatMap((part) => {
          if (!part || typeof part !== 'object') return [];
          const content = part as Record<string, unknown>;
          return content['type'] === 'text' && typeof content['text'] === 'string'
            ? [content['text']]
            : [];
        })
        .join('\n');
      return text || null;
    } catch {
      return null;
    }
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    if (
      !line.startsWith('{"type":"tool_execution_start"') &&
      !line.startsWith('{"type":"tool_execution_end"') &&
      !line.startsWith('{"type":"message_end"')
    ) return [];
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (
        evt['type'] === 'tool_execution_start' &&
        typeof evt['toolCallId'] === 'string' &&
        typeof evt['toolName'] === 'string'
      ) {
        return [{
          type: 'tool-start',
          id: evt['toolCallId'],
          name: evt['toolName'],
          ...(evt['args'] !== undefined ? { input: evt['args'] } : {}),
        }];
      }
      if (
        evt['type'] === 'tool_execution_end' &&
        typeof evt['toolCallId'] === 'string'
      ) {
        return [{
          type: 'tool-finish',
          id: evt['toolCallId'],
          ...(typeof evt['toolName'] === 'string' ? { name: evt['toolName'] } : {}),
          ...(evt['result'] !== undefined ? { output: evt['result'] } : {}),
          ...(evt['isError'] === true ? { isError: true } : {}),
        }];
      }
      if (evt['type'] !== 'message_end') return [];
      const message = evt['message'];
      if (!message || typeof message !== 'object') return [];
      const record = message as Record<string, unknown>;
      if (record['role'] !== 'assistant' || !Array.isArray(record['content'])) return [];
      const events: HeadlessOutputEvent[] = [];
      if (record['stopReason'] === 'error' || record['stopReason'] === 'aborted') {
        events.push({
          type: 'error',
          message: typeof record['errorMessage'] === 'string'
            ? record['errorMessage']
            : `Pi request ${record['stopReason']}`,
        });
      }
      events.push(...record['content'].flatMap((part): HeadlessOutputEvent[] => {
        if (!part || typeof part !== 'object') return [];
        const content = part as Record<string, unknown>;
        return content['type'] === 'text' && typeof content['text'] === 'string'
          ? [{ type: 'text', text: content['text'] }]
          : [];
      }));
      return events;
    } catch {
      return [];
    }
  },

  // JSON mode intentionally emits every streaming event. Its documented
  // message_update payload contains both a cumulative partial message and the
  // current message snapshot; tool_execution_update likewise carries partial
  // progress. They are useful for live rendering, not durable one-shot
  // diagnostics. The structured parser still sees the full stream.
  keepHeadlessDiagnosticLine(line: string): boolean {
    return !line.startsWith('{"type":"message_update"') &&
      !line.startsWith('{"type":"tool_execution_update"');
  },

  composeEnv(_ctx: SpawnContext): Record<string, string> {
    // Do not force PI_OFFLINE. OpenAlice is a networked product and Pi may
    // download missing runtime tools during startup. A user or launcher can
    // still opt into Pi's offline behavior by setting PI_OFFLINE in the base
    // process environment, which composeSpawnInputs preserves.
    // In particular, never inject PI_CODING_AGENT_DIR: Pi's normal project
    // settings layer selects the Workspace provider while its user agent dir
    // continues to own packages, auth, settings, resources, and sessions.
    return {};
  },

  async writeAiConfig(cwd: string, cred: WorkspaceAiCred): Promise<void> {
    const shellPath = process.platform === 'win32'
      ? resolveBashPath(process.env, 'win32')
      : runtimeProfileFromEnv().managedShellPath;
    await writePiWorkspaceConfig(cwd, cred, { shellPath });
  },

  async readAiConfig(cwd: string): Promise<WorkspaceAiCred | null> {
    return readPiWorkspaceConfig(cwd);
  },
};
