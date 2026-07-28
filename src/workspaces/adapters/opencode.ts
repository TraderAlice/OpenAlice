import { execFile } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type {
  CliAdapter,
  HeadlessRunOverrides,
  OnDiskSession,
  SpawnContext,
  WorkspaceAiCred,
} from '../cli-adapter.js';
import {
  MODEL_REASONING_EFFORTS,
  isModelReasoningEffort,
  type ModelReasoningEffort,
} from '../../ai-providers/model-semantics.js';
import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js';
import type { HeadlessOutputEvent } from '../headless-output.js';
import { resetOwnedJsonConfig, writeOwnedJsonConfig } from './owned-json-config.js';

const execFileAsync = promisify(execFile);

const OPENCODE_CONFIG_PATH = 'opencode.json';
const OPENCODE_TUI_CONFIG_PATH = 'tui.json';
const OPENCODE_TUI_CONFIGC_PATH = 'tui.jsonc';
const OPENCODE_BINDING_STATE_PATH = '.opencode/openalice-provider.json';
const OPENCODE_PROVIDER_NAME = 'workspace';
const OPENCODE_SYSTEM_THEME = 'system';
const OPENCODE_OWNED_PATHS = [
  ['$schema'],
  ['provider', OPENCODE_PROVIDER_NAME],
  ['model'],
] as const;
const DEFAULT_OUTPUT_TOKENS = 16_384;

function opencodeRunModel(cwd: string, model: string): string {
  if (model.includes('/')) return model;
  try {
    const config = JSON.parse(readFileSync(join(cwd, OPENCODE_CONFIG_PATH), 'utf8')) as Record<string, unknown>;
    const providers = config['provider'];
    const workspace = providers && typeof providers === 'object'
      ? (providers as Record<string, unknown>)[OPENCODE_PROVIDER_NAME]
      : null;
    const models = workspace && typeof workspace === 'object'
      ? (workspace as Record<string, unknown>)['models']
      : null;
    if (models && typeof models === 'object') {
      if (Object.prototype.hasOwnProperty.call(models, model)) {
        return `${OPENCODE_PROVIDER_NAME}/${model}`;
      }
      throw new Error(
        `OpenCode model override "${model}" is not registered by this Workspace provider; use a provider/model id or save that model in Workspace AI settings first`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenCode model override')) throw err;
  }
  return model;
}

function opencodeRunVariant(
  cwd: string,
  requestedModel: string | undefined,
  effort: ModelReasoningEffort,
): string {
  if (requestedModel?.includes('/')) return effort;
  try {
    const config = JSON.parse(readFileSync(join(cwd, OPENCODE_CONFIG_PATH), 'utf8')) as Record<string, unknown>;
    const topModel = typeof config['model'] === 'string' ? config['model'] : null;
    const model = requestedModel
      ?? (topModel?.startsWith(`${OPENCODE_PROVIDER_NAME}/`)
        ? topModel.slice(OPENCODE_PROVIDER_NAME.length + 1)
        : null);
    if (!model) return effort;
    const providers = config['provider'];
    const workspace = providers && typeof providers === 'object'
      ? (providers as Record<string, unknown>)[OPENCODE_PROVIDER_NAME]
      : null;
    const models = workspace && typeof workspace === 'object'
      ? (workspace as Record<string, unknown>)['models']
      : null;
    const modelConfig = models && typeof models === 'object'
      ? (models as Record<string, unknown>)[model]
      : null;
    if (!modelConfig || typeof modelConfig !== 'object') return effort;
    const variants = (modelConfig as Record<string, unknown>)['variants'];
    if (!variants || typeof variants !== 'object' || !Object.prototype.hasOwnProperty.call(variants, effort)) {
      throw new Error(
        `OpenCode effort override "${effort}" is not registered for Workspace model "${model}"`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('OpenCode effort override')) throw err;
  }
  return effort;
}

function modelEffortOptions(
  cred: WorkspaceAiCred,
  effort = cred.reasoningEffort,
): Record<string, unknown> | null {
  if (!effort) return null;
  if (cred.wireShape === 'anthropic') {
    if (effort === 'none') return { thinking: { type: 'disabled' } };
    // Current Claude adaptive models require the thinking mode alongside
    // output effort. Other Anthropic-compatible providers such as GLM expose
    // effort directly and can reject Claude-specific thinking objects.
    const id = cred.model?.toLowerCase() ?? '';
    return id.includes('claude') || id.includes('fable')
      ? { thinking: { type: 'adaptive' }, effort }
      : { effort };
  }
  if (cred.wireShape === 'google-generative-ai') {
    return effort === 'none'
      ? { thinkingConfig: { includeThoughts: false } }
      : { thinkingConfig: { includeThoughts: true, thinkingLevel: effort } };
  }
  return { reasoningEffort: effort };
}

function modelEffortVariants(cred: WorkspaceAiCred): Record<string, Record<string, unknown>> | null {
  if (cred.reasoning === false) return null;
  return Object.fromEntries(
    MODEL_REASONING_EFFORTS.map((effort) => [
      effort,
      modelEffortOptions(cred, effort) ?? {},
    ]),
  );
}

function readModelEffort(
  options: Record<string, unknown>,
  wireShape: NonNullable<WorkspaceAiCred['wireShape']>,
): WorkspaceAiCred['reasoningEffort'] {
  if (wireShape === 'anthropic') {
    const thinking = options['thinking'];
    if (thinking && typeof thinking === 'object' && (thinking as Record<string, unknown>)['type'] === 'disabled') {
      return 'none';
    }
    return isModelReasoningEffort(options['effort']) ? options['effort'] : undefined;
  }
  if (wireShape === 'google-generative-ai') {
    const thinking = options['thinkingConfig'];
    if (!thinking || typeof thinking !== 'object') return undefined;
    const level = (thinking as Record<string, unknown>)['thinkingLevel'];
    return isModelReasoningEffort(level) ? level : undefined;
  }
  return isModelReasoningEffort(options['reasoningEffort']) ? options['reasoningEffort'] : undefined;
}
// opencode's `@ai-sdk/openai-compatible` SDK is statically bundled into the
// binary (no runtime `npm install`) and speaks `/v1/chat/completions` — the
// right shape for OpenAI-compatible + Chinese gateways (DeepSeek/Qwen/Kimi/
// GLM/MiniMax) and local runtimes (ollama/vLLM/LM Studio). v1 provider
// overrides always use this SDK; an Anthropic-shape override would swap to
// `@ai-sdk/anthropic` (also bundled) — deferred until there's a real case.
const OPENCODE_SDK_NPM = '@ai-sdk/openai-compatible';

function positiveNumber(value: number | null | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function parseJsonRecord(raw: string | null): Record<string, unknown> | null {
  if (raw === null) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

async function ensureOpenCodeTuiConfigExcluded(cwd: string): Promise<void> {
  // OpenAlice workspaces are Git repositories, but adapter tests and external
  // callers may prepare a plain directory. Do not manufacture a partial .git.
  try {
    if (!statSync(join(cwd, '.git')).isDirectory()) return;
  } catch {
    return;
  }
  const path = '.git/info/exclude';
  const current = await readWorkspaceFile(cwd, path) ?? '';
  if (current.split(/\r?\n/).includes(OPENCODE_TUI_CONFIG_PATH)) return;
  const separator = current.length === 0 || current.endsWith('\n') ? '' : '\n';
  await writeWorkspaceFile(cwd, path, `${current}${separator}${OPENCODE_TUI_CONFIG_PATH}\n`);
}

/**
 * Select OpenCode's native terminal-derived theme for OpenAlice workspaces.
 * The dedicated tui.json layer is supported by OpenCode 1.16+ and has higher
 * precedence than global TUI settings. Existing native project configuration,
 * including the legacy opencode.json theme that OpenCode migrates itself,
 * remains user-owned.
 */
export async function syncOpenCodeWorkspaceTheme(cwd: string): Promise<boolean> {
  await ensureOpenCodeTuiConfigExcluded(cwd);

  // A JSONC project file is user-owned. Avoid creating a competing tui.json
  // because OpenCode accepts both and their same-directory ordering is native.
  if (await readWorkspaceFile(cwd, OPENCODE_TUI_CONFIGC_PATH) !== null) return false;

  const tui = parseJsonRecord(await readWorkspaceFile(cwd, OPENCODE_TUI_CONFIG_PATH));
  if (tui === null || Object.prototype.hasOwnProperty.call(tui, 'theme')) return false;

  const legacy = parseJsonRecord(await readWorkspaceFile(cwd, OPENCODE_CONFIG_PATH));
  if (legacy === null || Object.prototype.hasOwnProperty.call(legacy, 'theme')) return false;

  tui['$schema'] ??= 'https://opencode.ai/tui.json';
  tui['theme'] = OPENCODE_SYSTEM_THEME;
  await writeWorkspaceFile(cwd, OPENCODE_TUI_CONFIG_PATH, `${JSON.stringify(tui, null, 2)}\n`);
  return true;
}

/**
 * opencode (github.com/anomalyco/opencode, formerly sst/opencode; MIT, by
 * Dax Raad / SST). Provider-agnostic open-source agent CLI — the third adapter
 * after claude + codex, added to (a) escape Claude Code's closed/opaque
 * surface and (b) reach the Chat-Completions ecosystem (CN + local models)
 * that codex's Responses-only lock can't touch.
 *
 * Contract VERIFIED against opencode 1.16.0 on macOS and the Docker-pinned
 * 1.17.18 (`opencode --help`, provider config, headless resume, CLI tool calls,
 * and live traderhub data; 2026-07):
 *
 *   - Tool access: OpenAlice tools are exposed through the injected
 *     `alice*` / `traderhub` CLI shims, not opencode's native MCP config.
 *     We intentionally do not set `OPENCODE_CONFIG_CONTENT`: leaving opencode's
 *     native config surface alone avoids hidden app-mode ports and keeps the
 *     workspace tooling path identical to pi/shell/headless CLI usage.
 *
 *   - Provider override: `opencode.json` `provider.<name>` with a custom
 *     `baseURL` + `apiKey` + a top-level default `model = "<provider>/<id>"`.
 *     Key written directly into the workspace file (same trust model as codex's
 *     `.codex/env.json`). OpenAlice owns only `provider.workspace`, the matching
 *     top-level model, and its schema marker; unrelated opencode config survives
 *     both writes and reset.
 *
 *   - Terminal appearance: the shared runtime lifecycle selects OpenCode's
 *     native `system` TUI theme through `tui.json` only when the project has
 *     no explicit TUI/legacy theme config. OpenCode then derives its palette
 *     from the terminal and handles mode 2031 updates itself.
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
  binary: 'opencode',
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

  lifecycle: {
    async prepareWorkspace({ cwd }): Promise<void> {
      await syncOpenCodeWorkspaceTheme(cwd);
    },
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Tool access is via the injected CLI shims, so the command head is just
    // the binary + a resume flag (if any). Resume is a top-level flag on the
    // bare TUI — verified against opencode 1.16.0.
    const head = ['opencode'];
    if (ctx.resume === undefined) {
      // Quick-chat seed: `opencode --prompt <text>` opens the TUI seeded with
      // that first message (top-level flag on the default TUI command, verified
      // 1.16.0). The value is a flag argument, so a `-`-leading prompt needs no
      // `--` terminator. Fresh spawns only.
      if (ctx.initialPrompt) return [...head, '--prompt', ctx.initialPrompt];
      return head;
    }
    if (ctx.resume === 'last') return [...head, '--continue'];
    return [...head, '--session', ctx.resume.sessionId];
  },

  // Headless: `opencode run <prompt>` is non-interactive and exits at the turn
  // boundary. Tool access is via the injected CLI shims and bundled skills;
  // prompt is the trailing positional after a `--` end-of-options terminator
  // (so a `-`-leading prompt isn't read as a flag).
  composeHeadlessCommand(
    _base: readonly string[],
    ctx: SpawnContext,
    prompt: string,
    overrides?: HeadlessRunOverrides,
  ): readonly string[] {
    return [
      'opencode', 'run', '--format', 'json',
      ...(overrides?.model ? ['--model', opencodeRunModel(ctx.cwd, overrides.model)] : []),
      ...(overrides?.reasoningEffort
        ? ['--variant', opencodeRunVariant(ctx.cwd, overrides.model, overrides.reasoningEffort)]
        : []),
      ...(ctx.resume === 'last' ? ['--continue'] : ctx.resume ? ['--session', ctx.resume.sessionId] : []),
      '--', prompt,
    ];
  },

  // `opencode run --format json` events carry a top-level `sessionID`
  // (`ses_…`) from the first line (verified 2026-06-11) — resumable via
  // `opencode --session <id>`.
  extractHeadlessSessionId(line: string): string | null {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      return typeof evt['sessionID'] === 'string' ? evt['sessionID'] : null;
    } catch {
      return null;
    }
  },

  extractHeadlessAssistantText(line: string): string | null {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (evt['type'] !== 'text') return null;
      const part = evt['part'];
      if (!part || typeof part !== 'object') return null;
      const record = part as Record<string, unknown>;
      return record['type'] === 'text' && typeof record['text'] === 'string'
        ? record['text']
        : null;
    } catch {
      return null;
    }
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (evt['type'] === 'error') {
        const error = evt['error'];
        const record = error && typeof error === 'object' ? error as Record<string, unknown> : null;
        const data = record?.['data'] && typeof record['data'] === 'object'
          ? record['data'] as Record<string, unknown>
          : null;
        const message = typeof data?.['message'] === 'string'
          ? data['message']
          : typeof record?.['message'] === 'string'
            ? record['message']
            : typeof record?.['name'] === 'string'
              ? record['name']
              : typeof error === 'string'
                ? error
                : 'OpenCode session failed';
        return [{ type: 'error', message }];
      }
      const part = evt['part'];
      if (!part || typeof part !== 'object') return [];
      const record = part as Record<string, unknown>;
      if (evt['type'] === 'text' && record['type'] === 'text' && typeof record['text'] === 'string') {
        return [{ type: 'text', text: record['text'] }];
      }
      if (evt['type'] !== 'tool_use' && record['type'] !== 'tool') return [];
      const state = record['state'] && typeof record['state'] === 'object'
        ? record['state'] as Record<string, unknown>
        : {};
      const id = typeof record['callID'] === 'string'
        ? record['callID']
        : typeof record['id'] === 'string'
          ? record['id']
          : `opencode-${record['tool'] ?? 'tool'}`;
      const name = typeof record['tool'] === 'string'
        ? record['tool']
        : typeof record['name'] === 'string'
          ? record['name']
          : 'Tool';
      const start: HeadlessOutputEvent = {
        type: 'tool-start',
        id,
        name,
        ...(state['input'] !== undefined || record['input'] !== undefined
          ? { input: state['input'] ?? record['input'] }
          : {}),
      };
      const status = state['status'];
      if (status !== 'completed' && status !== 'error' && status !== 'failed') return [start];
      return [start, {
        type: 'tool-finish',
        id,
        name,
        ...(state['output'] !== undefined || state['error'] !== undefined
          ? { output: state['output'] ?? state['error'] }
          : {}),
        ...(status === 'error' || status === 'failed' ? { isError: true } : {}),
      }];
    } catch {
      return [];
    }
  },

  composeEnv(ctx: SpawnContext): Record<string, string> {
    const env: Record<string, string> = {
      OPENCODE_DISABLE_MODELS_FETCH: '1',
      OPENCODE_DISABLE_AUTOUPDATE: '1',
      OPENCODE_DISABLE_LSP_DOWNLOAD: '1',
    };

    return env;
  },

  async writeAiConfig(cwd: string, cred: WorkspaceAiCred): Promise<void> {
    const hasProvider = !!(cred.baseUrl || cred.apiKey || cred.model);
    if (!hasProvider) {
      await resetOwnedJsonConfig({
        cwd,
        configPath: OPENCODE_CONFIG_PATH,
        statePath: OPENCODE_BINDING_STATE_PATH,
        label: 'opencode project config',
        legacyOwnedPaths: OPENCODE_OWNED_PATHS,
      });
      return;
    }

    const options: Record<string, unknown> = {};
    if (cred.baseUrl) options['baseURL'] = cred.baseUrl;
    if (cred.apiKey) {
      if (cred.wireShape === 'anthropic' && cred.authMode === 'bearer') {
        // Do not also set apiKey: @ai-sdk/anthropic would add x-api-key and
        // bearer-only gateways can reject the resulting dual-auth request.
        options['headers'] = { Authorization: `Bearer ${cred.apiKey}` };
      } else {
        options['apiKey'] = cred.apiKey;
      }
    }

    // The @ai-sdk package opencode loads depends on the wire shape (all bundled):
    // anthropic → @ai-sdk/anthropic, Google Generative AI → @ai-sdk/google,
    // OpenAI Responses → @ai-sdk/openai, and OpenAI Chat Completions → the
    // openai-compatible SDK.
    const npm = cred.wireShape === 'anthropic' ? '@ai-sdk/anthropic'
      : cred.wireShape === 'google-generative-ai' ? '@ai-sdk/google'
      : cred.wireShape === 'openai-responses' ? '@ai-sdk/openai'
      : OPENCODE_SDK_NPM;
    const provider: Record<string, unknown> = {
      npm,
      name: 'OpenAlice workspace provider',
      options,
    };
    if (cred.model) {
      const model: Record<string, unknown> = { name: cred.model };
      if (typeof cred.reasoning === 'boolean') model['reasoning'] = cred.reasoning;
      const effortOptions = modelEffortOptions(cred);
      if (effortOptions) model['options'] = effortOptions;
      const effortVariants = modelEffortVariants(cred);
      if (effortVariants) model['variants'] = effortVariants;
      const contextWindow = positiveNumber(cred.contextWindow);
      if (contextWindow !== null) {
        // opencode treats missing custom-model limits as 0, which disables its
        // proactive context tracking. Supplying both fields satisfies its config
        // schema while keeping output conservative and invisible in OpenAlice UI.
        model['limit'] = { context: contextWindow, output: DEFAULT_OUTPUT_TOKENS };
      }
      provider['models'] = { [cred.model]: model };
    }

    // Top-level default model is "<provider>/<id>" so opencode resolves the
    // workspace provider without a UI model picker. The reversible state keeps
    // any pre-existing provider/model/options and restores them on reset.
    await writeOwnedJsonConfig({
      cwd,
      configPath: OPENCODE_CONFIG_PATH,
      statePath: OPENCODE_BINDING_STATE_PATH,
      label: 'opencode project config',
      entries: [
        { path: ['$schema'], present: true, value: 'https://opencode.ai/config.json' },
        { path: ['provider', OPENCODE_PROVIDER_NAME], present: true, value: provider },
        {
          path: ['model'],
          present: !!cred.model,
          value: cred.model ? `${OPENCODE_PROVIDER_NAME}/${cred.model}` : undefined,
        },
      ],
    });
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
    const headers = (options['headers'] ?? {}) as Record<string, unknown>;
    const authorization = typeof headers['Authorization'] === 'string'
      ? headers['Authorization']
      : typeof headers['authorization'] === 'string'
        ? headers['authorization']
        : null;
    const bearerKey = authorization?.match(/^Bearer\s+(.+)$/i)?.[1] ?? null;
    const apiKey = typeof options['apiKey'] === 'string' ? (options['apiKey'] as string) : bearerKey;
    // Top-level model is "<provider>/<id>"; surface just the id back to the modal.
    let model: string | null = null;
    const top = parsed['model'];
    if (typeof top === 'string') {
      const slash = top.indexOf('/');
      model = slash >= 0 ? top.slice(slash + 1) : top;
    }
    const models = (ws['models'] ?? {}) as Record<string, Record<string, unknown>>;
    const modelConfig = model ? models[model] : undefined;
    const limit = (modelConfig?.['limit'] ?? {}) as Record<string, unknown>;
    const contextWindow = positiveNumber(limit['context'] as number | null | undefined);
    const reasoning = typeof modelConfig?.['reasoning'] === 'boolean'
      ? modelConfig['reasoning']
      : undefined;
    if (baseUrl === null && apiKey === null && model === null) return null;
    // Reverse the npm package back to the wire shape.
    const npm = typeof ws['npm'] === 'string' ? (ws['npm'] as string) : '';
    const wireShape = npm === '@ai-sdk/anthropic' ? 'anthropic' as const
      : npm === '@ai-sdk/google' ? 'google-generative-ai' as const
      : npm === '@ai-sdk/openai' ? 'openai-responses' as const
      : 'openai-chat' as const;
    const modelOptions = modelConfig?.['options'];
    const reasoningEffort = modelOptions && typeof modelOptions === 'object'
      ? readModelEffort(modelOptions as Record<string, unknown>, wireShape)
      : undefined;
    return {
      baseUrl,
      apiKey,
      model,
      wireShape,
      ...(wireShape === 'anthropic' ? { authMode: bearerKey ? 'bearer' as const : 'x-api-key' as const } : {}),
      ...(contextWindow ? { contextWindow } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
      ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
    };
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
