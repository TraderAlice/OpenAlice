import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { CliAdapter, OnDiskSession, SpawnContext, WorkspaceAiCred } from '../cli-adapter.js';
import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js';

const execFileAsync = promisify(execFile);

const OPENCODE_CONFIG_PATH = 'opencode.json';
const OPENCODE_PROVIDER_NAME = 'workspace';
// opencode's `@ai-sdk/openai-compatible` SDK is statically bundled into the
// binary (no runtime `npm install`) and speaks `/v1/chat/completions` — the
// right shape for OpenAI-compatible + Chinese gateways (DeepSeek/Qwen/Kimi/
// GLM/MiniMax) and local runtimes (ollama/vLLM/LM Studio). v1 provider
// overrides always use this SDK; an Anthropic-shape override would swap to
// `@ai-sdk/anthropic` (also bundled) — deferred until there's a real case.
const OPENCODE_SDK_NPM = '@ai-sdk/openai-compatible';

/**
 * opencode (github.com/anomalyco/opencode, formerly sst/opencode; MIT, by
 * Dax Raad / SST). Provider-agnostic open-source agent CLI — the third adapter
 * after claude + codex, added to (a) escape Claude Code's closed/opaque
 * surface and (b) reach the Chat-Completions ecosystem (CN + local models)
 * that codex's Responses-only lock can't touch.
 *
 * Contract VERIFIED against opencode 1.16.0 on macOS (`opencode --help` +
 * an `opencode debug config` injection smoke, 2026-06):
 *
 *   - MCP injection: opencode reads config from many layers; the strongest
 *     knob a launcher controls is `OPENCODE_CONFIG_CONTENT` (inline JSON in
 *     env, precedence below only MDM-managed config, deep-MERGED with the
 *     workspace's own `opencode.json`). We inject OpenAlice's two MCP servers
 *     there in `composeEnv` — the `mcp` block merges in without clobbering the
 *     `provider` block written to `opencode.json`. This is the cleaner analogue
 *     of codex's per-spawn `-c mcp_servers...` flags. Verified via
 *     `opencode debug config`: the file's `provider` and the env's `mcp` block
 *     both land in the resolved config (disjoint top-level keys; remeda
 *     mergeDeep), and `$schema` passes opencode's strict top-level-key check.
 *
 *   - Provider override: `opencode.json` `provider.<name>` with a custom
 *     `baseURL` + `apiKey` + a top-level default `model = "<provider>/<id>"`.
 *     Key written directly into the workspace file (same trust model as codex's
 *     `.codex/env.json`). Reset deletes the file → opencode falls back to its
 *     global auth.
 *
 *   - Hermetic spawn: `OPENCODE_DISABLE_{MODELS_FETCH,AUTOUPDATE,LSP_DOWNLOAD}`
 *     pinned in `composeEnv` so a trading workbench never phones home at spawn
 *     (opencode has no covert telemetry — these kill its *functional* outbound
 *     calls; provider/models are supplied explicitly so the model catalog is
 *     never needed).
 *
 *   - Resume: the bare TUI command (`opencode [project]`, the default) accepts
 *     top-level `-c/--continue` (last session in cwd) and `-s/--session <id>`
 *     (specific session) — verified in `opencode --help` 1.16.0. So resume is a
 *     flag (like claude's `--resume`), not a subcommand (like codex's `resume`).
 *     Both resumeLast and resumeById are on — by-id resume is LIVE via
 *     transcriptDiscovery 'subprocess' (see below).
 *
 *   - Transcript discovery: 'subprocess'. opencode sessions are SQLite rows
 *     (not per-cwd files), and it mints its own `ses_…` ids with no way for the
 *     launcher to assign one at spawn (verified against v1.16.0 source: the
 *     public `POST /session` schema omits `id`). So `listOnDisk` shells out to
 *     `opencode session list --format json` (cwd-scoped) post-spawn; the
 *     transcript watcher polls it, captures the new session's id, and persists
 *     it as resumeHint → `opencode --session <id>` resumes by id.
 */
export const opencodeAdapter: CliAdapter = {
  id: 'opencode',
  displayName: 'opencode',
  // claude='c', codex='x' already taken; 'o' is free.
  namePrefix: 'o',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    // by-id resume: opencode can't be assigned an id at spawn and its sessions
    // are SQLite rows (no per-cwd files to fs-watch), but `opencode session
    // list --format json` is cwd-scoped — so the watcher polls `listOnDisk`
    // post-spawn, captures the id, persists it as resumeHint, and
    // `opencode --session <id>` (composeCommand) resumes by id.
    transcriptDiscovery: 'subprocess',
    headless: true,
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // MCP is injected via OPENCODE_CONFIG_CONTENT (composeEnv), not flags, so
    // the command head is just the binary + a resume flag (if any). Resume is a
    // top-level flag on the bare TUI — verified against opencode 1.16.0.
    const head = ['opencode'];
    if (ctx.resume === undefined) return head;
    if (ctx.resume === 'last') return [...head, '--continue'];
    return [...head, '--session', ctx.resume.sessionId];
  },

  // Headless: `opencode run <prompt>` is non-interactive and exits at the turn
  // boundary. MCP rides OPENCODE_CONFIG_CONTENT (composeEnv, same as
  // interactive) so the agent reaches inbox_push; prompt is the trailing
  // positional after a `--` end-of-options terminator (so a `-`-leading prompt
  // isn't read as a flag).
  composeHeadlessCommand(_base: readonly string[], _ctx: SpawnContext, prompt: string): readonly string[] {
    return ['opencode', 'run', '--format', 'json', '--', prompt];
  },

  composeEnv(ctx: SpawnContext): Record<string, string> {
    const env: Record<string, string> = {
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    };

    // Inject OpenAlice's MCP servers per-spawn via inline config. Read from the
    // spawn-bound env (service.ts populates the real MCP port per spawn), NOT
    // process.env — mirrors codexAdapter.composeCommand. Fail loud if missing:
    // a workspace silently spawned without trading context is worse than a hard
    // error (matches the codebase's loud-failure stance).
    const mcpUrl = ctx.env['OPENALICE_MCP_URL'];
    if (!mcpUrl) {
      throw new Error('opencode adapter: OPENALICE_MCP_URL missing from spawn env');
    }
    const workspaceId = ctx.env['AQ_WS_ID'];
    if (!workspaceId) {
      throw new Error('opencode adapter: AQ_WS_ID missing from spawn env');
    }
    const inline = {
      mcp: {
        openalice: { type: 'remote', url: mcpUrl, enabled: true },
        'openalice-workspace': { type: 'remote', url: `${mcpUrl}/${workspaceId}`, enabled: true },
      },
    };
    env['OPENCODE_CONFIG_CONTENT'] = JSON.stringify(inline);
    return env;
  },

  async writeAiConfig(cwd: string, cred: WorkspaceAiCred): Promise<void> {
    const hasProvider = !!(cred.baseUrl || cred.apiKey || cred.model);
    if (!hasProvider) {
      // Reset: delete the workspace opencode.json so opencode falls back to its
      // global auth/config. No empty stub left behind.
      await rm(join(cwd, OPENCODE_CONFIG_PATH), { force: true });
      return;
    }

    const options: Record<string, string> = {};
    if (cred.baseUrl) options['baseURL'] = cred.baseUrl;
    if (cred.apiKey) options['apiKey'] = cred.apiKey;

    // The @ai-sdk package opencode loads depends on the wire shape (all bundled):
    // anthropic → @ai-sdk/anthropic, OpenAI Responses → @ai-sdk/openai, and
    // OpenAI Chat Completions (the default — CN/local gateways) → the
    // openai-compatible SDK.
    const npm = cred.wireShape === 'anthropic' ? '@ai-sdk/anthropic'
      : cred.wireShape === 'openai-responses' ? '@ai-sdk/openai'
      : OPENCODE_SDK_NPM;
    const provider: Record<string, unknown> = {
      npm,
      name: 'OpenAlice workspace provider',
      options,
    };
    if (cred.model) {
      provider['models'] = { [cred.model]: { name: cred.model } };
    }

    const config: Record<string, unknown> = {
      $schema: 'https://opencode.ai/config.json',
      provider: { [OPENCODE_PROVIDER_NAME]: provider },
    };
    // Top-level default model is "<provider>/<id>" so opencode resolves the
    // workspace provider without a UI model picker.
    if (cred.model) config['model'] = `${OPENCODE_PROVIDER_NAME}/${cred.model}`;

    await writeWorkspaceFile(cwd, OPENCODE_CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
  },

  async readAiConfig(cwd: string): Promise<WorkspaceAiCred | null> {
    const raw = await readWorkspaceFile(cwd, OPENCODE_CONFIG_PATH);
    if (raw === null) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    const provider = (parsed['provider'] ?? {}) as Record<string, unknown>;
    const ws = (provider[OPENCODE_PROVIDER_NAME] ?? {}) as Record<string, unknown>;
    const options = (ws['options'] ?? {}) as Record<string, unknown>;
    const baseUrl = typeof options['baseURL'] === 'string' ? (options['baseURL'] as string) : null;
    const apiKey = typeof options['apiKey'] === 'string' ? (options['apiKey'] as string) : null;
    // Top-level model is "<provider>/<id>"; surface just the id back to the modal.
    let model: string | null = null;
    const top = parsed['model'];
    if (typeof top === 'string') {
      const slash = top.indexOf('/');
      model = slash >= 0 ? top.slice(slash + 1) : top;
    }
    if (baseUrl === null && apiKey === null && model === null) return null;
    // Reverse the npm package back to the wire shape.
    const npm = typeof ws['npm'] === 'string' ? (ws['npm'] as string) : '';
    const wireShape = npm === '@ai-sdk/anthropic' ? 'anthropic' as const
      : npm === '@ai-sdk/openai' ? 'openai-responses' as const
      : 'openai-chat' as const;
    return { baseUrl, apiKey, model, wireShape };
  },

  /**
   * List opencode sessions for THIS workspace cwd, for the watcher's post-spawn
   * id capture. opencode stores sessions as SQLite rows (no per-cwd files), but
   * `opencode session list --format json` is cwd-scoped — so we shell out with
   * cwd set to the workspace. Hermetic env (same disables as composeEnv).
   * Failure (binary missing / bad json) degrades to [] → resume falls back to
   * `--continue`.
   */
  async listOnDisk(cwd: string): Promise<readonly OnDiskSession[]> {
    let stdout: string;
    try {
      const res = await execFileAsync('opencode', ['session', 'list', '--format', 'json'], {
        cwd,
        env: {
          ...process.env,
          OPENCODE_DISABLE_MODELS_FETCH: '1',
          OPENCODE_DISABLE_AUTOUPDATE: '1',
          OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
        },
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      });
      stdout = res.stdout;
    } catch {
      return [];
    }
    let rows: unknown;
    try {
      rows = JSON.parse(stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(rows)) return [];
    const out: OnDiskSession[] = [];
    for (const r of rows as Array<Record<string, unknown>>) {
      const id = r['id'];
      if (typeof id !== 'string') continue;
      const ts = r['updated'] ?? r['created'];
      const mtime = typeof ts === 'number' ? new Date(ts).toISOString() : String(ts ?? '');
      out.push({ sessionId: id, file: '', mtime, sizeBytes: 0 });
    }
    return out;
  },
};
