import { createHash } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  CliAdapter,
  OnDiskSession,
  ResolvedSessionRuntimeBinding,
  SpawnContext,
} from '../cli-adapter.js';
import type { HeadlessOutputEvent } from '../headless-output.js';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandHome(path: string, home: string): string {
  return resolve(path.replace(/^~(?=$|[/\\])/, home));
}

export function cursorDataDir(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env['CURSOR_DATA_DIR']?.trim();
  const home = env['HOME']?.trim() || homedir();
  if (configured) return expandHome(configured, home);
  // `HOME` can come from an isolated Unix-shaped test/runtime environment on
  // Windows. `resolve` makes that path absolute for the current platform;
  // `join` would leave it drive-relative (`\tmp\...`) and make Cursor session
  // discovery depend on the process's current drive.
  return resolve(home, '.cursor');
}

/**
 * Cursor 2026.08.11-e8db854 hashes `path.resolve(cwd)`. On macOS `/tmp/foo`
 * and `/private/tmp/foo` are the same directory; listing must try both.
 */
export function cursorChatCwdKeys(cwd: string): readonly string[] {
  const resolved = resolve(cwd);
  const keys = new Set<string>([resolved]);
  try {
    keys.add(realpathSync(resolved));
  } catch {
    // cwd may not exist yet (tests, first launch)
  }
  return [...keys];
}

export function cursorChatBucket(cwd: string): string {
  return createHash('md5').update(resolve(cwd)).digest('hex');
}

/** Cursor stores CLI chats under `<dataDir>/chats/<md5(resolve(cwd))>/<uuid>/`. */
export function cursorChatsDir(cwd: string, dataDir = cursorDataDir()): string {
  return join(dataDir, 'chats', cursorChatBucket(cwd));
}

/**
 * Live `2026.08.11-e8db854` treats `id[effort=…]` as an unknown model name
 * (help still documents brackets). Effort is already encoded as catalog
 * suffixes (`gpt-5.2-low`, `composer-2.5-fast`). Do not invent `--effort`
 * or rewrite ids.
 */
export function cursorModelArg(model: string | undefined): string | undefined {
  const trimmed = model?.trim();
  return trimmed || undefined;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function cursorResumeArgs(resume: SpawnContext['resume']): readonly string[] {
  if (resume === undefined) return [];
  if (resume === 'last') return ['--continue'];
  return ['--resume', resume.sessionId];
}

function assistantTextFromMessage(message: unknown): string | null {
  if (!isRecord(message) || !Array.isArray(message['content'])) return null;
  const text = message['content']
    .flatMap((part) => {
      if (!isRecord(part)) return [];
      return part['type'] === 'text' && typeof part['text'] === 'string' ? [part['text']] : [];
    })
    .join('\n');
  return text || null;
}

function cursorToolName(toolCall: Record<string, unknown>): string {
  const fn = toolCall['function'];
  if (isRecord(fn) && typeof fn['name'] === 'string' && fn['name'].trim()) {
    return fn['name'];
  }
  for (const key of Object.keys(toolCall)) {
    if (key.endsWith('ToolCall')) {
      const name = key.slice(0, -'ToolCall'.length);
      return name || key;
    }
  }
  return 'tool';
}

function cursorToolEntry(toolCall: Record<string, unknown>): Record<string, unknown> | null {
  const fn = toolCall['function'];
  if (isRecord(fn)) return fn;
  for (const [key, value] of Object.entries(toolCall)) {
    if (key.endsWith('ToolCall') && isRecord(value)) return value;
  }
  for (const value of Object.values(toolCall)) {
    if (
      isRecord(value)
      && (value['args'] !== undefined
        || value['arguments'] !== undefined
        || value['result'] !== undefined)
    ) {
      return value;
    }
  }
  return null;
}

function cursorToolEvents(record: Record<string, unknown>): readonly HeadlessOutputEvent[] {
  const id = record['call_id'];
  if (typeof id !== 'string') return [];
  const toolCall = record['tool_call'];
  const entry = isRecord(toolCall) ? cursorToolEntry(toolCall) : null;
  const name = isRecord(toolCall) ? cursorToolName(toolCall) : 'tool';
  const subtype = record['subtype'];
  if (subtype === 'started') {
    return [{
      type: 'tool-start',
      id,
      name,
      ...(entry && entry['args'] !== undefined ? { input: entry['args'] } : {}),
      ...(entry && entry['arguments'] !== undefined ? { input: entry['arguments'] } : {}),
    }];
  }
  if (subtype !== 'completed') return [];
  const result = entry?.['result'];
  let output: unknown;
  let isError = false;
  if (isRecord(result)) {
    if (result['success'] !== undefined) output = result['success'];
    else if (result['error'] !== undefined) {
      output = result['error'];
      isError = true;
    } else {
      output = result;
    }
  } else if (result !== undefined) {
    output = result;
  }
  return [{
    type: 'tool-finish',
    id,
    name,
    ...(output !== undefined ? { output } : {}),
    ...(isError ? { isError: true } : {}),
  }];
}

/**
 * Cursor Agent is Cursor's coding-agent CLI. Launch stays on the existing
 * CliAdapter contract: PATH `cursor-agent` only and argv flags. Authentication
 * may remain owned by Cursor (`cursor-agent login` or Cursor's own environment),
 * or OpenAlice may project a normal `vendor: cursor` provider credential into
 * `CURSOR_API_KEY`. That provider is consumed directly by this adapter rather
 * than pretending it exposes an OpenAI-compatible wire. Never spawn `agent` —
 * Grok Build's installer occupies that
 * name on purpose (`~/.grok/bin/agent`). Do not pass `--worktree` /
 * `--workspace` (they leave the managed Workspace), `--api-key` (secrets
 * stay in env), `--plugin-dir` (Cursor plugins, not Alice skills),
 * `--stream-partial-output` (duplicate assistant flushes), or `create-chat`
 * (prints a UUID then hangs; empty stores are deleted on dispose).
 * `--session-id` is unknown; `--new-session-id` is create-only and is not
 * a resume flag. Headless uses `-p --output-format stream-json --force
 * --trust` plus `-- <prompt>`. There is no workspace-local Cursor project
 * file, so this adapter has no deprecated `writeAiConfig` export: managed
 * Sessions use `sessionRuntime` env only. First-party `--model` suggestions
 * (Cursor Models pool + `auto`) live in `./cursor-models.ts`; this adapter
 * does not validate the id.
 */
export const cursorAdapter: CliAdapter = {
  id: 'cursor',
  displayName: 'Cursor Agent',
  binary: 'cursor-agent',
  namePrefix: 'ca',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'subprocess',
    headless: true,
    aiProvider: {
      credentialSource: 'runtime-or-workspace',
      // Cursor Dashboard credentials stay in the shared provider vault, but
      // Cursor consumes them directly rather than through a model API wire.
      wirePreference: [],
      directVendors: ['cursor'],
    },
  },

  sessionRuntime: {
    project(_ctx, runtime: ResolvedSessionRuntimeBinding) {
      const model = cursorModelArg(runtime.binding.model);
      const args = model ? ['--model', model] : [];
      const env: Record<string, string> = {};
      if (runtime.ai?.apiKey) env['CURSOR_API_KEY'] = runtime.ai.apiKey;
      if (runtime.ai?.baseUrl) env['CURSOR_API_ENDPOINT'] = runtime.ai.baseUrl;
      return { env, interactiveArgs: args, headlessArgs: args, webArgs: args };
    },
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Ignore the workspace default command (usually `claude`). Spreading
    // `base` here would launch `claude` or the colliding `agent` name.
    const cmd = [
      'cursor-agent',
      ...(ctx.sessionRuntime?.interactiveArgs ?? []),
      ...(ctx.approveProject ? ['--trust'] : []),
    ];
    if (ctx.resume === undefined) {
      if (ctx.initialPrompt) return [...cmd, '--', ctx.initialPrompt];
      return cmd;
    }
    return [...cmd, ...cursorResumeArgs(ctx.resume)];
  },

  composeHeadlessCommand(
    _base: readonly string[],
    ctx: SpawnContext,
    prompt: string,
  ): readonly string[] {
    return [
      'cursor-agent',
      '-p',
      '--output-format',
      'stream-json',
      '--force',
      '--trust',
      ...(ctx.sessionRuntime?.headlessArgs ?? []),
      ...cursorResumeArgs(ctx.resume),
      '--',
      prompt,
    ];
  },

  extractHeadlessSessionId(line: string): string | null {
    const evt = parseJsonRecord(line);
    return evt && typeof evt['session_id'] === 'string' ? evt['session_id'] : null;
  },

  extractHeadlessAssistantText(line: string): string | null {
    const evt = parseJsonRecord(line);
    if (!evt || evt['type'] !== 'result') return null;
    return typeof evt['result'] === 'string' ? evt['result'] : null;
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    const evt = parseJsonRecord(line);
    if (!evt) return [];
    if (evt['type'] === 'assistant') {
      const text = assistantTextFromMessage(evt['message']);
      return text ? [{ type: 'text', text }] : [];
    }
    if (evt['type'] === 'tool_call') return cursorToolEvents(evt);
    if (evt['type'] === 'result' && evt['is_error'] === true) {
      return [{
        type: 'error',
        message: typeof evt['result'] === 'string' ? evt['result'] : 'Cursor Agent run failed',
      }];
    }
    return [];
  },

  keepHeadlessDiagnosticLine(line: string): boolean {
    const evt = parseJsonRecord(line);
    if (!evt) return false;
    if (evt['type'] === 'result' || evt['type'] === 'assistant') return true;
    if (evt['type'] === 'tool_call') {
      return evt['subtype'] === 'started' || evt['subtype'] === 'completed';
    }
    return false;
  },

  async listOnDisk(cwd: string): Promise<readonly OnDiskSession[]> {
    return listCursorOnDisk(cwd);
  },

  async readSessionTitle(_cwd: string, _sessionId: string): Promise<string | null> {
    return null;
  },
};

export async function listCursorOnDisk(
  cwd: string,
  dataDir = cursorDataDir(),
): Promise<readonly OnDiskSession[]> {
  const seen = new Set<string>();
  const out: OnDiskSession[] = [];
  for (const key of cursorChatCwdKeys(cwd)) {
    const dir = join(dataDir, 'chats', cursorChatBucket(key));
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      if (!SESSION_ID_RE.test(name) || seen.has(name)) continue;
      const store = join(dir, name, 'store.db');
      try {
        const st = await stat(store);
        if (!st.isFile()) continue;
        seen.add(name);
        out.push({
          sessionId: name,
          file: store,
          mtime: st.mtime.toISOString(),
          sizeBytes: st.size,
        });
      } catch {
        // skip dirs that never grew a store (empty create-chat is deleted)
      }
    }
  }
  return out;
}
