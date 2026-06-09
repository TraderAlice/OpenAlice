import { rm } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CliAdapter, SpawnContext, WorkspaceAiCred } from '../cli-adapter.js';
import { readWorkspaceFile, writeWorkspaceFile } from '../file-service.js';

const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

const CLAUDE_SETTINGS_PATH = '.claude/settings.local.json';

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
 * still does the placeholder-substitution at spawn-env-build time). v2.M4
 * generalizes that into `bootstrap()` here.
 */
export const claudeAdapter: CliAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
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

  composeCommand(base: readonly string[], ctx: SpawnContext): readonly string[] {
    if (ctx.resume === undefined) return base;
    if (ctx.resume === 'last') {
      throw new Error(
        'claude adapter: "last" resume not supported — use --resume <sessionId> or undefined (fresh)',
      );
    }
    return [...base, '--resume', ctx.resume.sessionId];
  },

  // Headless: `claude -p` is non-interactive and exits at the turn boundary.
  // MCP rides the workspace `.mcp.json` (same as interactive) — so NEVER pass
  // `--bare`, which sets CLAUDE_CODE_SIMPLE=1 and disables MCP (the agent would
  // lose inbox_push). The prompt is the trailing positional AFTER a `--`
  // end-of-options terminator, so a prompt that starts with `-`/`--` isn't
  // mis-parsed as a flag (verified: without `--`, claude errors out).
  composeHeadlessCommand(base: readonly string[], _ctx: SpawnContext, prompt: string): readonly string[] {
    return [...base, '-p', '--output-format', 'json', '--', prompt];
  },

  async writeAiConfig(cwd: string, cred: WorkspaceAiCred): Promise<void> {
    const hasAny = cred.baseUrl || cred.apiKey || cred.model;
    if (!hasAny) {
      // Reset: delete the settings file so claude falls back to its global
      // OAuth / settings. We don't leave an empty `{}` behind — workspace
      // files exist only when there's an actual override.
      const filePath = join(cwd, CLAUDE_SETTINGS_PATH);
      await rm(filePath, { force: true });
      return;
    }
    const out: Record<string, unknown> = {};
    const env: Record<string, string> = {};
    if (cred.baseUrl) env['ANTHROPIC_BASE_URL'] = cred.baseUrl;
    // Write the key into exactly one env var. Bearer-mode gateways (MiniMax
    // international, proxy front-ends) read ANTHROPIC_AUTH_TOKEN → the CLI sends
    // `Authorization: Bearer`. Default x-api-key mode uses ANTHROPIC_API_KEY.
    // Never write both: Claude Code warns on dual-set, and the two headers
    // together can be rejected as ambiguous auth.
    if (cred.apiKey) {
      if (cred.authMode === 'bearer') env['ANTHROPIC_AUTH_TOKEN'] = cred.apiKey;
      else env['ANTHROPIC_API_KEY'] = cred.apiKey;
    }
    if (Object.keys(env).length > 0) out['env'] = env;
    if (cred.model) out['model'] = cred.model;
    await writeWorkspaceFile(cwd, CLAUDE_SETTINGS_PATH, JSON.stringify(out, null, 2) + '\n');
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
    if (baseUrl === null && apiKey === null && model === null) return null;
    // Claude Code is anthropic-only.
    return { baseUrl, apiKey, model, authMode, wireShape: 'anthropic' };
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
