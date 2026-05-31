import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { CliAdapter, SpawnContext } from '../cli-adapter.js';

const SESSION_FILE_RE = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.jsonl$/i;

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
  },

  composeCommand(base: readonly string[], ctx: SpawnContext): readonly string[] {
    // Auto-trust the workspace's project-scoped `.mcp.json` servers. Without
    // this, Claude Code parks every project MCP server at "⏸ Pending approval"
    // (the trust gate for `.mcp.json` shared via VCS) and the agent never sees
    // the OpenAlice tool surface — the symptom users hit as "MCP 啟動唔到".
    //
    // Injected on the command line (not via a written `.claude/settings.json`)
    // to match the launcher's CLI-injection philosophy — same as the codex
    // adapter's `-c mcp_servers.openalice.url=...`. Verified empirically that
    // neither `--mcp-config`, `--dangerously-skip-permissions`, nor
    // `--permission-mode bypassPermissions` clears this gate; only the
    // `enableAllProjectMcpServers` setting does. `--settings` accepts an inline
    // JSON string (PTY spawn passes argv directly, so no shell-quoting needed).
    const cmd = [
      ...base,
      '--settings',
      JSON.stringify({ enableAllProjectMcpServers: true }),
    ];
    if (ctx.resume === undefined) return cmd;
    if (ctx.resume === 'last') {
      throw new Error(
        'claude adapter: "last" resume not supported — use --resume <sessionId> or undefined (fresh)',
      );
    }
    return [...cmd, '--resume', ctx.resume.sessionId];
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
