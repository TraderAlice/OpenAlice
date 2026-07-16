/**
 * Thin fetch wrapper for /api/workspaces*. Types mirror the server's
 * `WorkspaceMeta` (plus a synthetic `claudeRunning` field derived by the
 * server from the SessionPool).
 */

import type { WireShape } from '../../api'
import type { TerminalThemeVariant } from './terminalTheme'

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
  /** Last successfully applied template baseline; README text cannot forge it. */
  readonly currentVersion?: string;
  /**
   * Set when the source template is newer than the recorded applied baseline.
   * Opens the reviewed three-way Template Upgrade flow.
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
    | 'insufficient_storage'
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

export type TemplateUpgradeFileStatus = 'ready' | 'preserved' | 'conflict' | 'unchanged'
export type TemplateUpgradeResolution = 'workspace' | 'template'

export interface TemplateUpgradeFilePlan {
  readonly path: string
  readonly status: TemplateUpgradeFileStatus
  readonly operation: 'add' | 'update' | 'remove' | 'keep' | 'none'
  readonly currentPreview: string | null
  readonly templatePreview: string | null
  readonly currentTruncated: boolean
  readonly templateTruncated: boolean
  readonly canUseTemplate: boolean
  readonly note?: string
}

export interface TemplateUpgradePlan {
  readonly workspaceId: string
  readonly template: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly strategy: 'managed-context'
  readonly planDigest: string
  readonly source: 'recorded-baseline' | 'legacy-root-commit'
  readonly blocked: boolean
  readonly blockers: readonly string[]
  readonly activity: {
    readonly busy: boolean
    readonly sessions: readonly {
      readonly sessionId: string
      readonly resumeId: string
      readonly name: string
      readonly agent: string
      readonly surface: 'terminal' | 'webpi'
      readonly startedAt: number | null
    }[]
    readonly headless: readonly {
      readonly taskId: string | null
      readonly agent: string
      readonly startedAt: number
    }[]
  }
  readonly files: readonly TemplateUpgradeFilePlan[]
  readonly summary: {
    readonly ready: number
    readonly preserved: number
    readonly conflicts: number
    readonly unchanged: number
  }
}

export interface TemplateUpgradeResult {
  readonly workspaceId: string
  readonly fromVersion: string
  readonly toVersion: string
  readonly commit: string
  readonly changedPaths: readonly string[]
  readonly keptPaths: readonly string[]
}

export class TemplateUpgradeApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly plan?: TemplateUpgradePlan,
  ) {
    super(message)
    this.name = 'TemplateUpgradeApiError'
  }
}

export async function getTemplateUpgradePlan(wsId: string): Promise<TemplateUpgradePlan> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/template-upgrade`)
  const body = await res.json().catch(() => ({})) as {
    plan?: TemplateUpgradePlan
    error?: string
    message?: string
  }
  if (!res.ok || !body.plan) {
    throw new TemplateUpgradeApiError(
      body.error ?? 'upgrade_plan_failed',
      body.message ?? `Template upgrade preview failed: HTTP ${res.status}`,
      res.status,
      body.plan,
    )
  }
  return body.plan
}

export async function applyTemplateUpgrade(
  wsId: string,
  planDigest: string,
  resolutions: Readonly<Record<string, TemplateUpgradeResolution>>,
): Promise<TemplateUpgradeResult> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(wsId)}/template-upgrade`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ planDigest, resolutions }),
  })
  const body = await res.json().catch(() => ({})) as {
    result?: TemplateUpgradeResult
    plan?: TemplateUpgradePlan
    error?: string
    message?: string
  }
  if (!res.ok || !body.result) {
    throw new TemplateUpgradeApiError(
      body.error ?? 'upgrade_apply_failed',
      body.message ?? `Template upgrade failed: HTTP ${res.status}`,
      res.status,
      body.plan,
    )
  }
  return body.result
}

export type WorkspaceAbsorbFileStatus = 'ready' | 'duplicate' | 'conflict'
export type WorkspaceAbsorbResolution = 'target' | 'source' | 'both'

export interface WorkspaceAbsorbFilePlan {
  readonly path: string
  readonly status: WorkspaceAbsorbFileStatus
  readonly operation: 'add' | 'skip' | 'choose'
  readonly sourcePreview: string | null
  readonly targetPreview: string | null
  readonly sourceTruncated: boolean
  readonly targetTruncated: boolean
  readonly sourceSize: number
  readonly targetSize: number | null
  readonly canUseSource: boolean
  readonly keepBothPath: string
}

export interface WorkspaceAbsorbPlan {
  readonly source: { readonly id: string; readonly tag: string; readonly displayName?: string }
  readonly target: { readonly id: string; readonly tag: string; readonly displayName?: string }
  readonly importRoot: string
  readonly planDigest: string
  readonly blocked: boolean
  readonly blockers: readonly string[]
  readonly activity: {
    readonly source: TemplateUpgradePlan['activity']
    readonly target: TemplateUpgradePlan['activity']
  }
  readonly sourceInventory: {
    readonly sessions: number
    readonly resumeIds: number
    readonly openIssues: readonly string[]
    readonly scheduledIssues: readonly string[]
    readonly dirtyFiles: number
  }
  readonly files: readonly WorkspaceAbsorbFilePlan[]
  readonly summary: {
    readonly ready: number
    readonly duplicates: number
    readonly conflicts: number
    readonly excluded: number
    readonly bytes: number
  }
}

export interface WorkspaceAbsorbResult {
  readonly sourceWorkspaceId: string
  readonly targetWorkspaceId: string
  readonly commit: string
  readonly changedPaths: readonly string[]
  readonly skippedPaths: readonly string[]
  readonly departedDir: string
}

export class WorkspaceAbsorbApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly plan?: WorkspaceAbsorbPlan,
  ) {
    super(message)
    this.name = 'WorkspaceAbsorbApiError'
  }
}

export async function getWorkspaceAbsorbPlan(
  targetWorkspaceId: string,
  sourceWorkspaceId: string,
): Promise<WorkspaceAbsorbPlan> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/absorb/${encodeURIComponent(sourceWorkspaceId)}`,
  )
  const body = await res.json().catch(() => ({})) as {
    plan?: WorkspaceAbsorbPlan
    error?: string
    message?: string
  }
  if (!res.ok || !body.plan) {
    throw new WorkspaceAbsorbApiError(
      body.error ?? 'absorb_plan_failed',
      body.message ?? `Workspace preview failed: HTTP ${res.status}`,
      res.status,
      body.plan,
    )
  }
  return body.plan
}

export async function applyWorkspaceAbsorb(
  targetWorkspaceId: string,
  sourceWorkspaceId: string,
  planDigest: string,
  resolutions: Readonly<Record<string, WorkspaceAbsorbResolution>>,
): Promise<WorkspaceAbsorbResult> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(targetWorkspaceId)}/absorb/${encodeURIComponent(sourceWorkspaceId)}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ planDigest, resolutions }),
    },
  )
  const body = await res.json().catch(() => ({})) as {
    result?: WorkspaceAbsorbResult
    plan?: WorkspaceAbsorbPlan
    error?: string
    message?: string
  }
  if (!res.ok || !body.result) {
    throw new WorkspaceAbsorbApiError(
      body.error ?? 'absorb_apply_failed',
      body.message ?? `Workspace absorb failed: HTTP ${res.status}`,
      res.status,
      body.plan,
    )
  }
  return body.result
}

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

export type AgentRuntimeReadinessStatus =
  | 'unknown'
  | 'checking'
  | 'ready'
  | 'not_installed'
  | 'auth_required'
  | 'provider_required'
  | 'output_unrecognized'
  | 'timeout'
  | 'failed';

export type AgentRuntimeReadinessSource =
  | 'global-login'
  | 'global-config'
  | 'launcher-vault'
  | 'workspace-override'
  | 'managed-runtime'
  | 'unknown';

export type AgentRuntimeRepairTarget =
  | 'runtime-install'
  | 'cli-login'
  | 'ai-provider'
  | 'retry';

export interface AgentRuntimeReadinessRow {
  readonly agent: string;
  readonly displayName: string;
  readonly installed: boolean;
  readonly binPath: string | null;
  readonly status: AgentRuntimeReadinessStatus;
  readonly ready: boolean;
  readonly source: AgentRuntimeReadinessSource;
  readonly checkedAt: string | null;
  readonly durationMs: number | null;
  readonly repairTarget?: AgentRuntimeRepairTarget;
  readonly message?: string;
}

export interface AgentRuntimeReadinessSnapshot {
  readonly agents: Record<string, AgentRuntimeReadinessRow>;
  readonly overallReady: boolean;
  readonly checkedAt: string | null;
}

export async function listAgents(): Promise<AgentInfo[]> {
  const res = await fetch('/api/workspaces/agents');
  if (!res.ok) throw new Error(`list agents failed: ${res.status}`);
  const body = (await res.json()) as { agents: AgentInfo[] };
  return body.agents;
}

export async function getAgentRuntimeReadiness(): Promise<AgentRuntimeReadinessSnapshot> {
  const res = await fetch('/api/agent-runtimes/readiness');
  if (!res.ok) throw new Error(`get agent runtime readiness failed: ${res.status}`);
  return (await res.json()) as AgentRuntimeReadinessSnapshot;
}

export async function probeAgentRuntimeReadiness(
  agent?: string,
  onSnapshot?: (snapshot: AgentRuntimeReadinessSnapshot) => void,
): Promise<AgentRuntimeReadinessSnapshot> {
  const res = await fetch('/api/agent-runtimes/readiness/probe', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(agent ? { agent } : {}),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`probe agent runtime readiness failed: ${res.status} ${msg}`);
  }
  const started = (await res.json()) as {
    probeId: string;
    agents: string[];
    snapshot: AgentRuntimeReadinessSnapshot;
  };
  let snapshot = started.snapshot;
  onSnapshot?.(snapshot);
  const targets = new Set(started.agents);
  const deadline = Date.now() + 100_000;
  while ([...targets].some((id) => snapshot.agents[id]?.status === 'checking')) {
    if (Date.now() >= deadline) {
      throw new Error(`agent runtime readiness probe ${started.probeId} did not settle`);
    }
    await new Promise((resolve) => window.setTimeout(resolve, 500));
    snapshot = await getAgentRuntimeReadiness();
    onSnapshot?.(snapshot);
  }
  return snapshot;
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

export async function getIssueDefaultAgent(): Promise<string | null> {
  const res = await fetch('/api/config/issue-default-agent');
  if (!res.ok) return null;
  const body = (await res.json()) as { agent?: string | null };
  return body.agent ?? null;
}

export async function setIssueDefaultAgent(agent: string | null): Promise<string | null> {
  const res = await fetch('/api/config/issue-default-agent', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ agent }),
  });
  if (!res.ok) {
    const msg = await res.text().catch(() => '');
    throw new Error(`set issue default agent failed: ${res.status} ${msg}`);
  }
  const body = (await res.json()) as { agent?: string | null };
  return body.agent ?? null;
}

// ── sessions ─────────────────────────────────────────────────────────────────
//
// V3.S4 — single SessionRecord type that covers both running PTYs and paused
// records. `pid` + `startedAt` are non-null only when `state === 'running'`.
// Persisted server-side at <OPENALICE_HOME>/workspaces/state/sessions/<wsId>.json
// so records survive PTY death and server restarts.

export interface SessionRecord {
  readonly id: string;
  readonly resumeId: string;
  readonly wsId: string;
  readonly agent: string;            // 'claude' | 'codex' | 'shell'
  readonly name: string;              // sticky 'c1' / 'x1' / 'sh1'
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly state: 'running' | 'paused';
  /** UI surface only; `agent` remains `pi` for WebPi. */
  readonly surface?: 'terminal' | 'webpi';
  readonly pid: number | null;
  readonly startedAt: number | null;
  /** First message (seeded sessions) — the sidebar title; null → fall back to `name`. */
  readonly title: string | null;
  /** Headless run this stable Alice Session was materialized from. */
  readonly sourceRunId?: string | null;
}

export interface SpawnedSession {
  readonly sessionId: string;
  readonly wsId: string;
  readonly name: string;
  readonly pid: number;
  readonly startedAt: number;
  readonly agent: string;
  readonly resumeId: string;
  readonly title: string | null;
}

export interface WebPiSnapshot {
  readonly recordId: string;
  readonly wsId: string;
  readonly resumeId: string;
  readonly pid: number | null;
  readonly startedAt: number;
  readonly phase: 'starting' | 'idle' | 'working' | 'compacting' | 'retrying' | 'stopped' | 'failed';
  readonly state: Record<string, unknown> | null;
  readonly messages: readonly unknown[];
  readonly streamingMessage: unknown | null;
  readonly error: string | null;
  readonly stderrTail: string;
  readonly revision: number;
}

export interface SpawnOptions {
  /** Product conversation identity; server resolves the native runtime id. */
  readonly resumeId?: string;
  /** Explicit runtime/tool adapter for this spawn. */
  readonly agent?: string;
  /**
   * Seed a FRESH session with a first user message — the quick-chat launch
   * ("type a message → you're in, agent already working"). Server-side it rides
   * the adapter's interactive `composeCommand`; ignored when `resume` is set.
   */
  readonly initialPrompt?: string;
  /** Concrete renderer theme at spawn time; gives TUIs an env hint. */
  readonly terminalTheme?: TerminalThemeVariant;
}

export interface WorkspaceSessionDirectoryEntry {
  readonly resumeId: string;
  readonly agent: string;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly resumable: boolean;
  readonly active: boolean;
  readonly latestExecution?: {
    readonly taskId: string;
    readonly status: 'running' | 'done' | 'failed' | 'interrupted';
    readonly startedAt: number;
    readonly issueId?: string;
    readonly assistantPreview?: string;
  };
  readonly interactive?: {
    readonly name: string;
    readonly title?: string;
    readonly state: 'running' | 'paused';
    readonly lastActiveAt: string;
  };
}

export interface WorkspaceSessionDirectory {
  readonly workspace: { readonly id: string; readonly tag: string };
  readonly sessions: readonly WorkspaceSessionDirectoryEntry[];
}

export async function getWorkspaceSessionDirectory(id: string): Promise<WorkspaceSessionDirectory> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/resumes`);
  if (!res.ok) throw new Error(`Failed to load Workspace Sessions (${res.status})`);
  return res.json() as Promise<WorkspaceSessionDirectory>;
}

export async function spawnSession(
  id: string,
  opts: SpawnOptions = {},
): Promise<SpawnedSession> {
  const body: Record<string, unknown> = {};
  if (opts.resumeId !== undefined) body['resumeId'] = opts.resumeId;
  if (opts.agent !== undefined) body['agent'] = opts.agent;
  if (opts.initialPrompt !== undefined) body['initialPrompt'] = opts.initialPrompt;
  if (opts.terminalTheme !== undefined) body['terminalTheme'] = opts.terminalTheme;
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

export interface OpenHeadlessSessionOptions {
  readonly title?: string;
}

export interface SessionSignatureIdentity {
  readonly signature: string;
  readonly resumeId: string;
  readonly workspaceId: string;
  readonly agent: string;
  readonly resumable: boolean;
}

export async function resolveSessionSignature(resumeId: string): Promise<SessionSignatureIdentity> {
  const res = await fetch(`/api/workspaces/signatures/${encodeURIComponent(resumeId)}`);
  if (!res.ok) throw new Error(res.status === 404 ? 'Session signature not found' : `signature lookup failed: ${res.status}`);
  return (await res.json()) as SessionSignatureIdentity;
}

export interface OpenHeadlessSessionResult {
  readonly session: SessionRecord;
  readonly created: boolean;
}

/** Idempotently materialize a finished headless run as one interactive Session. */
export async function openResumeSession(
  wsId: string,
  resumeId: string,
  opts: OpenHeadlessSessionOptions = {},
): Promise<OpenHeadlessSessionResult> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/resumes/${encodeURIComponent(resumeId)}/session`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(opts),
    },
  );
  if (!res.ok) {
    const parsed = (await res.json().catch(() => null)) as { error?: string; message?: string } | null;
    throw new Error(parsed?.message ?? parsed?.error ?? `open headless session failed: ${res.status}`);
  }
  return (await res.json()) as OpenHeadlessSessionResult;
}

/** Response of the quick-chat launch: the (reused-or-created) chat workspace + the seeded session. */
export interface QuickChatResult {
  readonly workspace: Workspace;
  readonly session: SpawnedSession;
}

export const MANAGER_WORKSPACE_ID = 'workspace-manager'

export interface ManagerWorkspaceSnapshot {
  readonly id: typeof MANAGER_WORKSPACE_ID
  readonly tag: string
  readonly activeWorkspaceCount: number
  readonly sessions: readonly SessionRecord[]
}

export interface ManagerQuickStartResult {
  readonly manager: ManagerWorkspaceSnapshot
  readonly session: SessionRecord
  readonly snapshot: WebPiSnapshot
}

export async function getWorkspaceManager(): Promise<ManagerWorkspaceSnapshot> {
  const res = await fetch('/api/workspaces/manager')
  const body = (await res.json().catch(() => null)) as { manager?: ManagerWorkspaceSnapshot; message?: string } | null
  if (!res.ok || !body?.manager) throw new Error(body?.message ?? `manager load failed: ${res.status}`)
  return body.manager
}

export async function quickStartWorkspaceManager(
  prompt: string,
  credentialSlug?: string,
): Promise<ManagerQuickStartResult> {
  const res = await fetch('/api/workspaces/manager/quick-start', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ prompt, ...(credentialSlug ? { credentialSlug } : {}) }),
  })
  const body = (await res.json().catch(() => null)) as (ManagerQuickStartResult & { message?: string; error?: string }) | null
  if (!res.ok || !body?.manager || !body.session || !body.snapshot) {
    throw new Error(body?.message ?? body?.error ?? `manager start failed: ${res.status}`)
  }
  return body
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
  terminalTheme?: TerminalThemeVariant,
): Promise<QuickChatResult> {
  const body: Record<string, unknown> = { prompt };
  if (agent !== undefined) body['agent'] = agent;
  if (credentialSlug !== undefined) body['credentialSlug'] = credentialSlug;
  if (targetWsId !== undefined) body['targetWsId'] = targetWsId;
  if (terminalTheme !== undefined) body['terminalTheme'] = terminalTheme;
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
export async function resumeSession(
  wsId: string,
  sessionId: string,
  terminalTheme?: TerminalThemeVariant,
): Promise<SpawnedSession | null> {
  const body: Record<string, unknown> = {};
  if (terminalTheme !== undefined) body['terminalTheme'] = terminalTheme;
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/resume`,
    {
      method: 'POST',
      ...(Object.keys(body).length > 0
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }
        : {}),
    },
  );
  if (!res.ok) return null;
  return (await res.json()) as SpawnedSession;
}

export async function openWebPiSession(wsId: string, sessionId: string): Promise<WebPiSnapshot> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/webpi/open`,
    { method: 'POST' },
  );
  const body = (await res.json().catch(() => null)) as { snapshot?: WebPiSnapshot; message?: string } | null;
  if (!res.ok || !body?.snapshot) throw new Error(body?.message ?? `WebPi open failed: ${res.status}`);
  return body.snapshot;
}

export async function getWebPiSession(
  wsId: string,
  sessionId: string,
  revision?: number,
): Promise<WebPiSnapshot | null> {
  const query = revision === undefined ? '' : `?revision=${encodeURIComponent(String(revision))}`;
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/webpi${query}`,
  );
  const body = (await res.json().catch(() => null)) as {
    snapshot?: WebPiSnapshot;
    unchanged?: boolean;
    message?: string;
  } | null;
  if (!res.ok) throw new Error(body?.message ?? `WebPi read failed: ${res.status}`);
  if (body?.unchanged) return null;
  if (!body?.snapshot) throw new Error('WebPi response has no snapshot');
  return body.snapshot;
}

export async function promptWebPiSession(
  wsId: string,
  sessionId: string,
  message: string,
): Promise<WebPiSnapshot> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/webpi/prompt`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
    },
  );
  const body = (await res.json().catch(() => null)) as { snapshot?: WebPiSnapshot; message?: string } | null;
  if (!res.ok || !body?.snapshot) throw new Error(body?.message ?? `WebPi prompt failed: ${res.status}`);
  return body.snapshot;
}

export async function abortWebPiSession(wsId: string, sessionId: string): Promise<WebPiSnapshot> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/sessions/${encodeURIComponent(sessionId)}/webpi/abort`,
    { method: 'POST' },
  );
  const body = (await res.json().catch(() => null)) as { snapshot?: WebPiSnapshot; message?: string } | null;
  if (!res.ok || !body?.snapshot) throw new Error(body?.message ?? `WebPi abort failed: ${res.status}`);
  return body.snapshot;
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
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `offboard failed: ${res.status}`)
  }
  return res.ok;
}

export interface WorkspaceOffboardingAssessment {
  readonly workspace: { readonly id: string; readonly tag: string; readonly dir: string }
  readonly canOffboard: boolean
  readonly blockers: readonly string[]
  readonly runningHeadless: readonly { readonly taskId: string; readonly resumeId: string; readonly agent: string }[]
  readonly untrackedHeadlessActive: boolean
  readonly runningSessions: number
  readonly sessionRecords: number
  readonly resumeIds: readonly string[]
  readonly openIssueIds: readonly string[]
  readonly scheduledIssueIds: readonly string[]
  readonly git: GitStatus | null
}

export async function getWorkspaceOffboardingAssessment(id: string): Promise<WorkspaceOffboardingAssessment> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/offboarding`)
  if (!res.ok) throw new Error(`offboarding assessment failed: ${res.status}`)
  return ((await res.json()) as { assessment: WorkspaceOffboardingAssessment }).assessment
}

export async function offboardWorkspace(
  id: string,
  input: { reason: string; notes?: string },
): Promise<void> {
  const res = await fetch(`/api/workspaces/${encodeURIComponent(id)}/offboard`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `offboard failed: ${res.status}`)
  }
}

export type WorkspaceLifecycleState =
  | 'active'
  | 'offboarding'
  | 'departed'
  | 'restoring'
  | 'purging'
  | 'purged'

export interface DepartedWorkspace {
  readonly id: string
  readonly tag: string
  readonly activeDir: string
  readonly departedDir?: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly departedAt?: string
  readonly purgedAt?: string
  readonly lifecycle: WorkspaceLifecycleState
  readonly reason?: string
  readonly absorbedIntoWorkspaceId?: string
  readonly absorbedAt?: string
  readonly absorbCommit?: string
  readonly legacyImported?: boolean
  readonly handoff?: {
    readonly preparedAt: string
    readonly notes?: string
    readonly dirtyFiles: readonly string[]
    readonly openIssueIds: readonly string[]
    readonly scheduledIssueIds: readonly string[]
    readonly resumeIds: readonly string[]
    readonly successors?: Readonly<Record<string, string>>
    readonly sessionRecords: number
  }
}

export async function listDepartedWorkspaces(): Promise<DepartedWorkspace[]> {
  const res = await fetch('/api/workspaces/departed')
  if (!res.ok) throw new Error(`list departed workspaces failed: ${res.status}`)
  return ((await res.json()) as { workspaces: DepartedWorkspace[] }).workspaces
}

export async function restoreWorkspace(id: string): Promise<void> {
  const res = await fetch(`/api/workspaces/departed/${encodeURIComponent(id)}/restore`, { method: 'POST' })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `restore failed: ${res.status}`)
  }
}

export async function purgeDepartedWorkspace(id: string): Promise<void> {
  const res = await fetch(`/api/workspaces/departed/${encodeURIComponent(id)}`, { method: 'DELETE' })
  if (!res.ok) {
    const body = await res.json().catch(() => null) as { message?: string } | null
    throw new Error(body?.message ?? `purge failed: ${res.status}`)
  }
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
  /** Header mode whenever wireShape is Anthropic Messages. */
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
  /** Model injection resolves right now (lastModel, then the vendor default). */
  readonly resolvedModel?: string;
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
export interface WorkspaceCredentialDetection {
  readonly slug: string | null;
  readonly model: string | null;
  readonly contextWindow: number | null;
  readonly wireShape: WireShape | null;
}

export async function detectWorkspaceCredential(
  wsId: string,
  agent: string,
): Promise<WorkspaceCredentialDetection> {
  const res = await fetch(
    `/api/workspaces/${encodeURIComponent(wsId)}/agent-config/${encodeURIComponent(agent)}/credential`,
  );
  if (!res.ok) return { slug: null, model: null, contextWindow: null, wireShape: null };
  return (await res.json()) as WorkspaceCredentialDetection;
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
