/**
 * Thin fetch wrapper for /api/workspaces*. Types mirror the server's
 * `WorkspaceMeta` (plus a synthetic `claudeRunning` field derived by the
 * server from the SessionPool).
 */

import type { WireShape } from '../../api'

export interface Workspace {
  readonly id: string;
  readonly tag: string;
  /** Workspace-owned display label from `.alice/workspace.json`; falls back to `tag`. */
  readonly displayName?: string;
  /** Workspace-owned short description from `.alice/workspace.json`. */
  readonly description?: string;
  /** Validation/read error for `.alice/workspace.json`, when present. */
  readonly metadataError?: string;
  readonly dir: string;
  readonly createdAt: string;
  readonly template?: string;
  /**
   * The template version at the moment this workspace was spawned. Pinned
   * once — system-written, never updated. Used to render lineage in the
   * Overview card ("from {template} v{spawnedFromVersion}").
   */
  readonly spawnedFromVersion?: string;
  /**
   * The instance's currently self-reported version, read from
   * `<workspace>/README.md` frontmatter on every list call. The agent can
   * mutate this when self-upgrading. Falls back to `spawnedFromVersion`
   * if the instance README is missing or has no version frontmatter.
   */
  readonly currentVersion?: string;
  /**
   * Set when the template (in source tree) is at a higher version than the
   * instance currently self-claims. Informational only — clicking the
   * badge jumps the user to the template's detail page; nothing in the
   * launcher applies migrations. Agent self-upgrade is the resolution path.
   */
  readonly upgradeAvailable?: { from: string; to: string } | null;
  /** Adapter ids enabled for this workspace. Default runtime lives in user config. */
  readonly agents: readonly string[];
  /**
   * Single ordered list of all session records (running + paused) the
   * launcher tracks for this workspace. Source of truth for sidebar + main
   * pane state.
   */
  readonly sessions: readonly SessionRecord[];
  /**
   * Whether the workspace has UI-saved AI provider overrides for each
   * agent. claude = `.claude/settings.local.json` exists; codex = `.codex/`
   * dir; opencode = `opencode.json`; pi = `.pi-agent/` dir. Surfaced in the
   * Overview dashboard.
   */
  readonly agentOverride?: {
    readonly claude: boolean;
    readonly codex: boolean;
    readonly opencode: boolean;
    readonly pi: boolean;
  };
}

export interface CreateError {
  readonly error:
    | 'invalid_tag'
    | 'tag_in_use'
    | 'tag_required'
    | 'bootstrap_failed'
    | 'unknown_template'
    | 'unknown_agent'
    | 'no_templates_configured';
  readonly message?: string;
  readonly stderr?: string;
}

export type CreateResult =
  | { readonly ok: true; readonly workspace: Workspace }
  | { readonly ok: false; readonly status: number; readonly error: CreateError };

export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch('/api/workspaces');
  if (!res.ok) throw new Error(`list failed: ${res.status}`);
  const body = (await res.json()) as { workspaces: Workspace[] };
  return body.workspaces;
}

/**
 * Create a workspace. `agents` is optional and normally omitted — the backend
 * owns the "every registered adapter, template-headed" policy (see
 * `WorkspaceCreator.create`). Pass an explicit set only to pin a subset.
 */
export async function createWorkspace(
  tag: string,
  template: string,
  agents?: readonly string[],
): Promise<CreateResult> {
  const res = await fetch('/api/workspaces', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(agents && agents.length > 0 ? { tag, template, agents } : { tag, template }),
  });
  if (res.ok) {
    const body = (await res.json()) as { workspace: Workspace };
    return { ok: true, workspace: body.workspace };
  }
  let err: CreateError;
  try {
    err = (await res.json()) as CreateError;
  } catch {
    err = { error: 'bootstrap_failed', message: `HTTP ${res.status}` };
  }
  return { ok: false, status: res.status, error: err };
}

export interface TemplateInfo {
  readonly name: string;
  readonly description?: string;
  /** Human-readable name for UI surfaces (dashboard section headers, etc.). */
  readonly displayName?: string;
  /** Sort key for dashboard grouping. Lower = earlier. Templates without
   *  a declared `groupOrder` sort after declared ones, by name. */
  readonly groupOrder?: number;
  /** Community-tier: bundles a third-party ecosystem maintained outside
   *  OpenAlice. Rendered under a separate "Community" section. */
  readonly community?: boolean;
  readonly defaultAgents: readonly string[];
  /** Template version, declared in README frontmatter. "0.0.0" when missing. */
  readonly version: string;
  /** True if the template ships a README.md (showcase detail page can load it). */
  readonly hasReadme: boolean;
}

export async function listTemplates(): Promise<TemplateInfo[]> {
  const res = await fetch('/api/workspaces/templates');
  if (!res.ok) throw new Error(`list templates failed: ${res.status}`);
  const body = (await res.json()) as { templates: TemplateInfo[] };
  return body.templates;
}

/**
 * Fetch a template's raw README markdown. Strips YAML frontmatter before
 * returning — frontmatter is metadata, not content the user should see.
 * Returns null when the template has no README.
 */
export async function fetchTemplateReadme(name: string): Promise<string | null> {
  const res = await fetch(`/api/workspaces/templates/${encodeURIComponent(name)}/readme`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`fetch readme failed: ${res.status}`);
  const raw = await res.text();
  return stripFrontmatter(raw);
}

/**
 * Strip a leading YAML frontmatter block (`---` ... `---`) so the rendered
 * README body doesn't show the metadata to the user. Conservative: only
 * strips when frontmatter is at column 0; anything else passes through.
 */
function stripFrontmatter(raw: string): string {
  const text = raw.replace(/^﻿/, '');
  if (!text.startsWith('---')) return text;
  const closeMatch = /^---\s*$/m.exec(text.slice(3));
  if (!closeMatch || closeMatch.index === undefined) return text;
  // Skip past the closing fence and any trailing newline.
  const tailStart = 3 + closeMatch.index + closeMatch[0].length;
  return text.slice(tailStart).replace(/^\r?\n/, '');
}

export interface AgentCapabilities {
  readonly parallelPerCwd: boolean;
  readonly resumeLast: boolean;
  readonly resumeById: boolean;
  readonly transcriptDiscovery: 'fs-watch' | 'subprocess' | 'none';
}

export interface AgentInfo {
  readonly id: string;
  readonly displayName: string;
  readonly kind?: 'agent' | 'utility';
  readonly capabilities: AgentCapabilities;
  /**
   * Whether the runtime's CLI was found on the host PATH. Backend-probed per
   * list call (see src/workspaces/agent-detect.ts). Optional for backward
   * compat — treat a missing value as installed (don't gate on a stale shape).
   */
  readonly installed?: boolean;
  /** Absolute path the CLI resolved to, when installed. */
  readonly binPath?: string | null;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const res = await fetch('/api/workspaces/agents');
  if (!res.ok) throw new Error(`list agents failed: ${res.status}`);
  const body = (await res.json()) as { agents: AgentInfo[] };
  return body.agents;
}

export async function getWorkspaceDefaultAgent(): Promise<string | null> {
  const res = await fetch('/api/config/workspace-default-agent');
  if (!res.ok) return null;
  const body = (await res.json()) as { agent?: string | null };
  return body.agent ?? null;
}

export async function setWorkspaceDefaultAgent(agent: string | null): Promise<string | null> {
  const res = await fetch('/api/config/workspace-default-agent', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`set workspace default agent failed: ${res.status} ${msg}`);
  }
  const body = (await res.json()) as { agent?: string | null };
  return body.agent ?? null;
}

// ── sessions ─────────────────────────────────────────────────────────────────
//
// V3.S4 — single SessionRecord type that covers both running PTYs and paused
// records. `pid` + `startedAt` are non-null only when `state === 'running'`.
// Persisted server-side at ~/.auto-quant-launcher/state/sessions/<wsId>.json
// so records survive PTY death and server restarts.

export interface SessionRecord {
  readonly id: string;
  readonly wsId: string;
  readonly agent: string;            // 'claude' | 'codex' | 'shell'
  readonly name: string;              // sticky 'c1' / 'x1' / 'sh1'
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly state: 'running' | 'paused';
  readonly agentSessionId: string | null;
  readonly pid: number | null;
  readonly startedAt: number | null;
  /** First message (seeded sessions) — the sidebar title; null → fall back to `name`. */
  readonly title: string | null;
}

export interface SpawnedSession {
  readonly sessionId: string;
  readonly wsId: string;
  readonly name: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly agent: string;
  readonly agentSessionId: string | null;
  readonly title: string | null;
}

export interface SpawnOptions {
  /** `'last'` → adapter-specific "continue", any string → adapter-specific resume-by-id. */
  readonly resume?: 'last' | string;
  /** Explicit runtime/tool adapter for this spawn. */
  readonly agent?: string;
  /**
   * Seed a FRESH session with a first user message — the quick-chat launch
   * ("type a message → you're in, agent already working"). Server-side it rides
   * the adapter's interactive `composeCommand`; ignored when `resume` is set.
   */
  readonly initialPrompt?: string;
}

export async function spawnSession(
  id: string,
  opts: SpawnOptions = {},
): Promise<SpawnedSession> {
  const body: Record<string, unknown> = {};
  if (opts.resume !== undefined) body['resume'] = opts.resume;
  if (opts.agent !== undefined) body['agent'] = opts.agent;
  if (opts.initialPrompt !== undefined) body['initialPrompt'] = opts.initialPrompt;
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}/sessions/spawn`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`spawn session failed: ${res.status} ${msg}`);
  }
  return (await res.json()) as SpawnedSession;
}

/** Response of the quick-chat launch: the (reused-or-created) chat workspace + the seeded session. */
export interface QuickChatResult {
  readonly workspace: Workspace;
  readonly session: SpawnedSession;
}

/** Error thrown by `quickChat`, carrying the backend error `code` when present
 *  (e.g. `no_ai_credential` → the composer bounces the user to Settings). */
export class QuickChatError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
    this.name = 'QuickChatError';
  }
}

/**
 * Quick-chat launch — the "type a message → you're in" front door. One POST
 * reuses-or-creates the chat workspace and spawns a fresh session seeded with
 * `prompt`; the returned `session.sessionId` is what the caller attaches to.
 * `credentialSlug` seeds a loginless runtime (opencode/pi) — ignored for
 * claude/codex, which carry their own CLI login.
 */
export async function quickChat(
  prompt: string,
  agent?: string,
  credentialSlug?: string,
  targetWsId?: string,
): Promise<QuickChatResult> {
  const body: Record<string, unknown> = { prompt };
  if (agent !== undefined) body['agent'] = agent;
  if (credentialSlug !== undefined) body['credentialSlug'] = credentialSlug;
  if (targetWsId !== undefined) body['targetWsId'] = targetWsId;
  const res = await fetch('/api/workspaces/quick-chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new QuickChatError(`quick chat failed: ${res.status} ${parsed?.error ?? ''}`, parsed?.error);
  }
  return (await res.json()) as QuickChatResult;
}

/** Pause a session — kills its PTY but keeps the record so it can be resumed later. */
export async function pauseSession(wsId: string, sessionId: string): Promise<boolean> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/pause`,
    { method: 'POST' },
  );
  return res.ok;
}

/**
 * Resume a paused session. Server re-spawns the PTY using the adapter's resume
 * semantic (claude: --resume <id> or --continue; codex: resume --last; shell:
 * fresh PTY w/ scrollback restore in S5).
 */
export async function resumeSession(wsId: string, sessionId: string): Promise<SpawnedSession | null> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/resume`,
    { method: 'POST' },
  );
  if (!res.ok) return null;
  return (await res.json()) as SpawnedSession;
}

/** Permanently remove a session record (kills PTY first if running). */
export async function deleteSession(wsId: string, sessionId: string): Promise<boolean> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}`,
    { method: 'DELETE' },
  );
  return res.ok;
}

export async function deleteWorkspace(id: string): Promise<boolean> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  return res.ok;
}

export type WorkspaceMetadataPatch = { displayName?: string | null; description?: string | null };

export async function updateWorkspaceMetadata(
  id: string,
  metadata: WorkspaceMetadataPatch,
): Promise<Workspace> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/metadata`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(metadata),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`update workspace metadata failed: ${res.status} ${msg}`);
  }
  const body = (await res.json()) as { workspace: Workspace };
  return body.workspace;
}

/**
 * Kill the PTY for this workspace. Server-side PersistentSession disposes,
 * memory is freed, on-disk Claude Code session JSONLs are preserved. The
 * workspace itself stays in the registry. Idempotent.
 */
export async function stopWorkspace(id: string): Promise<boolean> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/stop`, {
    method: 'POST',
  });
  return res.ok;
}

// ── git ──────────────────────────────────────────────────────────────────────

export interface GitLogEntry {
  readonly hash: string;
  readonly subject: string;
  readonly relTime: string;
  readonly authorTime: string;
}

export interface GitStatusFile {
  readonly path: string;
  readonly status: string;
}

export interface GitStatus {
  readonly branch: string | null;
  readonly clean: boolean;
  readonly files: readonly GitStatusFile[];
}

export async function getGitLog(id: string, limit = 30): Promise<GitLogEntry[]> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(id)}/git/log?limit=${limit}`,
  );
  if (!res.ok) throw new Error(`git log failed: ${res.status}`);
  const body = (await res.json()) as { entries: GitLogEntry[] };
  return body.entries;
}

export async function getGitStatus(id: string): Promise<GitStatus> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/git/status`);
  if (!res.ok) throw new Error(`git status failed: ${res.status}`);
  return (await res.json()) as GitStatus;
}

// ── files ────────────────────────────────────────────────────────────────────

export interface FileEntry {
  readonly name: string;
  readonly kind: 'file' | 'dir' | 'symlink' | 'other';
  readonly sizeBytes: number | null;
  readonly mtime: string;
}

export interface DirListing {
  readonly path: string;
  readonly entries: readonly FileEntry[];
}

function electronWorkspaceBridge(): NonNullable<Window['openAlice']>['workspace'] | undefined {
  return typeof window !== 'undefined' ? window.openAlice?.workspace : undefined;
}

export async function listFiles(id: string, relPath: string): Promise<DirListing> {
  // Electron app mode has a native file transport. Browser/dev/Docker keep the
  // HTTP path, which is still the right shape for self-hosting and ordinary
  // browser debugging.
  const bridge = electronWorkspaceBridge();
  if (bridge) return bridge.listFiles({ id, path: relPath });
  const qs = relPath ? `?path=${encodeURIComponent(relPath)}` : '';
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/files${qs}`);
  if (!res.ok) throw new Error(`list files failed: ${res.status}`);
  return (await res.json()) as DirListing;
}

/**
 * Read a single UTF-8 text file from inside a workspace. Returns a
 * discriminated result so the caller (Inbox detail pane) can render
 * tombstone variants without parsing error strings.
 */
export type ReadFileResult =
  | { kind: 'ok'; content: string }
  | { kind: 'workspace_missing' }
  | { kind: 'file_missing' }
  | { kind: 'too_large'; sizeBytes: number }
  | { kind: 'invalid_path' }
  | { kind: 'error'; message: string };

export async function readWorkspaceFile(id: string, relPath: string): Promise<ReadFileResult> {
  const bridge = electronWorkspaceBridge();
  if (bridge) return bridge.readFile({ id, path: relPath });
  const qs = `?path=${encodeURIComponent(relPath)}`;
  let res: Response;
  try {
    res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/file${qs}`);
  } catch (err) {
    return { kind: 'error', message: (err as Error).message };
  }
  if (res.ok) {
    const body = (await res.json()) as { content: string };
    return { kind: 'ok', content: body.content };
  }
  // Map known error shapes to discriminated variants. Unknown → generic error.
  const body = (await res.json().catch(() => null)) as { error?: string; sizeBytes?: number } | null;
  switch (body?.error) {
    case 'workspace_not_found': return { kind: 'workspace_missing' };
    case 'file_not_found':      return { kind: 'file_missing' };
    case 'file_too_large':      return { kind: 'too_large', sizeBytes: body.sizeBytes ?? 0 };
    case 'invalid_path':        return { kind: 'invalid_path' };
    default:                    return { kind: 'error', message: body?.error ?? `HTTP ${res.status}` };
  }
}

// ── Agent provider config ───────────────────────────────────────────────────

export interface AgentConfig {
  readonly baseUrl: string | null;
  readonly apiKey: string | null;
  readonly model: string | null;
  /** Optional custom-model context window for opencode/Pi provider overrides. */
  readonly contextWindow?: number | null;
  /** Wire protocol the endpoint speaks — drives how the adapter is configured. */
  readonly wireShape?: WireShape | null;
  /** Codex only — wire format for the upstream API. */
  readonly wireApi?: 'chat' | 'responses' | null;
  /**
   * Claude only — `x-api-key` (Anthropic first-party default) vs `bearer`
   * (`Authorization: Bearer`, for anthropic-compatible gateways like MiniMax
   * international). Mirrors ANTHROPIC_API_KEY vs ANTHROPIC_AUTH_TOKEN.
   */
  readonly authMode?: 'x-api-key' | 'bearer';
}

export interface AgentConfigBundle {
  readonly claude: AgentConfig | null;
  readonly codex: AgentConfig | null;
  readonly opencode: AgentConfig | null;
  readonly pi: AgentConfig | null;
}

export type AgentId = 'claude' | 'codex' | 'opencode' | 'pi';

export type AgentCredentialSource =
  | 'runtime-login'
  | 'workspace-config'
  | 'launcher-vault'
  | 'missing'
  | 'unknown-agent'
  | 'disabled-agent';

export interface AgentCredentialReadiness {
  readonly agent: string;
  readonly ready: boolean;
  readonly requiresCredential: boolean;
  readonly source: AgentCredentialSource;
  readonly hasWorkspaceConfig: boolean;
  readonly hasUsableWorkspaceConfig: boolean;
  readonly detectedCredentialSlug: string | null;
  readonly compatibleCredentialSlugs: readonly string[];
  readonly injectableCredentialSlugs: readonly string[];
  readonly settingsTarget?: 'ai-provider';
  readonly message?: string;
}

export interface AgentReadinessBundle {
  readonly agents: Record<string, AgentCredentialReadiness>;
}

// ── Central credential store ──────────────────────────────────────────────
//
// Alice's reusable credentials (`data/config/ai-provider-manager.json`). The
// modal's "Load from saved credential" picker reads these; "Save to Alice"
// writes a new one. apiKey is returned so a picked credential can be flashed
// into the form (same exposure as agent-profiles; admin-token gated).

export interface SavedCredential {
  readonly slug: string;
  readonly vendor: string;
  readonly label?: string;
  readonly authType: 'api-key' | 'subscription';
  /** Wire capabilities: each shape this key speaks → its endpoint baseUrl. */
  readonly wires: Partial<Record<WireShape, string>>;
  /** Last model run against this key, when remembered. Absent until first use. */
  readonly lastModel?: string;
  /** Omitted in the per-agent (`?agent=`) listing — only the unfiltered list returns it. */
  readonly apiKey?: string | null;
}

export async function listCredentials(): Promise<SavedCredential[]> {
  const res = await fetch('/api/workspaces/credentials');
  if (!res.ok) throw new Error(`list credentials failed: ${res.status}`);
  const body = (await res.json()) as { credentials: SavedCredential[] };
  return body.credentials;
}

/** List only the credentials the given agent can be driven by (wire-compatible). */
export async function listAgentCredentials(agent: string): Promise<SavedCredential[]> {
  const res = await fetch(`/api/workspaces/credentials?agent=${encodeURIComponent(agent)}`);
  if (!res.ok) throw new Error(`list agent credentials failed: ${res.status}`);
  const body = (await res.json()) as { credentials: SavedCredential[] };
  return body.credentials;
}

/** Which vault credential a workspace's agent is currently configured with (null = none/hand-edited). */
export async function detectWorkspaceCredential(
  wsId: string,
  agent: string,
): Promise<{ slug: string | null; model: string | null }> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/agent-config/${encodeURIComponent(agent)}/credential`,
  );
  if (!res.ok) return { slug: null, model: null };
  return (await res.json()) as { slug: string | null; model: string | null };
}

/** Persist a hand-entered provider as a reusable central credential. Returns the slug. */
export async function saveCredential(input: {
  apiKey: string;
  baseUrl?: string;
  agent?: AgentId;
  label?: string;
  wireShape?: WireShape;
}): Promise<{ slug: string; vendor: string }> {
  const res = await fetch('/api/workspaces/credentials', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`save credential failed: ${res.status} ${msg}`);
  }
  return (await res.json()) as { slug: string; vendor: string };
}

export async function getAgentConfig(wsId: string): Promise<AgentConfigBundle> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/agent-config`);
  if (!res.ok) throw new Error(`get agent config failed: ${res.status}`);
  return (await res.json()) as AgentConfigBundle;
}

export async function getAgentReadiness(wsId: string): Promise<AgentReadinessBundle> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/agent-readiness`);
  if (!res.ok) throw new Error(`get agent readiness failed: ${res.status}`);
  return (await res.json()) as AgentReadinessBundle;
}

export async function saveAgentConfig(
  wsId: string,
  agent: AgentId,
  cfg: AgentConfig,
): Promise<void> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/agent-config/${agent}`,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    },
  );
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`save agent config failed: ${res.status} ${msg}`);
  }
}

export interface AgentTestResult {
  readonly ok: boolean;
  readonly response?: string;
  readonly error?: string;
}

export interface AgentTestInput {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** Wire protocol to probe with (shared dispatcher). */
  readonly wireShape?: WireShape;
  /** Codex only. */
  readonly wireApi?: 'chat' | 'responses';
  /** Claude only. */
  readonly authMode?: 'x-api-key' | 'bearer';
}

export async function testAgentConfig(
  wsId: string,
  agent: AgentId,
  cfg: AgentTestInput,
): Promise<AgentTestResult> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/agent-config/${agent}/test`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(cfg),
    },
  );
  try {
    return (await res.json()) as AgentTestResult;
  } catch {
    return { ok: false, error: `HTTP ${res.status}` };
  }
}
