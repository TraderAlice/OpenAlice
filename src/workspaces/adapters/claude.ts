import { readFile, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type {
  AgentInteractiveSetupStatus,
  CliAdapter,
  SpawnContext,
  WorkspaceAiCred,
} from '../cli-adapter.js';
import { readWorkspaceFile } from '../file-service.js';
import type { ModelReasoningEffort } from '../../ai-providers/model-semantics.js';
import type { HeadlessOutputEvent } from '../headless-output.js';
import { resetOwnedJsonConfig, writeOwnedJsonConfig } from './owned-json-config.js';

const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';
const CLAUDE_BINDING_STATE_PATH = '.claude/openalice-provider.json';
const CLAUDE_OWNED_PATHS = [
  ['env', 'ANTHROPIC_BASE_URL'],
  ['env', 'ANTHROPIC_API_KEY'],
  ['env', 'ANTHROPIC_AUTH_TOKEN'],
  ['model'],
] as const;

const CLAUDE_PROJECT_EFFORTS = new Set<ModelReasoningEffort>(['low', 'medium', 'high', 'xhigh']);

function claudeProjectEffort(value: unknown): ModelReasoningEffort | null {
  return typeof value === 'string' && CLAUDE_PROJECT_EFFORTS.has(value as ModelReasoningEffort)
    ? value as ModelReasoningEffort
    : null;
}

/**
 * Claude Code parks project-scoped `.mcp.json` servers at "⏸ Pending
 * approval" (the trust gate for VCS-shared MCP config) until the user
 * approves them — and every workspace dir is a fresh project key, so an
 * interactive session would re-prompt on every new workspace. Inject the
 * auto-trust setting at spawn instead of writing it into
 * `.claude/settings.local.json`; `writeAiConfig` owns only its provider/env
 * nodes and preserves unrelated project settings. Headless `-p` connects to
 * project servers without approval today (verified on 2.1.170), but gets the
 * same flag so automation doesn't silently lose MCP if a future version
 * closes that gap.
 */
const AUTOTRUST_SETTINGS = '{"enableAllProjectMcpServers":true}';

// `claude -p` has nobody available to answer a permission prompt. Keep its
// autonomous Bash surface limited to the four launcher-owned CLI shims rather
// than bypassing every Claude Code permission. The gateway still validates the
// Workspace/run identity and each command's argument schema server-side.
// Syntax follows Claude Code's documented command-prefix permission rules.
const HEADLESS_ALLOWED_TOOLS = [
  'Bash(alice:*)',
  'Bash(alice-workspace:*)',
  'Bash(alice-uta:*)',
  'Bash(traderhub:*)',
].join(',');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Claude Code has two native gates that can consume the first interactive
 * screen before a seeded prompt: global onboarding and per-project trust.
 * Current Claude Code exposes no status/accept command for either gate, so we
 * read only the small booleans it already owns in `~/.claude.json`.
 *
 * This deliberately remains advisory and fail-open. The private file is never
 * changed, and an unfamiliar/corrupt shape returns `unknown` rather than
 * blocking launch or guessing that setup is complete.
 */
export async function readClaudeInteractiveSetupStatus(
  cwd: string,
  homeDir = homedir(),
): Promise<AgentInteractiveSetupStatus> {
  let parsed: unknown;
  try {
    const raw = await readFile(join(homeDir, '.claude.json'), 'utf8');
    parsed = JSON.parse(raw) as unknown;
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return 'runtime-onboarding-required';
    }
    return 'unknown';
  }

  if (!isRecord(parsed)) return 'unknown';
  const onboarding = parsed['hasCompletedOnboarding'];
  if (onboarding === false || onboarding === undefined) {
    return 'runtime-onboarding-required';
  }
  if (onboarding !== true) return 'unknown';

  const projects = parsed['projects'];
  if (projects === undefined) return 'workspace-trust-required';
  if (!isRecord(projects)) return 'unknown';
  const resolvedCwd = resolve(cwd);
  const physicalCwd = await realpath(resolvedCwd).catch(() => resolvedCwd);
  let projectSeen = false;
  const trusted = [resolvedCwd, physicalCwd].some((candidate) => {
    const project = projects[candidate];
    if (project !== undefined) projectSeen = true;
    return isRecord(project) && project['hasTrustDialogAccepted'] === true;
  });
  if (!trusted && projectSeen) {
    const project = projects[resolvedCwd] ?? projects[physicalCwd];
    if (!isRecord(project)) return 'unknown';
    const accepted = project['hasTrustDialogAccepted'];
    if (accepted !== undefined && typeof accepted !== 'boolean') return 'unknown';
  }
  return trusted
    ? 'ready'
    : 'workspace-trust-required';
}

/** dashed-cwd convention used by Claude Code's project store. */
function projectKey(workspaceDir: string): string {
  const abs = resolve(workspaceDir);
  return abs.replaceAll('/', '-').replaceAll('.', '-');
}

/**
 * The Claude Code adapter is the original launcher target. v2.M1 keeps its
 * behavior bit-identical with what shipped previously (`composeCommand` here
 * is the verbatim move of `index.ts:composeCommand` from before refactor).
 *
 * MCP wiring for claude is handled by the template's `.mcp.json` (the launcher
 * still does the placeholder-substitution at spawn-env-build time).
 */
export const claudeAdapter: CliAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  binary: 'claude',
  namePrefix: 'c',
  capabilities: {
    parallelPerCwd: true,
    // `claude --continue` is intentionally NOT supported. It's a fragile
    // flag whose semantics ("continue most recent in cwd") fails hard when:
    //   - the projectKey dir is empty (PTY started but user never sent a
    //     message before pausing — common in practice)
    //   - multiple jsonl coexist in the dir (claude picks ambiguously and
    //     bails with "No conversation found to continue")
    //   - the most-recent session lacks a deferred-tool marker
    // It's also irrelevant to OpenAlice's model: we already track session
    // identity at the record layer, so "resume by id" is the only mode
    // that fits the workbench. Records without a resolved id get a fresh
    // spawn — better than a respawn loop into the circuit breaker.
    resumeLast: false,
    resumeById: true,
    transcriptDiscovery: 'fs-watch',
    headless: true,
  },

  readInteractiveSetupStatus: readClaudeInteractiveSetupStatus,

  composeCommand(base: readonly string[], ctx: SpawnContext): readonly string[] {
    const cmd = [...base, '--settings', AUTOTRUST_SETTINGS];
    if (ctx.resume === undefined) {
      // Quick-chat seed: `claude [flags] -- <prompt>` opens the interactive TUI
      // and auto-submits the prompt. The `--` end-of-options terminator (same as
      // the headless path) keeps a prompt starting with `-`/`--` from being
      // mis-parsed as a flag (claude accepts `--` interactively; verified).
      if (ctx.initialPrompt) return [...cmd, '--', ctx.initialPrompt];
      return cmd;
    }
    if (ctx.resume === 'last') {
      throw new Error(
        'claude adapter: "last" resume not supported — use --resume <sessionId> or undefined (fresh)',
      );
    }
    return [...cmd, '--resume', ctx.resume.sessionId];
  },

  // Headless: `claude -p` is non-interactive and exits at the turn boundary.
  // MCP rides the workspace `.mcp.json` (same as interactive) — so NEVER pass
  // `--bare`, which sets CLAUDE_CODE_SIMPLE=1 and disables MCP (the agent would
  // lose inbox_push). The prompt is the trailing positional AFTER a `--`
  // end-of-options terminator, so a prompt that starts with `-`/`--` isn't
  // mis-parsed as a flag (verified: without `--`, claude errors out).
  // Output is `stream-json` (one event per line, REQUIRES --verbose — plain
  // `-p --output-format stream-json` errors out): the launcher gets live
  // progress in the task log AND every event carries `session_id`, so the
  // run's identity is captured from line 1 instead of parsed out of a final
  // result blob (verified 2.1.x, 2026-06-11).
  composeHeadlessCommand(base: readonly string[], ctx: SpawnContext, prompt: string): readonly string[] {
    if (ctx.resume === 'last') {
      throw new Error('claude headless: resume requires a concrete resumeId mapping')
    }
    return [
      ...base,
      '--settings', AUTOTRUST_SETTINGS,
      '--allowedTools', HEADLESS_ALLOWED_TOOLS,
      ...(ctx.resume ? ['--resume', ctx.resume.sessionId] : []),
      '-p', '--output-format', 'stream-json', '--verbose',
      '--', prompt,
    ];
  },

  extractHeadlessSessionId(line: string): string | null {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      return typeof evt['session_id'] === 'string' ? evt['session_id'] : null;
    } catch {
      return null;
    }
  },

  extractHeadlessAssistantText(line: string): string | null {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      if (evt['type'] === 'result' && evt['subtype'] === 'success') {
        return typeof evt['result'] === 'string' ? evt['result'] : null;
      }
      if (evt['type'] !== 'assistant') return null;
      const message = evt['message'];
      if (!message || typeof message !== 'object') return null;
      const content = (message as Record<string, unknown>)['content'];
      if (!Array.isArray(content)) return null;
      const text = content
        .flatMap((part) => {
          if (!part || typeof part !== 'object') return [];
          const record = part as Record<string, unknown>;
          return record['type'] === 'text' && typeof record['text'] === 'string'
            ? [record['text']]
            : [];
        })
        .join('\n');
      return text || null;
    } catch {
      return null;
    }
  },

  extractHeadlessOutputEvents(line: string): readonly HeadlessOutputEvent[] {
    try {
      const evt = JSON.parse(line) as Record<string, unknown>;
      const message = evt['message'];
      if (message && typeof message === 'object') {
        const record = message as Record<string, unknown>;
        const content = record['content'];
        if (Array.isArray(content)) {
          if (evt['type'] === 'assistant' && record['role'] === 'assistant') {
            return content.flatMap((part): HeadlessOutputEvent[] => {
              if (!part || typeof part !== 'object') return [];
              const block = part as Record<string, unknown>;
              if (block['type'] === 'text' && typeof block['text'] === 'string') {
                return [{ type: 'text', text: block['text'] }];
              }
              if (
                block['type'] === 'tool_use' &&
                typeof block['id'] === 'string' &&
                typeof block['name'] === 'string'
              ) {
                return [{
                  type: 'tool-start',
                  id: block['id'],
                  name: block['name'],
                  ...(block['input'] !== undefined ? { input: block['input'] } : {}),
                }];
              }
              return [];
            });
          }
          if (evt['type'] === 'user' && record['role'] === 'user') {
            return content.flatMap((part): HeadlessOutputEvent[] => {
              if (!part || typeof part !== 'object') return [];
              const block = part as Record<string, unknown>;
              if (block['type'] !== 'tool_result' || typeof block['tool_use_id'] !== 'string') return [];
              return [{
                type: 'tool-finish',
                id: block['tool_use_id'],
                ...(block['content'] !== undefined ? { output: block['content'] } : {}),
                ...(block['is_error'] === true ? { isError: true } : {}),
              }];
            });
          }
        }
      }
      if (evt['type'] === 'result' && evt['is_error'] === true) {
        const result = evt['result'];
        return [{ type: 'error', message: typeof result === 'string' ? result : 'Claude run failed' }];
      }
      return [];
    } catch {
      return [];
    }
  },

  async writeAiConfig(cwd: string, cred: WorkspaceAiCred): Promise<void> {
    const hasAny = cred.baseUrl || cred.apiKey || cred.model;
    if (!hasAny) {
      await resetOwnedJsonConfig({
        cwd,
        configPath: CLAUDE_SETTINGS_PATH,
        statePath: CLAUDE_BINDING_STATE_PATH,
        label: 'Claude project settings',
        legacyOwnedPaths: CLAUDE_OWNED_PATHS,
      });
      return;
    }
    if (cred.reasoningEffort && !claudeProjectEffort(cred.reasoningEffort)) {
      throw new Error(`Claude Code cannot persist project effort ${cred.reasoningEffort}`);
    }
    // Write the key into exactly one env var. Bearer-mode gateways read
    // ANTHROPIC_AUTH_TOKEN; x-api-key mode reads ANTHROPIC_API_KEY. Those
    // provider paths plus effortLevel are the OpenAlice ownership boundary —
    // permissions and every unknown project setting remain untouched and reset
    // reversibly. effortLevel is sidecar-owned only; it is intentionally absent
    // from the legacy fallback because older OpenAlice versions never wrote it.
    await writeOwnedJsonConfig({
      cwd,
      configPath: CLAUDE_SETTINGS_PATH,
      statePath: CLAUDE_BINDING_STATE_PATH,
      label: 'Claude project settings',
      entries: [
        { path: ['env', 'ANTHROPIC_BASE_URL'], present: !!cred.baseUrl, value: cred.baseUrl },
        {
          path: ['env', 'ANTHROPIC_API_KEY'],
          present: !!cred.apiKey && cred.authMode !== 'bearer',
          value: cred.apiKey,
        },
        {
          path: ['env', 'ANTHROPIC_AUTH_TOKEN'],
          present: !!cred.apiKey && cred.authMode === 'bearer',
          value: cred.apiKey,
        },
        { path: ['model'], present: !!cred.model, value: cred.model },
        { path: ['effortLevel'], present: !!cred.reasoningEffort, value: cred.reasoningEffort },
      ],
    });
  },

  async readAiConfig(cwd: string): Promise<WorkspaceAiCred | null> {
    const raw = await readWorkspaceFile(cwd, CLAUDE_SETTINGS_PATH);
    if (raw === null) return null;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return null;
    }
    const env = (parsed['env'] ?? {}) as Record<string, unknown>;
    const baseUrl = typeof env['ANTHROPIC_BASE_URL'] === 'string' ? (env['ANTHROPIC_BASE_URL'] as string) : null;
    // The key lives in exactly one of two env vars depending on auth mode:
    // ANTHROPIC_API_KEY → x-api-key header, ANTHROPIC_AUTH_TOKEN → Bearer.
    // Which one is present tells us the mode to surface back to the modal.
    const xApiKey = typeof env['ANTHROPIC_API_KEY'] === 'string' ? (env['ANTHROPIC_API_KEY'] as string) : null;
    const authToken = typeof env['ANTHROPIC_AUTH_TOKEN'] === 'string' ? (env['ANTHROPIC_AUTH_TOKEN'] as string) : null;
    const authMode: 'x-api-key' | 'bearer' = authToken !== null ? 'bearer' : 'x-api-key';
    const apiKey = authToken ?? xApiKey;
    const model = typeof parsed['model'] === 'string' ? (parsed['model'] as string) : null;
    const reasoningEffort = claudeProjectEffort(parsed['effortLevel']);
    if (baseUrl === null && apiKey === null && model === null && reasoningEffort === null) return null;
    // Claude Code is anthropic-only.
    return {
      baseUrl,
      apiKey,
      model,
      authMode,
      wireShape: 'anthropic',
      ...(reasoningEffort ? { reasoningEffort } : {}),
    };
  },

  transcriptDir(cwd: string): string {
    return join(homedir(), '.claude', 'projects', projectKey(cwd));
  },
  transcriptFileRe: SESSION_FILE_RE,
  extractSessionId(filename: string): string | null {
    const m = SESSION_FILE_RE.exec(filename);
    return m && m[1] ? m[1] : null;
  },
};
