import { existsSync, realpathSync } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { ModelReasoningEffort } from '../../ai-providers/model-semantics.js';
import type {
  AgentInteractiveSetupStatus,
  CliAdapter,
  OnDiskSession,
  ResolvedSessionRuntimeBinding,
  SpawnContext,
} from '../cli-adapter.js';
import type { HeadlessOutputEvent } from '../headless-output.js';

const GROK_RUN_EFFORTS = new Set<ModelReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const XAI_OFFICIAL_BASE = 'https://api.x.ai/v1';
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function grokHomeDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['GROK_HOME']?.trim();
  if (configured) {
    return resolve(configured.replace(/^~(?=$|[/\\])/, env['HOME']?.trim() || homedir()));
  }
  return join(homedir(), '.grok');
}

/**
 * Grok 1.0.4 encodes the physical cwd. On macOS `/tmp/foo` and
 * `/private/tmp/foo` are the same directory; listing must try both.
 */
export function grokSessionKeys(cwd: string): readonly string[] {
  const resolved = resolve(cwd);
  const keys = new Set<string>([resolved]);
  try {
    keys.add(realpathSync(resolved));
  } catch {
    // cwd may not exist yet (tests, first launch)
  }
  return [...keys];
}

/** Grok stores sessions under `~/.grok/sessions/<encodeURIComponent(cwd)>/<id>/`. */
export function grokSessionDir(cwd: string, home = grokHomeDir()): string {
  const keys = grokSessionKeys(cwd);
  return join(home, 'sessions', encodeURIComponent(keys[keys.length - 1] ?? resolve(cwd)));
}

export function isOfficialXaiBase(url: string | null | undefined): boolean {
  if (!url) return true;
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed === '' || trimmed === XAI_OFFICIAL_BASE;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function sessionIdFromRecord(record: Record<string, unknown>): string | null {
  if (typeof record['sessionId'] === 'string') return record['sessionId'];
  if (typeof record['session_id'] === 'string') return record['session_id'];
  const params = record['params'];
  if (isRecord(params) && typeof params['sessionId'] === 'string') return params['sessionId'];
  return null;
}

function acpUpdate(record: Record<string, unknown>): Record<string, unknown> | null {
  const params = record['params'];
  if (!isRecord(params)) return null;
  const update = params['update'];
  return isRecord(update) ? update : null;
}

function toolName(update: Record<string, unknown>): string {
  const meta = update['_meta'];
  if (isRecord(meta)) {
    const tool = meta['x.ai/tool'];
    if (isRecord(tool) && typeof tool['name'] === 'string' && tool['name'].trim()) {
      return tool['name'];
    }
  }
  if (typeof update['title'] === 'string' && update['title'].trim()) return update['title'];
  if (typeof update['kind'] === 'string' && update['kind'].trim()) return update['kind'];
  return 'tool';
}

function textFromContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim()) return value;
  if (!isRecord(value)) return null;
  if (typeof value['text'] === 'string' && value['text'].trim()) return value['text'];
  if (typeof value['data'] === 'string' && value['data'].trim()) return value['data'];
  return null;
}

export function readGrokSessionTitleFromSummary(parsed: unknown): string | null {
  if (!isRecord(parsed)) return null;
  const generated = typeof parsed['generated_title'] === 'string' ? parsed['generated_title'].trim() : '';
  const summary = typeof parsed['session_summary'] === 'string' ? parsed['session_summary'].trim() : '';
  return generated || summary || null;
}

/**
 * Best-effort read of Grok's `trusted_folders.toml`. The file is runtime-owned;
 * an unfamiliar shape returns `unknown` rather than guessing.
 */
export function grokTrustDecision(
  raw: string,
  candidates: readonly string[],
): boolean | 'unknown' | null {
  const wanted = new Set(candidates);
  let current: string | null = null;
  let sawSection = false;
  for (const line of raw.split(/\r?\n/)) {
    const section = /^\s*\[folders\.(?:"((?:\\.|[^"])*)"|'((?:\\.|[^'])*)')\]\s*$/.exec(line);
    if (section) {
      sawSection = true;
      current = (section[1] ?? section[2] ?? '').replaceAll('\\"', '"').replaceAll("\\'", "'");
      continue;
    }
    const trusted = /^\s*trusted\s*=\s*(true|false)\s*$/.exec(line);
    if (trusted && current && wanted.has(current)) {
      return trusted[1] === 'true';
    }
  }
  if (raw.trim() !== '' && !sawSection) return 'unknown';
  return null;
}

export async function readGrokInteractiveSetupStatus(
  cwd: string,
  homeDir = grokHomeDir(),
): Promise<AgentInteractiveSetupStatus> {
  if (!existsSync(join(homeDir, 'auth.json'))) return 'runtime-onboarding-required';

  let raw: string;
  try {
    raw = await readFile(join(homeDir, 'trusted_folders.toml'), 'utf8');
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return 'workspace-trust-required';
    }
    return 'unknown';
  }

  const resolved = resolve(cwd);
  const physical = await realpath(resolved).catch(() => resolved);
  const decision = grokTrustDecision(raw, [resolved, physical]);
  if (decision === 'unknown') return 'unknown';
  return decision === true ? 'ready' : 'workspace-trust-required';
}

async function readSummary(path: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, 'utf8'));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Grok Build is an xAI-native coding-agent CLI. Launch stays on the existing
 * CliAdapter contract: PATH `grok`, argv flags, and env projection. Do not
 * pass `--worktree` (it leaves the managed Workspace) or `-s/--session-id`
 * (1.0.4 creates a new UUID only; it does not resume). Headless `-p/--single`
 * takes the prompt as its value — `-p --output-format` fails — and
 * `--output-format json` pretty-prints a multi-line object the line scanner
 * cannot parse. Use `streaming-json` plus `--single=<prompt>`.
 */
export const grokAdapter: CliAdapter = {
  id: 'grok',
  displayName: 'Grok Build',
  binary: 'grok',
  namePrefix: 'g',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'subprocess',
    headless: true,
    aiProvider: {
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['openai-chat', 'openai-responses'],
      defaultWire: 'openai-chat',
    },
  },

  sessionRuntime: {
    project(_ctx, runtime: ResolvedSessionRuntimeBinding) {
      const effort = runtime.binding.reasoningEffort;
      if (effort && !GROK_RUN_EFFORTS.has(effort)) {
        throw new Error(`Grok Build cannot use Session effort ${effort}`);
      }
      const args = [
        ...(runtime.binding.model ? ['--model', runtime.binding.model] : []),
        ...(effort ? ['--effort', effort] : []),
      ];
      const env: Record<string, string> = {};
      const ai = runtime.ai;
      if (ai?.apiKey) env['XAI_API_KEY'] = ai.apiKey;
      if (ai?.baseUrl && !isOfficialXaiBase(ai.baseUrl)) {
        env['GROK_MODELS_BASE_URL'] = ai.baseUrl;
      }
      return { env, interactiveArgs: args, headlessArgs: args, webArgs: args };
    },
  },

  readInteractiveSetupStatus: readGrokInteractiveSetupStatus,

  composeCommand(base: readonly string[], ctx: SpawnContext): readonly string[] {
    const cmd = [...base, '--no-leader', ...(ctx.sessionRuntime?.interactiveArgs ?? [])];
    if (ctx.resume === undefined) {
      if (ctx.initialPrompt) return [...cmd, '--', ctx.initialPrompt];
      return cmd;
    }
    if (ctx.resume === 'last') return [...cmd, '--continue'];
    return [...cmd, '--resume', ctx.resume.sessionId];
  },

  composeHeadlessCommand(
    base: readonly string[],
    ctx: SpawnContext,
    prompt: string,
  ): readonly string[] {
    return [
      ...base,
      '--no-leader',
      '--always-approve',
      ...(ctx.sessionRuntime?.headlessArgs ?? []),
      ...(ctx.resume === 'last'
        ? ['--continue']
        : ctx.resume
          ? ['--resume', ctx.resume.sessionId]
          : []),
      '--output-format',
      'streaming-json',
      `--single=${prompt}`,
    ];
  },

  extractHeadlessSessionId(line: string): string | null {
    const evt = parseJsonRecord(line);
    return evt ? sessionIdFromRecord(evt) : null;
  },

  extractHeadlessAssistantText(line: string): string | null {
    const evt = parseJsonRecord(line);
    if (!evt) return null;
    const update = acpUpdate(evt);
    if (update?.['sessionUpdate'] === 'agent_message_chunk') {
      return textFromContent(update['content']);
    }
    if (evt['type'] === 'text') return textFromContent(evt['data'] ?? evt);
    if (typeof evt['text'] === 'string' && evt['text'].trim()) return evt['text'];
    return null;
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    const evt = parseJsonRecord(line);
    if (!evt) return [];

    const update = acpUpdate(evt);
    if (update) {
      const kind = update['sessionUpdate'];
      if (kind === 'agent_message_chunk') {
        const text = textFromContent(update['content']);
        return text ? [{ type: 'text', text }] : [];
      }
      if (kind === 'tool_call' && typeof update['toolCallId'] === 'string') {
        return [{
          type: 'tool-start',
          id: update['toolCallId'],
          name: toolName(update),
          ...(update['rawInput'] !== undefined ? { input: update['rawInput'] } : {}),
        }];
      }
      if (kind === 'tool_call_update' && typeof update['toolCallId'] === 'string') {
        const status = update['status'];
        const failed = status === 'failed' || status === 'error';
        return [{
          type: 'tool-finish',
          id: update['toolCallId'],
          name: toolName(update),
          ...(update['content'] !== undefined ? { output: update['content'] } : {}),
          ...(failed ? { isError: true } : {}),
        }];
      }
      return [];
    }

    if (evt['type'] === 'text') {
      const text = textFromContent(evt['data'] ?? evt);
      return text ? [{ type: 'text', text }] : [];
    }
    if (typeof evt['text'] === 'string' && evt['text'].trim()) {
      return [{ type: 'text', text: evt['text'] }];
    }
    if (evt['type'] === 'error' || evt['is_error'] === true) {
      const message = typeof evt['message'] === 'string'
        ? evt['message']
        : typeof evt['error'] === 'string'
          ? evt['error']
          : 'Grok run failed';
      return [{ type: 'error', message }];
    }
    return [];
  },

  async listOnDisk(cwd: string): Promise<readonly OnDiskSession[]> {
    return listGrokOnDisk(cwd);
  },

  async readSessionTitle(cwd: string, sessionId: string): Promise<string | null> {
    for (const key of grokSessionKeys(cwd)) {
      const title = readGrokSessionTitleFromSummary(
        await readSummary(join(grokHomeDir(), 'sessions', encodeURIComponent(key), sessionId, 'summary.json')),
      );
      if (title) return title;
    }
    return null;
  },
};

export async function listGrokOnDisk(
  cwd: string,
  home = grokHomeDir(),
): Promise<readonly OnDiskSession[]> {
  const seen = new Set<string>();
  const out: OnDiskSession[] = [];
  for (const key of grokSessionKeys(cwd)) {
    const dir = join(home, 'sessions', encodeURIComponent(key));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SESSION_ID_RE.test(name) || seen.has(name)) continue;
      const sessionDir = join(dir, name);
      const summaryPath = join(sessionDir, 'summary.json');
      try {
        const file = existsSync(summaryPath) ? summaryPath : sessionDir;
        const st = await stat(file);
        seen.add(name);
        out.push({
          sessionId: name,
          file,
          mtime: st.mtime.toISOString(),
          sizeBytes: st.size,
        });
      } catch {
        // skip unreadable session dirs
      }
    }
  }
  return out;
}
