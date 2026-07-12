import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import { runtimeProfileFromEnv } from '@/core/runtime-profile.js';
import { resolveBashPath } from '@/core/shell-resolver.js';

import type { CliAdapter, SpawnContext, WorkspaceAiCred } from '../cli-adapter.js';
import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js';
import type { HeadlessOutputEvent } from '../headless-output.js';

// Pi's per-workspace provider override. `models.json` is read from Pi's AGENT
// DIR, which has NO project-local layer — so we redirect the whole agent dir to
// `<cwd>/.pi-agent` via PI_CODING_AGENT_DIR (composeEnv) and drop models.json
// there. This does not affect project-resource discovery rooted at `cwd`: Pi
// officially discovers shared project skills from `<cwd>/.agents/skills`
// (walking ancestors to the repo root), so OpenAlice can use the same canonical
// copy as Codex without maintaining a duplicate `<cwd>/.pi/skills` tree.
// Verified against Pi 0.78.1 and the bundled 0.80.6.
const PI_AGENT_DIR = '.pi-agent';
const PI_MODELS_PATH = `${PI_AGENT_DIR}/models.json`;
const PI_SETTINGS_PATH = `${PI_AGENT_DIR}/settings.json`;
const PI_PROVIDER_NAME = 'workspace';

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

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
  const agentDir = join(cwd, PI_AGENT_DIR);
  if (!existsSync(agentDir)) return;
  const shellPath = resolveBashPath(process.env, 'win32');
  if (!shellPath) return;

  const raw = await readWorkspaceFile(cwd, PI_SETTINGS_PATH);
  let settings: Record<string, unknown> = {};
  if (raw !== null) {
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return;
      settings = parsed as Record<string, unknown>;
    } catch {
      // Pi owns this file too; do not overwrite a malformed/user-edited file.
      return;
    }
  }
  if (settings['shellPath'] === shellPath) return;
  await writeWorkspaceFile(
    cwd,
    PI_SETTINGS_PATH,
    JSON.stringify({ ...settings, shellPath }, null, 2) + '\n',
  );
}

function piHeadlessApproveArgs(env: Readonly<Record<string, string | undefined>>): readonly string[] {
  // The packaged app always uses OpenAlice's pinned managed Pi. Contributor
  // dev intentionally uses whatever `pi` is on PATH; its install/version/trust
  // policy belongs to that developer, so do not attach version-specific flags.
  return runtimeProfileFromEnv(env).managedPiPath ? ['--approve'] : [];
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
 * PROVIDER override: Pi has no `--base-url` flag and `models.json` has no
 * project layer, so per-workspace provider config goes through the redirected
 * agent dir holding `models.json` (+ `settings.json` pinning the default
 * provider/model). Reset deletes `.pi-agent/` → Pi falls back to the user's
 * global `~/.pi/agent`. v1 writes `api: "openai-completions"` (Chat Completions
 * — covers OpenAI-compatible + CN/local gateways); openai-responses /
 * anthropic-messages are future, add when a case appears.
 *
 * RESUME is first-class by-id (claude-level), via launcher-ASSIGNED id rather
 * than disk harvesting: `--session-id <id>` is create-or-reopen
 * (`dist/main.js:251-257`), so on a fresh spawn the launcher mints a uuid,
 * `composeCommand` emits `--session-id <uuid>`, and the launcher persists it as
 * `resumeHint` at spawn (capability `assignsSessionId`). Reattach then resumes
 * BY ID. This sidesteps pi's lazy transcript write (file only appears after the
 * first assistant turn) and the PI_CODING_AGENT_DIR redirect — neither matters
 * when the launcher already knows the id. transcriptDiscovery stays 'none'.
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
    // immune to pi's lazy transcript write + the PI_CODING_AGENT_DIR redirect.
    assignsSessionId: true,
    headless: true,
  },

  // Reconcile the derived Pi cache on every Windows launch so workspaces made
  // before the global shell setting existed pick it up without requiring a
  // credential rewrite. The helper returns before I/O on every other OS.
  async bootstrap({ cwd }): Promise<void> {
    await syncPiWindowsShellPath(cwd);
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Tools come from the CLI-injection path (alice on PATH + shared
    // .agents/skills), not flags — so the command head is just the binary + a
    // resume flag (if any).
    // Pi 0.79+ asks the user to trust project-local resources on interactive
    // startup. Do not answer that security decision for them: the prompt makes
    // the `.agents/skills` boundary visible, and omitting the flag also keeps
    // external Pi 0.78.x runtimes (which predate `--approve`) compatible.
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
      ...piHeadlessApproveArgs(ctx.env),
      '--session-id',
      ctx.resume.sessionId,
      '--mode',
      'rpc',
    ];
  },

  // Headless: `pi -p <prompt>` is non-interactive and exits at the turn
  // boundary, so there is nobody to answer Pi 0.79+'s project-trust prompt.
  // The packaged app explicitly approves its pinned managed Pi; contributor
  // dev leaves its external Pi untouched. Interactive sessions above always
  // leave the decision to the user. NOTE: pi
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

  composeEnv(ctx: SpawnContext): Record<string, string> {
    // Do not force PI_OFFLINE. OpenAlice is a networked product and Pi may
    // download missing runtime tools during startup. A user or launcher can
    // still opt into Pi's offline behavior by setting PI_OFFLINE in the base
    // process environment, which composeSpawnInputs preserves.
    const env: Record<string, string> = {};
    // Override mode only: redirect the agent dir to the workspace's models.json.
    // Absent ⇒ unset ⇒ Pi uses the user's global ~/.pi/agent (its normal state).
    const piAgentDir = join(ctx.cwd, PI_AGENT_DIR);
    if (existsSync(piAgentDir)) {
      env['PI_CODING_AGENT_DIR'] = piAgentDir;
    }
    return env;
  },

  async writeAiConfig(cwd: string, cred: WorkspaceAiCred): Promise<void> {
    const hasProvider = !!(cred.baseUrl || cred.apiKey || cred.model);
    if (!hasProvider) {
      // Reset: drop the redirected agent dir → Pi falls back to global config.
      await rm(join(cwd, PI_AGENT_DIR), { recursive: true, force: true });
      return;
    }

    // Pi's `api` field is the wire shape: anthropic-messages / openai-responses /
    // openai-completions (Chat Completions, the default for CN/local gateways).
    const api = cred.wireShape === 'anthropic' ? 'anthropic-messages'
      : cred.wireShape === 'openai-responses' ? 'openai-responses'
      : 'openai-completions';
    const provider: Record<string, unknown> = {
      name: 'OpenAlice workspace provider',
      api,
    };
    if (cred.baseUrl) provider['baseUrl'] = cred.baseUrl;
    // Key written directly into the workspace file (same trust model as codex's
    // .codex/env.json / opencode's opencode.json).
    if (cred.apiKey) provider['apiKey'] = cred.apiKey;
    // Pi's custom model registry otherwise falls back to 128k. OpenAlice writes
    // the context window when known so long-context models do not compact early.
    if (cred.model) {
      const model: Record<string, unknown> = { id: cred.model };
      const contextWindow = positiveNumber(cred.contextWindow);
      if (contextWindow !== null) model['contextWindow'] = contextWindow;
      provider['models'] = [model];
    }

    await writeWorkspaceFile(
      cwd,
      PI_MODELS_PATH,
      JSON.stringify({ providers: { [PI_PROVIDER_NAME]: provider } }, null, 2) + '\n',
    );

    // Pin the default provider/model so spawns use the workspace provider
    // without --provider/--model. Lives in the SAME .pi-agent dir so reset
    // (rm .pi-agent) tears both down together.
    const settings: Record<string, unknown> = { defaultProvider: PI_PROVIDER_NAME };
    if (cred.model) settings['defaultModel'] = cred.model;
    // Windows has one installation-wide workspace-shell decision (managed Git
    // Bash, auto-detected Git for Windows, or an explicit user override). Pi's
    // settings file is a derived cache, refreshed whenever its workspace AI
    // config is reconciled. Non-Windows behavior stays exactly as before.
    const shellPath = process.platform === 'win32'
      ? resolveBashPath(process.env, 'win32')
      : runtimeProfileFromEnv().managedShellPath;
    if (shellPath) settings['shellPath'] = shellPath;
    await writeWorkspaceFile(cwd, PI_SETTINGS_PATH, JSON.stringify(settings, null, 2) + '\n');
  },

  async readAiConfig(cwd: string): Promise<WorkspaceAiCred | null> {
    const raw = await readWorkspaceFile(cwd, PI_MODELS_PATH);
    if (raw === null) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    const providers = (parsed['providers'] ?? {}) as Record<string, unknown>;
    const p = (providers[PI_PROVIDER_NAME] ?? {}) as Record<string, unknown>;
    const baseUrl = typeof p['baseUrl'] === 'string' ? (p['baseUrl'] as string) : null;
    const apiKey = typeof p['apiKey'] === 'string' ? (p['apiKey'] as string) : null;
    const models = Array.isArray(p['models']) ? (p['models'] as Array<Record<string, unknown>>) : [];
    const first = models[0];
    const model = first && typeof first['id'] === 'string' ? (first['id'] as string) : null;
    const contextWindow = first && positiveNumber(first['contextWindow'] as number | null | undefined);
    if (baseUrl === null && apiKey === null && model === null) return null;
    // Reverse the `api` field back to the wire shape.
    const api = p['api'];
    const wireShape = api === 'anthropic-messages' ? 'anthropic' as const
      : api === 'openai-responses' ? 'openai-responses' as const
      : 'openai-chat' as const;
    return { baseUrl, apiKey, model, wireShape, ...(contextWindow ? { contextWindow } : {}) };
  },
};
