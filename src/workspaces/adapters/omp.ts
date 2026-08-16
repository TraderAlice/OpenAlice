import { realpathSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { ModelReasoningEffort } from '../../ai-providers/model-semantics.js';
import type {
  CliAdapter,
  OnDiskSession,
  ResolvedSessionRuntimeBinding,
  SpawnContext,
} from '../cli-adapter.js';
import type { HeadlessOutputEvent } from '../headless-output.js';

const OMP_RUN_EFFORTS = new Set<ModelReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
]);

const SESSION_FILE_RE =
  /^(.+)_([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function expandHome(path: string, home: string): string {
  return resolve(path.replace(/^~(?=$|[/\\])/, home));
}

function tryRealpath(path: string): string | null {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

function encodeRelativeSessionDirName(prefix: string, rel: string): string {
  const encoded = rel.replace(/[/\\:]/g, '-');
  if (!encoded) return prefix;
  return prefix.endsWith('-') ? `${prefix}${encoded}` : `${prefix}-${encoded}`;
}

export function encodeOmpAbsoluteSessionDirName(cwd: string): string {
  return `--${resolve(cwd).replace(/^[/\\]/, '').replace(/[/\\:]/g, '-')}--`;
}

/**
 * Oh My Pi 17.3.4 `session-paths.ts` bucket name. Callers must pass already
 * canonicalized cwd/home/tmp roots when they want symlink aliases to share a
 * bucket (`/tmp` vs `/private/tmp` on macOS).
 */
export function encodeOmpSessionDirName(
  cwd: string,
  home: string,
  tempRoot: string,
): string {
  const resolvedCwd = resolve(cwd);
  const homeRelative = relative(resolve(home), resolvedCwd);
  if (homeRelative === '' || (!homeRelative.startsWith('..') && !isAbsolute(homeRelative))) {
    return encodeRelativeSessionDirName('-', homeRelative);
  }
  const tempRelative = relative(resolve(tempRoot), resolvedCwd);
  if (tempRelative === '' || (!tempRelative.startsWith('..') && !isAbsolute(tempRelative))) {
    return encodeRelativeSessionDirName('-tmp', tempRelative);
  }
  return encodeOmpAbsoluteSessionDirName(resolvedCwd);
}

export function ompAgentDir(env: NodeJS.ProcessEnv = process.env): string {
  const home = env['HOME']?.trim() || homedir();
  const profile = env['OMP_PROFILE']?.trim() || env['PI_PROFILE']?.trim();
  const configDir = env['PI_CONFIG_DIR']?.trim() || '.omp';
  const coding = env['PI_CODING_AGENT_DIR']?.trim();
  if (coding && !profile) return expandHome(coding, home);
  const root = join(expandHome(home, home), configDir);
  return profile ? join(root, 'profiles', profile, 'agent') : join(root, 'agent');
}

export function ompSessionsRoot(env: NodeJS.ProcessEnv = process.env): string {
  return join(ompAgentDir(env), 'sessions');
}

/** Candidate bucket names for one cwd, including symlink aliases and the legacy abs spelling. */
export function ompSessionBucketNames(
  cwd: string,
  home = homedir(),
  tempRoot = tmpdir(),
): readonly string[] {
  const names = new Set<string>();
  const cwdForms = [resolve(cwd), tryRealpath(cwd)].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const homeForms = [resolve(home), tryRealpath(home)].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  const tempForms = [resolve(tempRoot), tryRealpath(tempRoot)].filter(
    (value): value is string => typeof value === 'string' && value.length > 0,
  );
  for (const form of cwdForms) {
    names.add(encodeOmpAbsoluteSessionDirName(form));
    for (const homeForm of homeForms) {
      for (const tempForm of tempForms) {
        names.add(encodeOmpSessionDirName(form, homeForm, tempForm));
      }
    }
  }
  return [...names];
}

export function ompThinkingArg(effort: ModelReasoningEffort): string {
  if (!OMP_RUN_EFFORTS.has(effort)) {
    throw new Error(`Oh My Pi cannot use Session effort ${effort}`);
  }
  return effort === 'none' ? 'off' : effort;
}

function ompResumeArgs(resume: SpawnContext['resume']): readonly string[] {
  if (resume === undefined) return [];
  if (resume === 'last') return ['--continue'];
  return ['--resume', resume.sessionId];
}

function ompPromptArgs(prompt: string | undefined): readonly string[] {
  return prompt ? ['--', prompt] : [];
}

function ompRoleArgs(ctx: SpawnContext): readonly string[] {
  return ctx.appendSystemPrompt ? ['--append-system-prompt', ctx.appendSystemPrompt] : [];
}

function ompCredentialEnv(ai: NonNullable<ResolvedSessionRuntimeBinding['ai']>): Record<string, string> {
  const env: Record<string, string> = {};
  const key = ai.apiKey?.trim();
  const base = ai.baseUrl?.trim();
  if (ai.wireShape === 'anthropic') {
    if (key) env['ANTHROPIC_API_KEY'] = key;
    if (base) env['ANTHROPIC_BASE_URL'] = base;
    return env;
  }
  if (ai.wireShape === 'google-generative-ai') {
    if (key) env['GEMINI_API_KEY'] = key;
    return env;
  }
  if (key) env['OPENAI_API_KEY'] = key;
  if (base) env['OPENAI_BASE_URL'] = base;
  return env;
}

function parseJsonRecord(line: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(line);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function assistantTextFromMessage(message: unknown): string | null {
  if (!isRecord(message) || message['role'] !== 'assistant' || !Array.isArray(message['content'])) {
    return null;
  }
  const text = message['content']
    .flatMap((part) => {
      if (!isRecord(part)) return [];
      return part['type'] === 'text' && typeof part['text'] === 'string' ? [part['text']] : [];
    })
    .join('\n');
  return text || null;
}

export function readOmpSessionTitleFromJsonl(raw: string): string | null {
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const entry = parseJsonRecord(trimmed);
    if (!entry) continue;
    if (entry['type'] === 'title' && typeof entry['title'] === 'string' && entry['title'].trim()) {
      return entry['title'].trim();
    }
    if (entry['type'] === 'session' && typeof entry['title'] === 'string' && entry['title'].trim()) {
      return entry['title'].trim();
    }
  }
  return null;
}

function sessionIdFromFilename(name: string): string | null {
  const match = SESSION_FILE_RE.exec(name);
  return match?.[2] ?? null;
}

/**
 * Oh My Pi (`omp`, can1357/oh-my-pi) is a Pi fork. Launch stays on the existing
 * CliAdapter contract: PATH `omp`, argv flags, and env projection. Do not pass
 * `--session-id` (17.3.4 rejects it; `--session` is an alias of `--resume` and
 * opens a TUI picker when bare). Do not pass `--skill` (that flag is a glob
 * filter, not Pi's path injector). Do not isolate `~/.omp` — `PI_CODING_AGENT_DIR`
 * still writes `~/.omp/run/daemons`. Headless is `-p --mode json`; print JSON
 * line 1 is the session header, then AgentSessionEvent frames. Interactive
 * identity is the same JSONL `listOnDisk` already reads: omp mints its own
 * snowflake id and writes `~/.omp/agent/sessions/<cwd-bucket>/<ts>_<id>.jsonl`
 * after the first persist (lazy until assistant output). There is no
 * create-or-reopen `--session-id` (`unknown flag`; `--session` aliases
 * `--resume` and only opens an existing file). `transcriptDiscovery` is
 * `subprocess` so the watcher polls for a **new** id, same as Codex / Grok /
 * opencode. Empty TUI turns that never persist still fall back to `--continue`.
 * `--` is a real POSIX terminator (Pi rejects it). There is no workspace-local
 * omp project file, so this adapter has no deprecated `writeAiConfig` export.
 */
export const ompAdapter: CliAdapter = {
  id: 'omp',
  displayName: 'Oh My Pi',
  binary: 'omp',
  namePrefix: 'om',
  capabilities: {
    parallelPerCwd: true,
    resumeLast: true,
    resumeById: true,
    transcriptDiscovery: 'subprocess',
    headless: true,
    aiProvider: {
      credentialSource: 'runtime-or-workspace',
      wirePreference: ['google-generative-ai', 'openai-chat', 'anthropic', 'openai-responses'],
      defaultWire: 'openai-chat',
      vendorPolicies: {
        minimax: {
          wirePreference: ['anthropic'],
          legacyRequestedWireFallbacks: { 'openai-chat': 'anthropic' },
        },
      },
      modelRegistration: {
        contextWindow: true,
        reasoning: true,
      },
    },
  },

  sessionRuntime: {
    project(_ctx, runtime: ResolvedSessionRuntimeBinding) {
      const effort = runtime.binding.reasoningEffort;
      if (effort && !OMP_RUN_EFFORTS.has(effort)) {
        throw new Error(`Oh My Pi cannot use Session effort ${effort}`);
      }
      const args = [
        ...(runtime.binding.model ? ['--model', runtime.binding.model] : []),
        ...(effort ? ['--thinking', ompThinkingArg(effort)] : []),
      ];
      const env = runtime.ai ? ompCredentialEnv(runtime.ai) : {};
      return { env, interactiveArgs: args, headlessArgs: args, webArgs: args };
    },
  },

  composeCommand(_base: readonly string[], ctx: SpawnContext): readonly string[] {
    const cmd = [
      'omp',
      ...(ctx.sessionRuntime?.interactiveArgs ?? []),
      ...ompRoleArgs(ctx),
    ];
    if (ctx.resume === undefined) {
      return [...cmd, ...ompPromptArgs(ctx.initialPrompt)];
    }
    return [...cmd, ...ompResumeArgs(ctx.resume)];
  },

  composeHeadlessCommand(
    _base: readonly string[],
    ctx: SpawnContext,
    prompt: string,
  ): readonly string[] {
    return [
      'omp',
      ...(ctx.sessionRuntime?.headlessArgs ?? []),
      ...ompRoleArgs(ctx),
      '-p',
      '--mode',
      'json',
      '--auto-approve',
      ...ompResumeArgs(ctx.resume),
      '--',
      prompt,
    ];
  },

  extractHeadlessSessionId(line: string): string | null {
    const evt = parseJsonRecord(line);
    if (!evt || evt['type'] !== 'session') return null;
    return typeof evt['id'] === 'string' ? evt['id'] : null;
  },

  extractHeadlessAssistantText(line: string): string | null {
    if (!line.startsWith('{"type":"message_end"')) return null;
    const evt = parseJsonRecord(line);
    if (!evt || evt['type'] !== 'message_end') return null;
    return assistantTextFromMessage(evt['message']);
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    if (
      !line.startsWith('{"type":"tool_execution_start"') &&
      !line.startsWith('{"type":"tool_execution_end"') &&
      !line.startsWith('{"type":"message_end"')
    ) {
      return [];
    }
    const evt = parseJsonRecord(line);
    if (!evt) return [];
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
    if (evt['type'] === 'tool_execution_end' && typeof evt['toolCallId'] === 'string') {
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
    if (!isRecord(message)) return [];
    const events: HeadlessOutputEvent[] = [];
    if (message['stopReason'] === 'error' || message['stopReason'] === 'aborted') {
      events.push({
        type: 'error',
        message: typeof message['errorMessage'] === 'string'
          ? message['errorMessage']
          : `Oh My Pi request ${String(message['stopReason'])}`,
      });
    }
    const text = assistantTextFromMessage(message);
    if (text) events.push({ type: 'text', text });
    return events;
  },

  keepHeadlessDiagnosticLine(line: string): boolean {
    return !line.startsWith('{"type":"message_update"') &&
      !line.startsWith('{"type":"tool_execution_update"');
  },

  composeEnv(): Record<string, string> {
    return {};
  },

  async listOnDisk(cwd: string): Promise<readonly OnDiskSession[]> {
    return listOmpOnDisk(cwd);
  },

  async readSessionTitle(cwd: string, sessionId: string): Promise<string | null> {
    const sessions = await listOmpOnDisk(cwd);
    const match = sessions.find((session) => session.sessionId === sessionId);
    if (!match) return null;
    try {
      return readOmpSessionTitleFromJsonl(await readFile(match.file, 'utf8'));
    } catch {
      return null;
    }
  },
};

export async function listOmpOnDisk(
  cwd: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly OnDiskSession[]> {
  const configured = env['PI_CODING_AGENT_SESSION_DIR']?.trim();
  const dirs = configured
    ? [expandHome(configured, env['HOME']?.trim() || homedir())]
    : ompSessionBucketNames(cwd).map((name) => join(ompSessionsRoot(env), name));
  const seen = new Set<string>();
  const out: OnDiskSession[] = [];
  for (const dir of dirs) {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue;
    }
    for (const name of names) {
      const sessionId = sessionIdFromFilename(name);
      if (!sessionId || seen.has(sessionId)) continue;
      const file = join(dir, name);
      try {
        const st = await stat(file);
        if (!st.isFile()) continue;
        seen.add(sessionId);
        out.push({
          sessionId,
          file,
          mtime: st.mtime.toISOString(),
          sizeBytes: st.size,
        });
      } catch {
        // skip unreadable session files
      }
    }
  }
  return out;
}
