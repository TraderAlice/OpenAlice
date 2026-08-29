import { realpathSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ModelReasoningEffort } from '../../ai-providers/model-semantics.js';
import type {
  CliAdapter,
  OnDiskSession,
  ResolvedSessionRuntimeBinding,
  SpawnContext,
} from '../cli-adapter.js';
import type { HeadlessOutputEvent } from '../headless-output.js';

const GEMINI_OFFICIAL_HOST = 'generativelanguage.googleapis.com';
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const AGY_RUN_EFFORTS = new Set<ModelReasoningEffort>([
  'low',
  'medium',
  'high',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Antigravity 1.1.13 keys `last_conversations.json` by the launch cwd.
 * On macOS `/tmp/foo` and `/private/tmp/foo` are the same directory;
 * listing must try both.
 */
export function agyCwdKeys(cwd: string): readonly string[] {
  const resolved = resolve(cwd);
  const keys = new Set<string>([resolved]);
  try {
    keys.add(realpathSync(resolved));
  } catch {
    // cwd may not exist yet (tests, first launch)
  }
  return [...keys];
}

export function agyHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['HOME']?.trim() || homedir();
  return join(home, '.gemini', 'antigravity-cli');
}

export function isOfficialGeminiBase(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim();
  if (trimmed === '') return true;
  try {
    return new URL(trimmed).hostname === GEMINI_OFFICIAL_HOST;
  } catch {
    return false;
  }
}

export function agyEffortArg(effort: ModelReasoningEffort): string {
  if (!AGY_RUN_EFFORTS.has(effort)) {
    throw new Error(`Antigravity cannot use Session effort ${effort}`);
  }
  return effort;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function conversationIdFrom(record: Record<string, unknown>): string | null {
  if (typeof record['conversation_id'] === 'string' && record['conversation_id']) {
    return record['conversation_id'];
  }
  const result = record['result'];
  if (isRecord(result) && typeof result['conversation_id'] === 'string' && result['conversation_id']) {
    return result['conversation_id'];
  }
  const step = record['step_update'];
  if (isRecord(step) && typeof step['conversation_id'] === 'string' && step['conversation_id']) {
    return step['conversation_id'];
  }
  return null;
}

function agyResumeArgs(resume: SpawnContext['resume']): readonly string[] {
  if (resume === undefined) return [];
  if (resume === 'last') return ['--continue'];
  return ['--conversation', resume.sessionId];
}

function agyRuntimeArgs(runtime: ResolvedSessionRuntimeBinding): readonly string[] {
  const effort = runtime.binding.reasoningEffort;
  if (effort && !AGY_RUN_EFFORTS.has(effort)) {
    throw new Error(`Antigravity cannot use Session effort ${effort}`);
  }
  return [
    ...(runtime.binding.model ? ['--model', runtime.binding.model] : []),
    ...(effort ? ['--effort', agyEffortArg(effort)] : []),
  ];
}

function agyCredentialEnv(ai: NonNullable<ResolvedSessionRuntimeBinding['ai']>): Record<string, string> {
  const env: Record<string, string> = {};
  if (ai.apiKey) env['GEMINI_API_KEY'] = ai.apiKey;
  if (ai.baseUrl && !isOfficialGeminiBase(ai.baseUrl)) {
    env['GOOGLE_GEMINI_BASE_URL'] = ai.baseUrl;
  }
  return env;
}

function toolStepId(step: Record<string, unknown>): string | null {
  if (typeof step['step_index'] === 'number') return `step-${step['step_index']}`;
  if (typeof step['conversation_id'] === 'string' && step['conversation_id']) {
    return step['conversation_id'];
  }
  return null;
}

function toolStepName(step: Record<string, unknown>): string {
  if (typeof step['tool_name'] === 'string' && step['tool_name'].trim()) {
    return step['tool_name'];
  }
  const info = step['tool_info'];
  if (isRecord(info) && typeof info['name'] === 'string' && info['name'].trim()) {
    return info['name'];
  }
  return 'tool';
}

function agyToolEvents(step: Record<string, unknown>): readonly HeadlessOutputEvent[] {
  const id = toolStepId(step);
  if (!id) return [];
  const name = toolStepName(step);
  const info = isRecord(step['tool_info']) ? step['tool_info'] : null;
  const error = info && isRecord(info['error']) ? info['error'] : null;
  if (step['state'] === 'ACTIVE') {
    return [{
      type: 'tool-start',
      id,
      name,
      ...(info && info['parameters'] !== undefined ? { input: info['parameters'] } : {}),
    }];
  }
  if (step['state'] !== 'DONE') return [];
  if (error) {
    return [{
      type: 'tool-finish',
      id,
      name,
      isError: true,
      output: typeof error['message'] === 'string' ? error['message'] : error,
    }];
  }
  return [{
    type: 'tool-finish',
    id,
    name,
    ...(info && info['output'] !== undefined ? { output: info['output'] } : {}),
  }];
}

/**
 * Antigravity is Google's coding-agent CLI (successor to Gemini CLI). Launch
 * stays on the existing CliAdapter contract: PATH `agy` only, argv flags, and
 * env projection. Never spawn `antigravity` or `gemini` — those names are not
 * the installed binary. Do not pass `--agent` (Antigravity custom agents, not
 * Alice AgentId), `--add-dir` / `--new-project` / `--project` (spawn cwd is
 * enough), `--sandbox`, `--json-schema`, `--resume` (unknown; resume is
 * `--conversation` / `--continue`), or `--trust` / `--force`. Headless uses
 * `--output-format stream-json --dangerously-skip-permissions -p <prompt>`.
 * Do not put the prompt after `--`: live 1.1.13 on the Gemini key path
 * exits immediately with "Agent execution terminated due to error." There
 * is no Alice-owned Antigravity project file, so this adapter has no
 * deprecated `writeAiConfig` export: managed Sessions use `sessionRuntime`
 * env only. `GEMINI_API_KEY` alone has no effect unless the user already
 * set `modelProvider: "gemini"` in settings.json — Alice does not write
 * that file. First-party `--model` suggestions live in `./agy-models.ts`;
 * this adapter does not validate the id.
 */
export const agyAdapter: CliAdapter = {
  id: 'agy',
  displayName: 'Antigravity',
  binary: 'agy',
  namePrefix: 'agy',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'subprocess',
    headless: true,
    aiProvider: {
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['google-generative-ai'],
      defaultWire: 'google-generative-ai',
    },
  },

  sessionRuntime: {
    project(_ctx, runtime: ResolvedSessionRuntimeBinding) {
      const args = agyRuntimeArgs(runtime);
      const env = runtime.ai ? agyCredentialEnv(runtime.ai) : {};
      return { env, interactiveArgs: args, headlessArgs: args, webArgs: args };
    },
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Ignore the workspace default command (usually `claude`).
    const cmd = [
      'agy',
      ...(ctx.sessionRuntime?.interactiveArgs ?? []),
    ];
    if (ctx.resume === undefined) {
      if (ctx.initialPrompt) return [...cmd, '--prompt-interactive', ctx.initialPrompt];
      return cmd;
    }
    return [...cmd, ...agyResumeArgs(ctx.resume)];
  },

  composeHeadlessCommand(
    _base: readonly string[],
    ctx: SpawnContext,
    prompt: string,
  ): readonly string[] {
    return [
      'agy',
      '--output-format',
      'stream-json',
      '--dangerously-skip-permissions',
      ...(ctx.sessionRuntime?.headlessArgs ?? []),
      ...agyResumeArgs(ctx.resume),
      '-p',
      prompt,
    ];
  },

  extractHeadlessSessionId(line: string): string | null {
    const evt = parseJsonRecord(line);
    return evt ? conversationIdFrom(evt) : null;
  },

  extractHeadlessAssistantText(line: string): string | null {
    const evt = parseJsonRecord(line);
    if (!evt) return null;
    if (evt['event'] === 'result' && isRecord(evt['result'])) {
      return typeof evt['result']['response'] === 'string' ? evt['result']['response'] : null;
    }
    if (evt['event'] === undefined && typeof evt['response'] === 'string' && evt['status'] === 'SUCCESS') {
      return evt['response'];
    }
    return null;
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    const evt = parseJsonRecord(line);
    if (!evt) return [];
    if (evt['event'] === 'step_update' && isRecord(evt['step_update'])) {
      const step = evt['step_update'];
      if (step['step_type'] === 'agent_response' && typeof step['text_delta'] === 'string' && step['text_delta']) {
        return [{ type: 'text', text: step['text_delta'], delta: true }];
      }
      if (step['step_type'] === 'tool') return agyToolEvents(step);
      return [];
    }
    if (evt['event'] === 'result' && isRecord(evt['result'])) {
      const status = evt['result']['status'];
      if (status === 'ERROR' || status === 'INVALID') {
        return [{
          type: 'error',
          message: typeof evt['result']['error'] === 'string'
            ? evt['result']['error']
            : 'Antigravity run failed',
        }];
      }
    }
    return [];
  },

  keepHeadlessDiagnosticLine(line: string): boolean {
    const evt = parseJsonRecord(line);
    if (!evt) return false;
    if (evt['event'] === 'init' || evt['event'] === 'result') return true;
    if (evt['event'] === 'step_update' && isRecord(evt['step_update'])) {
      const type = evt['step_update']['step_type'];
      return type === 'agent_response' || type === 'tool';
    }
    return false;
  },

  async listOnDisk(cwd: string): Promise<readonly OnDiskSession[]> {
    return listAgyOnDisk(cwd);
  },

  async readSessionTitle(_cwd: string, _sessionId: string): Promise<string | null> {
    return null;
  },
};

export async function listAgyOnDisk(
  cwd: string,
  home = agyHomeDir(),
): Promise<readonly OnDiskSession[]> {
  const cache = join(home, 'cache', 'last_conversations.json');
  let raw: string;
  try {
    raw = await readFile(cache, 'utf8');
  } catch {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecord(parsed)) return [];

  let cacheStat: Awaited<ReturnType<typeof stat>>;
  try {
    cacheStat = await stat(cache);
  } catch {
    return [];
  }

  const keys = new Set(agyCwdKeys(cwd));
  const seen = new Set<string>();
  const out: OnDiskSession[] = [];
  for (const [pathKey, value] of Object.entries(parsed)) {
    if (!keys.has(pathKey) || typeof value !== 'string' || !SESSION_ID_RE.test(value) || seen.has(value)) {
      continue;
    }
    seen.add(value);
    const convDir = join(home, 'conversations', value);
    try {
      const convStat = await stat(convDir);
      out.push({
        sessionId: value,
        file: convDir,
        mtime: convStat.mtime.toISOString(),
        sizeBytes: convStat.size,
      });
    } catch {
      out.push({
        sessionId: value,
        file: cache,
        mtime: cacheStat.mtime.toISOString(),
        sizeBytes: cacheStat.size,
      });
    }
  }
  return out;
}
