import { existsSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';

import type { CliAdapter, SpawnContext, WorkspaceAiCred } from '../cli-adapter.js';
import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js';

// Pi's per-workspace provider override. `models.json` is read from Pi's AGENT
// DIR, which has NO project-local layer — so we redirect the whole agent dir to
// `<cwd>/.pi-agent` via PI_CODING_AGENT_DIR (composeEnv) and drop models.json
// there. This is a DIFFERENT dir from `<cwd>/.pi` (Pi's project-local
// extensions/skills discovery, keyed off cwd and unaffected by
// PI_CODING_AGENT_DIR) — so the openalice-cli skill in `<cwd>/.pi/skills` still
// resolves. Verified against pi 0.78.1 (`dist/core/model-registry.js:144-157`,
// `dist/config.js:378,393-407`).
const PI_AGENT_DIR = '.pi-agent';
const PI_MODELS_PATH = `${PI_AGENT_DIR}/models.json`;
const PI_SETTINGS_PATH = `${PI_AGENT_DIR}/settings.json`;
const PI_PROVIDER_NAME = 'workspace';

/**
 * Pi (github.com/earendil-works/pi, by Mario Zechner; MIT). Open-source agent
 * CLI — the second non-claude/openai channel after opencode ("two suppliers",
 * the IBKR-superset dual-vendor stance). Verified against pi 0.78.1.
 *
 * TOOL ACCESS is NOT a per-CLI MCP bridge — Pi has no native MCP. It rides
 * OpenAlice's CLI-injection path: the `alice` shim is on PATH for every spawn
 * (`service.ts:220-224`) and the `openalice-cli` skill is copied to
 * `<cwd>/.pi/skills` (`context-injector.ts`); Pi's built-in `bash` tool calls
 * `alice <tool>`. trading/cron are MCP-only (`server/cli.ts:20`), so CLI-mode
 * Pi workspaces are analysis-only — a future trading-capable Pi workspace would
 * need an MCP bridge extension, deferred until there's a concrete need. See
 * memory feedback_cli_injection_over_mcp_bridge.
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

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Tools come from the CLI-injection path (alice on PATH + .pi/skills), not
    // flags — so the command head is just the binary + a resume flag (if any).
    const head = ['pi'];
    if (ctx.resume === undefined) return head;
    if (ctx.resume === 'last') return [...head, '--continue'];
    return [...head, '--session-id', ctx.resume.sessionId];
  },

  // Headless: `pi -p <prompt>` is non-interactive and exits at the turn
  // boundary. The MCP bridge + skills auto-load from `<cwd>/.pi` (process cwd =
  // workspace), so the agent reaches inbox_push without any flag. NOTE: pi
  // REJECTS a `--` end-of-options terminator ("Unknown option: --", verified
  // 0.78.1), so the prompt is a bare trailing positional — a prompt literally
  // starting with `-`/`--` is unprotected on pi (rare for task prompts).
  composeHeadlessCommand(_base: readonly string[], _ctx: SpawnContext, prompt: string): readonly string[] {
    return ['pi', '-p', '--mode', 'json', prompt];
  },

  composeEnv(ctx: SpawnContext): Record<string, string> {
    const env: Record<string, string> = {
      // Disable startup-only network ops (version check / install ping). Does
      // NOT block the `alice` CLI or the LLM call (verified pi 0.78.1).
      PI_OFFLINE: '1',
    };
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
    // ModelDefinitionSchema requires only `id` (model-registry.js:108-109);
    // TypeBox Type.Object rejects unknown props, so keep it to `{ id }`.
    if (cred.model) provider['models'] = [{ id: cred.model }];

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
    if (baseUrl === null && apiKey === null && model === null) return null;
    // Reverse the `api` field back to the wire shape.
    const api = p['api'];
    const wireShape = api === 'anthropic-messages' ? 'anthropic' as const
      : api === 'openai-responses' ? 'openai-responses' as const
      : 'openai-chat' as const;
    return { baseUrl, apiKey, model, wireShape };
  },
};
