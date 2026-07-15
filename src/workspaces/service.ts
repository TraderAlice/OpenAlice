/**
 * Composition root for the Workspaces feature.
 *
 * Wraps the launcher's domain modules (registry, pool, creator, template-
 * registry, adapters, transcript-watcher, scrollback-store) into a single
 * `WorkspaceService` consumed by the HTTP routes and WS upgrade handler.
 *
 * Lifecycle: `createWorkspaceService()` at plugin start; `dispose()` at stop.
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { basename, join } from 'node:path';

import { cliBinPath } from '@/core/paths.js';
import { readCredentials, readIssueDefaultAgent, readWorkspaceDefaultAgent } from '@/core/config.js';
import { ArtifactProvenanceStore } from '@/core/provenance-store.js';
import {
  readQuickChatPreferences,
  rememberRecentChatWorkspace,
} from '@/core/preferences.js';

import { claudeAdapter } from './adapters/claude.js';
import { codexAdapter } from './adapters/codex.js';
import { opencodeAdapter } from './adapters/opencode.js';
import { piAdapter } from './adapters/pi.js';
import { shellAdapter } from './adapters/shell.js';
import { AdapterRegistry, isAgentRuntime, type CliAdapter } from './cli-adapter.js';
import { loadConfig, type ServerConfig } from './config.js';
import { ensureAgentCredentialReady } from './agent-credential-readiness.js';
import { logger as launcherLogger } from './logger.js';
import { runHeadlessProbe, type HeadlessProbeResult } from './probe.js';
import { headlessTaskStatus, runHeadlessTask, type HeadlessTaskResult } from './headless-task.js';
import {
  checkingRuntimeReadinessRow,
  failedRuntimeReadinessRow,
  initialRuntimeReadinessRow,
  notInstalledRuntimeReadinessRow,
  readyRuntimeReadinessRow,
  runtimeProbeSucceeded,
  snapshotRuntimeReadiness,
  RUNTIME_READINESS_PROMPT,
  RUNTIME_READINESS_TIMEOUT_MS,
  type AgentRuntimeReadinessRow,
  type AgentRuntimeReadinessSnapshot,
  type AgentRuntimeReadinessSource,
} from './agent-runtime-readiness.js';
import { ScheduleMarkerStore } from './schedule/marker-store.js';
import {
  ScheduleScanner,
  ScheduledIssueRunNowError,
  DEFAULT_INTERVAL_MS,
} from './schedule/scanner.js';
import {
  readWorkspaceIssues,
  snapshotScheduledIssue,
  type ScheduleSnapshot,
  type ScheduleSnapshotTask,
  type ScheduleSnapshotWorkspace,
} from './schedule/declaration.js';
import {
  annotateNameCollisions,
  detailIssue,
  inboxReportsForIssue,
  issueActivityRecords,
  issueProvenanceRecords,
  snapshotBoardIssue,
  type IssueDetail,
  issueRunRecord,
  type IssueFiringMarkers,
  type IssuesSnapshot,
  type IssuesSnapshotIssue,
  type IssuesSnapshotWorkspace,
  type WikilinkIssueRef,
} from './issues/board.js';
import {
  buildWorkspaceSessionDirectory,
  type WorkspaceSessionDirectory,
} from './session-directory.js';
import { completeOneShotIssueAfterRun } from './issues/auto-complete.js';
import { readIssueComments } from './issues/comments.js';
import { recordIssueCommentReply } from './issues/comment-delivery.js';
import {
  issueAutomationHealth,
  type IssueAutomationOwnerState,
} from './issues/automation-health.js';
import { issueAssigneeResumeId } from './issues/declaration.js';
import { issueRunFailure } from './issues/run-failure.js';
import type { IInboxStore } from '@/core/inbox-store.js';
import { toSafeInboxOrigin } from '@/core/workspace-tool-center.js';
import {
  HeadlessTaskRegistry,
  headlessLogPaths,
  type HeadlessTaskInquiry,
  type HeadlessTaskRecord,
  type HeadlessTaskStatus,
  type HeadlessTaskTrigger,
} from './headless-task-registry.js';
import { ResumeRegistry } from './resume-registry.js';
import {
  compatibleCredentials,
  credentialToWorkspaceAiCred,
  resolveInjectionModel,
} from './credential-injection.js';
import {
  ChatWorkspaceResolver,
  type ChatWorkspaceResolution,
} from './chat-workspace-resolver.js';

/** Resolve only the operational facts automation health needs. Product APIs do
 * not expose the runtime-native session id itself. */
function automationOwnerState(assignee: string, resumes: ResumeRegistry): IssueAutomationOwnerState {
  const resumeId = issueAssigneeResumeId(assignee);
  if (!resumeId) return 'workspace';
  const identity = resumes.get(resumeId);
  if (!identity) return 'missing';
  if (identity.lifecycle === 'retired') return 'retired';
  return identity.agentSessionId ? 'ready' : 'unbound';
}

function automationLatestRun(task: HeadlessTaskRecord) {
  const failure = issueRunFailure(task);
  return {
    taskId: task.taskId,
    status: task.status,
    ...(failure ? { failure } : {}),
  };
}

/** Max concurrent in-flight headless tasks — backstop against unbounded spawn. */
const MAX_CONCURRENT_HEADLESS = 8;

/** Thrown by `dispatchHeadlessTask` when the concurrency cap is hit (→ HTTP 429). */
export class HeadlessCapacityError extends Error {
  constructor(public readonly limit: number) {
    super(`headless capacity reached (${limit} tasks running)`);
    this.name = 'HeadlessCapacityError';
  }
}

export class HeadlessResumeError extends Error {
  constructor(
    public readonly code: 'not_found' | 'wrong_workspace' | 'wrong_agent' | 'not_ready' | 'retired' | 'busy',
    message: string,
  ) {
    super(message);
    this.name = 'HeadlessResumeError';
  }
}

export class IssueRetryError extends Error {
  constructor(
    public readonly code:
      | 'not_found'
      | 'not_scheduled'
      | 'not_fireable'
      | 'not_retryable'
      | 'already_running',
    message: string,
  ) {
    super(message);
    this.name = 'IssueRetryError';
  }
}
import { ScrollbackStore } from './scrollback-store.js';
import { SessionPool, type SessionFactoryContext } from './session-pool.js';
import { SessionRegistry, type SessionRecord } from './session-registry.js';
import { buildCliPath, buildSpawnEnv } from './spawn-env.js';
import { terminalThemeEnv } from './terminal-theme.js';
import { TemplateRegistry } from './template-registry.js';
import { TemplateUpgradeManager } from './template-upgrade.js';
import { WorkspaceOperationGuard } from './workspace-operation-guard.js';
import { readWorkspaceMetadata } from './workspace-metadata.js';
import { TranscriptWatcher } from './transcript-watcher.js';
import { detectAgentBinary, runtimeInstallOverride, type AgentAvailability } from './agent-detect.js';
import { resolveLaunchCommand } from './win-command.js';
import { WorkspaceCreator } from './workspace-creator.js';
import { WorkspaceCatalog } from './workspace-catalog.js';
import { WorkspaceAbsorbManager } from './workspace-absorb.js';
import { WorkspaceLifecycleManager } from './workspace-lifecycle.js';
import {
  WorkspaceHeadlessActivityTracker,
  type WorkspaceRuntimeActivity,
} from './workspace-runtime-activity.js';
import { WebPiSessionHost, type WebPiSnapshot } from './webpi-session-host.js';
import { WorkspaceRegistry, type WorkspaceMeta } from './workspace-registry.js';

/**
 * The fully-resolved spawn plan for a (workspace, adapter, resume-intent)
 * triple. Computed by the same code path the pool's factory uses, so a
 * dry-run snapshot (diagnostics endpoint) and a live spawn agree on every
 * field — including the path-related ones that this whole debugging
 * scaffold exists to compare.
 */
export interface SpawnPlan {
  readonly resumeMode: 'fresh' | 'last' | 'by-id';
  /** Adapter-native id used only for backend diagnostics. */
  readonly nativeSessionId: string | null;
  readonly composedCommand: readonly string[];
  readonly spawnCwd: string;
  readonly envPWD: string | null;
  readonly transcriptDir: string | null;
  readonly projectKey: string | null;
}

export interface WorkspaceService {
  readonly config: ServerConfig;
  readonly registry: WorkspaceRegistry;
  readonly catalog: WorkspaceCatalog;
  readonly lifecycle: WorkspaceLifecycleManager;
  readonly templateUpgrades: TemplateUpgradeManager;
  readonly workspaceAbsorbs: WorkspaceAbsorbManager;
  /** Coordinates runtime starts with directory-wide lifecycle operations. */
  readonly operationGuard: WorkspaceOperationGuard;
  readonly sessionRegistry: SessionRegistry;
  readonly scrollbackStore: ScrollbackStore;
  readonly templates: TemplateRegistry;
  readonly adapters: AdapterRegistry;
  readonly creator: WorkspaceCreator;
  readonly pool: SessionPool;
  readonly webPi: WebPiSessionHost;
  readonly transcriptWatcher: TranscriptWatcher;
  /** Process-backed activity used by Upgrade, Offboarding, and Absorb guards. */
  workspaceRuntimeActivity(workspaceId: string): WorkspaceRuntimeActivity;
  /** Resolve the preferred/recent durable Chat Workspace, creating one starter when absent. */
  resolveOrCreateChatWorkspace(preferredWorkspaceId?: string | null): Promise<ChatWorkspaceResolution>;
  /** Resolve the configured Workspace runtime, then fall back to its first enabled runtime. */
  resolveDefaultAgentId(meta: WorkspaceMeta): Promise<string | undefined>;
  resolveAdapter(meta: WorkspaceMeta, agentId?: string): CliAdapter;
  /** Open the same persisted Pi Session through Pi RPC instead of its PTY. */
  startWebPiSession(meta: WorkspaceMeta, record: SessionRecord): Promise<WebPiSnapshot>;
  publicMeta(w: WorkspaceMeta): Promise<unknown>;
  /**
   * Probe the host PATH for each registered adapter's CLI binary. Keyed by
   * adapter id. Adapters without a `binary` (shell) report installed:true.
   * A pure filesystem lookup — cheap enough for the `/agents` list call, and
   * re-run each time so a CLI installed mid-session is picked up on the next
   * poll.
   */
  detectAgents(): Record<string, AgentAvailability>;
  /**
   * Compute what a spawn would do, without actually spawning. The same code
   * path the pool's factory uses internally — dry-run and live can't drift.
   */
  computeSpawnPlan(
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
  ): SpawnPlan;
  /**
   * Spawn an off-the-record PTY against the workspace, append a positional
   * prompt to the adapter's command, kill on timeout, return PTY-output-tail
   * + transcript-dir jsonl delta. Independent of the pool — never updates
   * the SessionRegistry, never registers with the transcript watcher, never
   * affects state visible to other clients. Pure observation tool.
   */
  runHeadlessProbe(
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
    prompt: string,
    timeoutMs: number,
  ): Promise<HeadlessProbeResult>;
  /**
   * Dispatch a one-shot HEADLESS task: spawn the adapter's
   * `composeHeadlessCommand` (prompt placed) on a plain pipe, run to natural
   * exit (= done), return exit/duration + normalized reply/tool blocks and
   * bounded diagnostic tails. Reuses the spawn env/cwd of a fresh interactive
   * spawn (same CLI injection), but is NOT pooled (one-shot, no respawn).
   * Throws if the adapter has no headless mode.
   */
  runHeadlessTask(
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
  ): Promise<HeadlessTaskResult>;
  /** Cached install/ready snapshot for global first-run runtime gating. */
  getAgentRuntimeReadiness(): AgentRuntimeReadinessSnapshot;
  /**
   * Start readiness probes without holding an HTTP/IPC request open. Repeated
   * starts for the same runtime share the in-flight probe; callers observe
   * progress through `getAgentRuntimeReadiness()`.
   */
  beginAgentRuntimeReadinessProbe(agentId?: string): {
    readonly agents: readonly string[];
    readonly snapshot: AgentRuntimeReadinessSnapshot;
  };
  /**
   * Run real headless readiness probes for one or all agent runtimes in the
   * durable Chat Workspace that also carries onboarding and later Quick Chat.
   */
  probeAgentRuntimeReadiness(agentId?: string): Promise<AgentRuntimeReadinessSnapshot>;
  /**
   * ASYNC dispatch — records the task, spawns it in the background, returns the
   * taskId immediately (the automation path). Throws `HeadlessCapacityError`
   * when the concurrency cap is hit.
   */
  dispatchHeadlessTask(
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
    /** Business source of the dispatch. Its Workspace may differ from `meta`
     * when an Issue explicitly resumes a signed Session across Workspaces. */
    trigger?: HeadlessTaskTrigger,
    /** Continue this OpenAlice-owned conversation. Native runtime ids are
     * resolved only inside the service. */
    resumeId?: string,
    /** Optional Inbox/Issue reverse link for a user-initiated inquiry. */
    inquiry?: HeadlessTaskInquiry,
  ): Promise<{ taskId: string; resumeId: string }>;
  /** Read-only scheduling projection of every workspace's `.alice/issues/`
   *  directory (scheduled issues only) + each task's last-fired marker and
   *  computed next-due. Powers GET /api/schedule. */
  scheduleSnapshot(): Promise<ScheduleSnapshot>;
  /** Read-only snapshot of every workspace's `.alice/issues/` directory — ALL
   *  issues (scheduled or not), scheduled ones enriched with firing markers.
   *  Powers the global Issue board GET /api/issues. */
  issuesSnapshot(): Promise<IssuesSnapshot>;
  /** Read-only DETAIL for one issue (markdown body + firing markers + its
   *  headless run history, newest first). `null` when the workspace or the issue
   *  id is absent. Powers GET /api/issues/:wsId/:id. */
  issueDetail(wsId: string, id: string): Promise<IssueDetail | null>;
  /** Retry the latest unsuccessful scheduled execution now. Reuses the live
   * Issue prompt/owner/runtime and never advances its schedule marker. */
  retryIssue(wsId: string, id: string): Promise<IssueDetail>;
  /** Safe Workspace Session index. resumeId is the only public conversation handle. */
  sessionDirectory(wsId: string, limit?: number): Promise<WorkspaceSessionDirectory | null>;
  /** Resolve a `[[name]]` token to the issues across ALL workspaces that claim it.
   *  Matches case-insensitively against an issue's `id` OR its `title` (either is a
   *  valid name handle). Returns every match — 0, 1, or many (a collision the UI
   *  disambiguates by wsId). Powers GET /api/wikilink/resolve. */
  resolveIssuesByName(name: string): Promise<WikilinkIssueRef[]>;
  /** The headless-task management plane (cross-workspace; powers GET /api/headless). */
  headlessTasks: HeadlessTaskRegistry;
  /** Backend-only product resumeId → native runtime session-id mapping. */
  resumeRegistry: ResumeRegistry;
  /** Durable product Session -> business artifact attribution index. */
  provenanceStore: ArtifactProvenanceStore;
  /** True while a headless turn owns this conversation transcript. */
  isResumeActive(resumeId: string): boolean;
  /** Atomically reserve a conversation before crossing an async spawn boundary. */
  claimResume(resumeId: string): boolean;
  releaseResume(resumeId: string): void;
  /** Global in-flight capacity exposed to the Automation control plane. */
  headlessCapacity: number;
  /** Where dispatched tasks' full stdout/stderr logs land (read by the output route). */
  headlessLogsDir: string;
  isShuttingDown(): boolean;
  dispose(reason: string): Promise<void>;
}

export interface CreateWorkspaceServiceOptions {
  /** Backend's bound web port — used to derive the CORS allowlist. */
  readonly webPort: number;
  /** Legacy MCP/local-tool port retained for callers that still print it. */
  readonly mcpPort: number;
  /** Base URL used by the injected `alice*` CLI shims, usually `/cli`. */
  readonly toolBaseUrl: string;
  /** Optional Unix socket / named pipe used by `alice*` in Electron app mode. */
  readonly toolSocketPath?: string;
  /** Optional MCP protocol URL. Absent when MCP is disabled. */
  readonly mcpBaseUrl?: string;
  /** The global inbox store, so `issueDetail` can join the inbox reports an
   *  issue produced (entries stamped `origin.issueId`) in the domain layer —
   *  every surface (HTTP / CLI / MCP) gets the join, not just the route.
   *  Optional: when absent, `issueDetail` returns `inboxReports: []`. */
  readonly inboxStore?: IInboxStore;
}

/**
 * Pick a resume intent from a persisted record + the adapter's capabilities.
 * Mirrors the logic the resume route used to inline (now consumed by both
 * the resume route and the diagnostics endpoint).
 */
export function resumeFromRecord(
  record: SessionRecord,
  adapter: CliAdapter,
): SessionFactoryContext['resume'] {
  if (record.resumeHint && adapter.capabilities.resumeById) {
    return { sessionId: record.resumeHint.value };
  }
  if (adapter.capabilities.resumeLast) return 'last';
  return undefined;
}

export async function createWorkspaceService(opts: CreateWorkspaceServiceOptions): Promise<WorkspaceService> {
  const config = loadConfig({ webPort: opts.webPort });
  const inboxStore = opts.inboxStore;
  const registry = await WorkspaceRegistry.load(
    `${config.launcherRoot}/workspaces.json`,
    launcherLogger.child({ scope: 'registry' }),
  );
  const catalog = await WorkspaceCatalog.load(
    join(config.launcherRoot, 'state', 'workspace-catalog.json'),
    registry.list(),
    launcherLogger.child({ scope: 'workspace-catalog' }),
  );

  const sessionRegistry = await SessionRegistry.load(
    join(config.launcherRoot, 'state'),
    launcherLogger.child({ scope: 'session-registry' }),
  );

  // The headless-task management plane. load() reconciles leftover `running`
  // records (zombies from a previous Alice life) → `interrupted`. Each task's
  // full stdout/stderr lands in `headlessLogsDir` and is retained with history.
  const headlessLogsDir = join(config.launcherRoot, 'state', 'headless-logs');
  const headlessTasks = await HeadlessTaskRegistry.load(
    join(config.launcherRoot, 'state', 'headless-tasks.json'),
    launcherLogger.child({ scope: 'headless-registry' }),
  );
  const resumeRegistry = await ResumeRegistry.load(
    join(config.launcherRoot, 'state', 'resume-identities.json'),
    launcherLogger.child({ scope: 'resume-registry' }),
  );
  const provenanceStore = await ArtifactProvenanceStore.load(
    join(config.launcherRoot, 'state', 'artifact-provenance.json'),
    launcherLogger.child({ scope: 'provenance-store' }),
  );
  const activeResumeIds = new Set<string>();
  const claimResume = (resumeId: string): boolean => {
    if (activeResumeIds.has(resumeId)) return false;
    activeResumeIds.add(resumeId);
    return true;
  };

  /**
   * Automatic Issue-comment delivery ends by recording the owner's final
   * answer as another durable comment. The source comment retains the delivery
   * state, so a refresh never confuses "dispatched" with "replied".
   */
  const completeIssueCommentInquiry = async (input: {
    task: HeadlessTaskRecord;
    status: HeadlessTaskStatus;
    assistantText?: string | null;
    error?: string;
  }): Promise<void> => {
    const subject = input.task.inquiry?.subject;
    if (subject?.kind !== 'issue' || !subject.commentId) return;
    const issueWorkspace = registry.get(subject.workspaceId);
    if (!issueWorkspace) {
      launcherLogger.warn('issue.comment_reply_workspace_missing', {
        taskId: input.task.taskId,
        wsId: subject.workspaceId,
        issueId: subject.issueId,
      });
      return;
    }

    try {
      await recordIssueCommentReply({
        issueWorkspaceId: subject.workspaceId,
        issueWorkspaceDir: issueWorkspace.dir,
        issueId: subject.issueId,
        sourceCommentId: subject.commentId,
        task: input.task,
        status: input.status,
        provenanceStore,
        ...(input.assistantText !== undefined ? { assistantText: input.assistantText } : {}),
        ...(input.error ? { error: input.error } : {}),
      });
    } catch (err) {
      launcherLogger.warn('issue.comment_reply_record_failed', {
        taskId: input.task.taskId,
        wsId: subject.workspaceId,
        issueId: subject.issueId,
        commentId: subject.commentId,
        err,
      });
    }
  };

  const scrollbackStore = new ScrollbackStore(
    join(config.launcherRoot, 'state'),
    launcherLogger.child({ scope: 'scrollback' }),
  );

  const templates = await TemplateRegistry.load(
    config.templatesDir,
    launcherLogger.child({ scope: 'templates' }),
  );
  if (config.legacyBootstrapScript) {
    launcherLogger.warn('config.legacy_bootstrap_script', {
      script: config.legacyBootstrapScript,
    });
    templates.registerSynthetic({
      name: 'legacy',
      description: 'legacy AQ_BOOTSTRAP_SCRIPT entry — migrate to a real template',
      bootstrapScript: config.legacyBootstrapScript,
      filesDir: '',
      templateDir: '',
      version: '0.0.0',
      defaultAgents: ['claude'],
      injectTools: false,
      injectPersona: false,
      bundledSkills: [],
    });
  }

  const adapters = new AdapterRegistry();
  adapters.register(claudeAdapter, { default: true });
  adapters.register(codexAdapter);
  adapters.register(opencodeAdapter);
  adapters.register(piAdapter);
  adapters.register(shellAdapter);
  const runtimeReadinessCache = new Map<string, AgentRuntimeReadinessRow>();

  const creator = new WorkspaceCreator({
    workspacesRoot: `${config.launcherRoot}/workspaces`,
    templateRegistry: templates,
    adapterRegistry: adapters,
    bootstrapEnv: {
      templateDir: config.templateDir,
      launcherRepoRoot: config.launcherRepoRoot,
    },
    bootstrapTimeoutMs: config.bootstrapTimeoutMs,
    registry,
    isWorkspaceIdReserved: (id) => catalog.hasId(id),
    onWorkspaceCreated: (workspace) => catalog.recordCreated(workspace),
    logger: launcherLogger.child({ scope: 'creator' }),
  });
  const chatWorkspaceResolver = new ChatWorkspaceResolver({
    registry,
    sessionRegistry,
    creator,
  });

  const transcriptWatcher = new TranscriptWatcher(
    launcherLogger.child({ scope: 'transcript-watch' }),
    sessionRegistry,
    (wsId, recordId, agentSessionId) => {
      const record = sessionRegistry.get(wsId, recordId);
      if (!record) return;
      void resumeRegistry.bindAgentSessionId(record.resumeId, agentSessionId).catch((err) =>
        launcherLogger.warn('resume_registry.native_id_bind_failed', {
          wsId, recordId, resumeId: record.resumeId, err,
        }),
      );
    },
  );

  const resolveAdapter = (wsMeta: WorkspaceMeta, agentId?: string): CliAdapter => {
    if (agentId) {
      const a = adapters.get(agentId);
      if (a) return a;
    }
    const fromWorkspace = wsMeta.agents.find((id) => {
      const a = adapters.get(id);
      return a ? isAgentRuntime(a) : false;
    });
    if (fromWorkspace) {
      const a = adapters.get(fromWorkspace);
      if (a) return a;
    }
    return adapters.resolve(null);
  };

  const firstWorkspaceRuntime = (wsMeta: WorkspaceMeta): string | undefined =>
    wsMeta.agents.find((id) => {
      const adapter = adapters.get(id);
      return adapter ? isAgentRuntime(adapter) : false;
    });

  const validRuntimeForWorkspace = (wsMeta: WorkspaceMeta, agentId: string | null): string | undefined => {
    if (!agentId || !wsMeta.agents.includes(agentId)) return undefined;
    const adapter = adapters.get(agentId);
    return adapter && isAgentRuntime(adapter) ? agentId : undefined;
  };

  /**
   * Default for scheduled issues with no frontmatter `agent`: issue-specific
   * setting first, then the interactive workspace default for backwards
   * continuity, then the workspace's first enabled runtime.
   */
  const resolveDefaultAgentId = async (wsMeta: WorkspaceMeta): Promise<string | undefined> =>
    validRuntimeForWorkspace(wsMeta, await readWorkspaceDefaultAgent().catch(() => null)) ??
    firstWorkspaceRuntime(wsMeta);

  const resolveIssueDefaultAgentId = async (wsMeta: WorkspaceMeta): Promise<string | undefined> =>
    validRuntimeForWorkspace(wsMeta, await readIssueDefaultAgent().catch(() => null)) ??
    await resolveDefaultAgentId(wsMeta);

  /**
   * Single source of truth for "given a workspace + adapter + resume intent,
   * what argv / cwd / env / transcriptDir would a spawn use?" Consumed by:
   *   - the pool's factory (live PTY spawn)
   *   - `computeSpawnPlan` (public-facing dry-run for diagnostics)
   *   - the headless probe (offline spawn that appends a positional prompt)
   *
   * Keeps the three call sites byte-identical on every env / command field.
   */
  const composeSpawnInputs = (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
    initialPrompt?: string,
    // Per-spawn env on TOP of the shared base — the identity-injection seam.
    // Two MUTUALLY-EXCLUSIVE uses (a spawn carries AQ_RUN_ID XOR AQ_SESSION_ID):
    //   - the headless path injects AQ_RUN_ID (the run's taskId);
    //   - the interactive POOL factory injects AQ_SESSION_ID (the pre-allocated
    //     SessionRegistry record id).
    // Deliberately a param, NOT folded into baseEnv: the probe spawn must carry
    // NEITHER, and the two live spawns each carry exactly one. Merging it before
    // adapter.composeEnv() lets an MCP-config adapter (opencode) read it and emit
    // the matching out-of-band header.
    extraEnv?: Record<string, string>,
  ): {
    command: readonly string[];
    cwd: string;
    env: Record<string, string>;
    transcriptDir: string | null;
  } => {
    const baseEnv = buildSpawnEnv(process.env, {
      AQ_WS_ID: ws.id,
      AQ_LAUNCHER_REPO_ROOT: config.launcherRepoRoot,
      // Local tool gateway for the injected `alice*` CLI shims. Electron/dev
      // can point this at the web listener's `/cli`; Docker/public-web can keep
      // it on a separate loopback-only port. This is the default agent tool
      // path and does not require MCP to be enabled.
      OPENALICE_TOOL_URL: opts.toolBaseUrl,
      ...(opts.toolSocketPath ? { OPENALICE_TOOL_SOCKET: opts.toolSocketPath } : {}),
      ...(opts.mcpBaseUrl ? { OPENALICE_MCP_URL: opts.mcpBaseUrl } : {}),
      // Prepend the `alice` CLI shim dir so the workspace agent can invoke it
      // from its shell (it reads OPENALICE_TOOL_URL + AQ_WS_ID above). Shared
      // script — not written into the workspace, so it never pollutes the
      // workspace's git repo.
      OPENALICE_WORKSPACE_CLI_BIN_PATH: cliBinPath(),
      // Per-workspace git identity — so any commit the agent makes (in its own
      // repo OR a peer's, during cross-workspace collaboration) self-attributes
      // to this workspace, and never fails for a missing identity on a clean
      // box. This rides the PTY session env only; the launcher's own
      // `commitInitial` (-c user.name=launcher) runs in the launcher's
      // process.env, which we don't touch, so the initial commit stays
      // `launcher`. Set explicitly here so a host ~/.gitconfig identity leaking
      // through `process.env` can't shadow the workspace one (extras win).
      GIT_AUTHOR_NAME: ws.tag,
      GIT_AUTHOR_EMAIL: `${ws.id}@workspace.local`,
      GIT_COMMITTER_NAME: ws.tag,
      GIT_COMMITTER_EMAIL: `${ws.id}@workspace.local`,
      // Headless-only run identity (see extraEnv above). Merged here so it's
      // visible to adapter.composeEnv() below (opencode's inline MCP config) and
      // to the spawned process's env (the `alice` shim reads it).
      ...(extraEnv ?? {}),
    }, ws.dir);
    const baseCtx = {
      ...(resume !== undefined ? { resume } : {}),
      cwd: ws.dir,
      env: baseEnv,
    };
    // Adapter-contributed env (e.g. codex sets CODEX_HOME=<cwd>/.codex so
    // the CLI reads workspace-local config). Merged AFTER baseEnv so the
    // adapter wins on key collisions. (Independent of the seed below — every
    // adapter's composeEnv ignores initialPrompt.)
    const adapterEnv = adapter.composeEnv?.(baseCtx) ?? {};
    const env = { ...baseEnv, ...adapterEnv };

    // Quick-chat seed — the caller (the pool factory) passes `initialPrompt` ONLY
    // on a genuinely fresh spawn, so we don't re-gate on `resume` (pi rewrites a
    // fresh spawn's resume to its assigned `{ sessionId }`, so a resume check
    // would wrongly drop pi's seed — the adapters self-gate where it matters).
    //
    // SECURITY (win32): opencode/pi install as `.cmd` npm shims, so they spawn via
    // `cmd.exe /d /c <shim> …` (resolveLaunchCommand → viaShell). A user prompt
    // with cmd metacharacters (& | < > ^ %) would be re-parsed by cmd.exe
    // (BatBadBut / CVE-2024-27980); the headless path refuses shim agents on win32
    // for exactly this. We compose WITH the seed, then if the RESOLVED binary
    // needs the shell wrap, DROP the seed and recompose unseeded (the TUI still
    // opens, just not pre-filled). Native-exe agents (claude/codex) and all of
    // macOS/Linux resolve viaShell:false, so this is a no-op there. Resolve the
    // COMPOSED argv0 (the adapter's real binary), not config.command — codex/
    // opencode/pi ignore the base and hardcode their own binary.
    const compose = (withSeed: boolean): readonly string[] =>
      adapter.composeCommand(
        config.command,
        withSeed && initialPrompt ? { ...baseCtx, initialPrompt } : baseCtx,
      );
    let command = compose(true);
    if (initialPrompt && resolveLaunchCommand(command, { env }).viaShell) {
      launcherLogger.warn('spawn.seed_dropped_win32_shim', { wsId: ws.id, agent: adapter.id });
      command = compose(false);
    }
    const transcriptDir = adapter.transcriptDir ? adapter.transcriptDir(ws.dir) : null;
    return { command, cwd: ws.dir, env, transcriptDir };
  };

  const getRuntimeAdapters = () => adapters.list().filter(isAgentRuntime);

  const getAgentRuntimeReadinessMethod = (): AgentRuntimeReadinessSnapshot =>
    snapshotRuntimeReadiness(getRuntimeAdapters(), detectAgents(), runtimeReadinessCache);

  const runtimeReadinessSourceFor = (
    adapter: CliAdapter,
    availability?: AgentAvailability,
  ): AgentRuntimeReadinessSource => {
    if (adapter.id === 'claude' || adapter.id === 'codex') return 'global-login';
    const binaryPath = availability?.path ?? '';
    if (
      adapter.id === 'pi' &&
      (binaryPath.includes('/vendor/pi/') || binaryPath.includes('\\vendor\\pi\\'))
    ) {
      return 'managed-runtime';
    }
    return 'global-config';
  };

  const resolveOrCreateChatWorkspaceMethod = (
    preferredWorkspaceId?: string | null,
  ): Promise<ChatWorkspaceResolution> =>
    chatWorkspaceResolver.resolveOrCreate(preferredWorkspaceId);

  let runtimeReadinessWorkspaceInFlight: Promise<WorkspaceMeta> | null = null;

  const resolveRuntimeReadinessWorkspace = (): Promise<WorkspaceMeta> => {
    if (runtimeReadinessWorkspaceInFlight) return runtimeReadinessWorkspaceInFlight;
    const resolution = (async () => {
      const preferences = await readQuickChatPreferences().catch((error) => {
        launcherLogger.warn('agent_runtime_readiness.preference_read_failed', { error });
        return null;
      });
      const target = await resolveOrCreateChatWorkspaceMethod(
        preferences?.recentChatWorkspaceId,
      );
      if (!target.ok) {
        throw new Error(`Chat workspace unavailable: ${target.message}`);
      }
      await rememberRecentChatWorkspace(target.workspace.id).catch((error) => {
        launcherLogger.warn('agent_runtime_readiness.preference_write_failed', { error });
      });
      return target.workspace;
    })();
    runtimeReadinessWorkspaceInFlight = resolution;
    const clearInFlight = () => {
      if (runtimeReadinessWorkspaceInFlight === resolution) {
        runtimeReadinessWorkspaceInFlight = null;
      }
    };
    void resolution.then(clearInFlight, clearInFlight);
    return resolution;
  };

  const prepareRuntimeReadinessWorkspace = async (adapter: CliAdapter): Promise<WorkspaceMeta> => {
    const workspace = await resolveRuntimeReadinessWorkspace();
    if (adapter.bootstrap) {
      await adapter.bootstrap({
        wsId: workspace.id,
        cwd: workspace.dir,
        launcherRepoRoot: config.launcherRepoRoot,
      });
    }
    return workspace;
  };

  const writeFirstCompatibleRuntimeCredential = async (
    adapter: CliAdapter,
    dir: string,
  ): Promise<boolean> => {
    if (!adapter.writeAiConfig) return false;
    const credentials = await readCredentials();
    const [, credential] = compatibleCredentials(credentials, adapter.id)[0] ?? [];
    if (!credential) return false;

    const model = resolveInjectionModel(credential);
    const workspaceCredential = credentialToWorkspaceAiCred(
      credential,
      adapter.id,
      model ? { model } : {},
    );
    if (!workspaceCredential) return false;
    await adapter.writeAiConfig(dir, workspaceCredential);
    return true;
  };

  const runRuntimeReadinessProbeAttempt = async (
    adapter: CliAdapter,
    source: AgentRuntimeReadinessSource,
    options: { injectCredential?: boolean } = {},
  ) => {
    const ws = await prepareRuntimeReadinessWorkspace(adapter);
    let effectiveSource = source;
    if (!options.injectCredential && adapter.readAiConfig) {
      try {
        if (await adapter.readAiConfig(ws.dir)) effectiveSource = 'workspace-override';
      } catch (error) {
        launcherLogger.warn('agent_runtime_readiness.workspace_config_read_failed', {
          agent: adapter.id,
          error,
        });
      }
    }
    if (options.injectCredential) {
      const wroteCredential = await writeFirstCompatibleRuntimeCredential(adapter, ws.dir);
      if (!wroteCredential) return null;
    }
    const { cwd, env } = composeSpawnInputs(ws, adapter, undefined);
    const command = adapter.composeHeadlessCommand?.(
      config.command,
      { cwd, env },
      RUNTIME_READINESS_PROMPT,
    );
    if (!command) return null;
    const result = await runHeadlessTask({
      command,
      cwd,
      env,
      timeoutMs: RUNTIME_READINESS_TIMEOUT_MS,
      logger: launcherLogger.child({ scope: 'runtime-readiness', agent: adapter.id }),
      allowShellShim: true,
      ...(adapter.extractHeadlessSessionId
        ? { extractSessionId: adapter.extractHeadlessSessionId.bind(adapter) }
        : {}),
      ...(adapter.extractHeadlessAssistantText
        ? { extractAssistantText: adapter.extractHeadlessAssistantText.bind(adapter) }
        : {}),
      ...(adapter.extractHeadlessOutputEvents
        ? { extractOutputEvents: adapter.extractHeadlessOutputEvents.bind(adapter) }
        : {}),
      ...(adapter.keepHeadlessDiagnosticLine
        ? { keepDiagnosticLine: adapter.keepHeadlessDiagnosticLine.bind(adapter) }
        : {}),
    });
    return { result, source: effectiveSource };
  };

  const syntheticRuntimeReadinessFailure = (message: string): HeadlessTaskResult => ({
    command: [],
    cwd: config.launcherRoot,
    exitCode: -1,
    signal: null,
    killed: false,
    durationMs: 0,
    stdoutTail: '',
    stderrTail: message,
    agentSessionId: null,
    assistantText: null,
    structured: {
      schemaVersion: 1,
      assistantText: null,
      blocks: [],
      metrics: { textBlocks: 0, toolCalls: 0, toolFailures: 0 },
      truncated: false,
    },
  });

  const runtimeReadinessProbeInFlight = new Map<string, Promise<AgentRuntimeReadinessRow>>();

  const executeSingleAgentRuntimeReadinessProbe = async (
    adapter: CliAdapter,
    availability?: AgentAvailability,
  ): Promise<AgentRuntimeReadinessRow> => {
    if (!availability?.installed) {
      const row = notInstalledRuntimeReadinessRow(adapter, availability);
      runtimeReadinessCache.set(adapter.id, row);
      return row;
    }
    if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
      const row = failedRuntimeReadinessRow({
        adapter,
        availability,
        result: syntheticRuntimeReadinessFailure('Agent does not support headless probes.'),
      });
      runtimeReadinessCache.set(adapter.id, row);
      return row;
    }

    const existing =
      runtimeReadinessCache.get(adapter.id) ?? initialRuntimeReadinessRow(adapter, availability);
    runtimeReadinessCache.set(adapter.id, checkingRuntimeReadinessRow(existing));

    const globalSource = runtimeReadinessSourceFor(adapter, availability);
    let lastAttempt: Awaited<ReturnType<typeof runRuntimeReadinessProbeAttempt>> | null = null;

    try {
      lastAttempt = await runRuntimeReadinessProbeAttempt(adapter, globalSource);
      if (lastAttempt && runtimeProbeSucceeded(lastAttempt.result)) {
        const row = readyRuntimeReadinessRow({
          adapter,
          availability,
          source: lastAttempt.source,
          durationMs: lastAttempt.result.durationMs,
        });
        runtimeReadinessCache.set(adapter.id, row);
        return row;
      }

      const launcherAttempt = await runRuntimeReadinessProbeAttempt(adapter, 'launcher-vault', {
        injectCredential: true,
      });
      if (launcherAttempt) lastAttempt = launcherAttempt;
      if (launcherAttempt && runtimeProbeSucceeded(launcherAttempt.result)) {
        const row = readyRuntimeReadinessRow({
          adapter,
          availability,
          source: 'launcher-vault',
          durationMs: launcherAttempt.result.durationMs,
        });
        runtimeReadinessCache.set(adapter.id, row);
        return row;
      }

      const row = failedRuntimeReadinessRow({
        adapter,
        availability,
        result:
          lastAttempt?.result ??
          syntheticRuntimeReadinessFailure('No compatible credential or runtime config was found.'),
        source: lastAttempt?.source ?? globalSource,
      });
      runtimeReadinessCache.set(adapter.id, row);
      return row;
    } catch (err) {
      const row = failedRuntimeReadinessRow({
        adapter,
        availability,
        result: syntheticRuntimeReadinessFailure(err instanceof Error ? err.message : String(err)),
        source: lastAttempt?.source ?? globalSource,
      });
      runtimeReadinessCache.set(adapter.id, row);
      return row;
    }
  };

  const probeSingleAgentRuntimeReadiness = (
    adapter: CliAdapter,
    availability?: AgentAvailability,
  ): Promise<AgentRuntimeReadinessRow> => {
    const existing = runtimeReadinessProbeInFlight.get(adapter.id);
    if (existing) return existing;
    const probe = executeSingleAgentRuntimeReadinessProbe(adapter, availability);
    runtimeReadinessProbeInFlight.set(adapter.id, probe);
    void probe.finally(() => {
      if (runtimeReadinessProbeInFlight.get(adapter.id) === probe) {
        runtimeReadinessProbeInFlight.delete(adapter.id);
      }
    });
    return probe;
  };

  const readinessTargets = (agentId?: string): CliAdapter[] => {
    const runtimeAdapters = getRuntimeAdapters();
    return agentId
      ? runtimeAdapters.filter((adapter) => adapter.id === agentId)
      : runtimeAdapters;
  };

  const beginAgentRuntimeReadinessProbeMethod = (agentId?: string) => {
    const targets = readinessTargets(agentId);
    const availability = detectAgents();
    for (const adapter of targets) {
      void probeSingleAgentRuntimeReadiness(adapter, availability[adapter.id]).catch((err) => {
        launcherLogger.warn('agent_runtime_readiness.background_probe_failed', {
          agent: adapter.id,
          err,
        });
      });
    }
    return {
      agents: targets.map((adapter) => adapter.id),
      snapshot: getAgentRuntimeReadinessMethod(),
    };
  };

  const probeAgentRuntimeReadinessMethod = async (
    agentId?: string,
  ): Promise<AgentRuntimeReadinessSnapshot> => {
    const targets = readinessTargets(agentId);
    const availability = detectAgents();
    await Promise.all(
      targets.map((adapter) => probeSingleAgentRuntimeReadiness(adapter, availability[adapter.id])),
    );
    return snapshotRuntimeReadiness(getRuntimeAdapters(), detectAgents(), runtimeReadinessCache);
  };

  const computeSpawnPlan = (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
  ): SpawnPlan => {
    const { command, cwd, env, transcriptDir } = composeSpawnInputs(ws, adapter, resume);
    return {
      resumeMode: resume === undefined ? 'fresh' : resume === 'last' ? 'last' : 'by-id',
      nativeSessionId: resume && resume !== 'last' ? resume.sessionId : null,
      composedCommand: command,
      spawnCwd: cwd,
      envPWD: env['PWD'] ?? null,
      transcriptDir,
      projectKey: transcriptDir ? basename(transcriptDir) : null,
    };
  };

  const workspaceOperationGuard = new WorkspaceOperationGuard();
  const headlessActivity = new WorkspaceHeadlessActivityTracker();

  const runHeadlessProbeMethod = async (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
    prompt: string,
    timeoutMs: number,
  ): Promise<HeadlessProbeResult> => {
    const operationLease = workspaceOperationGuard.acquire(ws.id, 'headless-probe');
    if (!operationLease) throw new Error(`workspace is busy with ${workspaceOperationGuard.current(ws.id)}`);
    const activityLease = headlessActivity.begin({ workspaceId: ws.id, agent: adapter.id });
    let startLeaseReleased = false;
    const releaseStartLease = () => {
      if (startLeaseReleased) return;
      startLeaseReleased = true;
      operationLease.release();
    };
    try {
      await ensureAgentCredentialReady({
        meta: ws,
        agentId: adapter.id,
        adapter,
        logger: launcherLogger,
      });
      const { command, cwd, env, transcriptDir } = composeSpawnInputs(ws, adapter, resume);
      return await runHeadlessProbe({
        command,
        cwd,
        env,
        transcriptDir,
        transcriptFileRe: adapter.transcriptFileRe ?? null,
        prompt,
        timeoutMs,
        logger: launcherLogger.child({ scope: 'probe', wsId: ws.id, agent: adapter.id }),
        onSpawned: releaseStartLease,
      });
    } finally {
      activityLease.release();
      releaseStartLease();
    }
  };

  const runHeadlessTaskMethod = async (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
    // Dispatch-path extras: a taskId keys the on-disk task log; onSessionId
    // fires when the adapter's stdout scanner captures the agent's own session
    // id (recorded WHILE running, so the panel can offer "open as session").
    opts: {
      taskId?: string;
      resumeId?: string;
      resume?: SessionFactoryContext['resume'];
      onSessionId?: (id: string) => void;
    } = {},
  ): Promise<HeadlessTaskResult> => {
    const operationLease = workspaceOperationGuard.acquire(ws.id, 'headless-run');
    if (!operationLease) throw new Error(`workspace is busy with ${workspaceOperationGuard.current(ws.id)}`);
    let startLeaseReleased = false;
    const releaseStartLease = () => {
      if (startLeaseReleased) return;
      startLeaseReleased = true;
      operationLease.release();
    };
    try {
      if (catalog.get(ws.id)?.lifecycle !== 'active') {
        throw new Error(`workspace is not active: ${ws.id}`);
      }
      if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
        throw new Error(`adapter "${adapter.id}" has no headless mode`);
      }
      await ensureAgentCredentialReady({
        meta: ws,
        agentId: adapter.id,
        adapter,
        logger: launcherLogger,
      });
      if (catalog.get(ws.id)?.lifecycle !== 'active') {
        throw new Error(`workspace stopped accepting work before spawn: ${ws.id}`);
      }
      // Reuse a fresh interactive spawn's env/cwd (identical MCP injection),
      // then swap the interactive command for the one-shot headless argv. Inject
      // AQ_RUN_ID = this run's taskId so the agent's inbox pushes self-link to the
      // run server-side (via the `alice` shim header / opencode's MCP header) —
      // headless-only, agent never sees it. The taskId is the registry key the
      // route resolves issueId/agent from.
      const { cwd, env } = composeSpawnInputs(
        ws,
        adapter,
        opts.resume,
        undefined,
        opts.taskId ? {
          AQ_RUN_ID: opts.taskId,
          ...(opts.resumeId ? {
            OPENALICE_RESUME_ID: opts.resumeId,
            OPENALICE_SIGNATURE: `@${opts.resumeId}`,
          } : {}),
        } : undefined,
      );
      const command = adapter.composeHeadlessCommand(
        config.command,
        { cwd, env, ...(opts.resume !== undefined ? { resume: opts.resume } : {}) },
        prompt,
      );
      const logPaths = opts.taskId ? headlessLogPaths(headlessLogsDir, opts.taskId) : null;
      const activityLease = headlessActivity.begin({
        workspaceId: ws.id,
        agent: adapter.id,
        ...(opts.taskId ? { taskId: opts.taskId } : {}),
      });
      try {
        return await runHeadlessTask({
          command,
          cwd,
          env,
          timeoutMs,
          logger: launcherLogger.child({ scope: 'headless', wsId: ws.id, agent: adapter.id }),
          ...(logPaths
            ? { stdoutFile: logPaths.stdout, stderrFile: logPaths.stderr, structuredFile: logPaths.structured }
            : {}),
          ...(adapter.extractHeadlessSessionId
            ? { extractSessionId: adapter.extractHeadlessSessionId.bind(adapter) }
            : {}),
          ...(adapter.extractHeadlessAssistantText
            ? { extractAssistantText: adapter.extractHeadlessAssistantText.bind(adapter) }
            : {}),
          ...(adapter.extractHeadlessOutputEvents
            ? { extractOutputEvents: adapter.extractHeadlessOutputEvents.bind(adapter) }
            : {}),
          ...(adapter.keepHeadlessDiagnosticLine
            ? { keepDiagnosticLine: adapter.keepHeadlessDiagnosticLine.bind(adapter) }
            : {}),
          ...(opts.onSessionId ? { onSessionId: opts.onSessionId } : {}),
          onChildSpawned: (child) => {
            activityLease.attach(child);
            // From here process-backed activity closes the race; directory
            // reviews may proceed and explain this exact run as the blocker.
            releaseStartLease();
          },
        });
      } finally {
        activityLease.release();
      }
    } finally {
      releaseStartLease();
    }
  };

  /**
   * ASYNC dispatch: record the task, spawn it in the background, return the
   * taskId immediately. The record fills in on exit. This is the automation
   * path (a trigger doesn't wait minutes for the run); the sync
   * `runHeadlessTask` stays for the `wait:true` API mode + direct callers.
   * Throws `HeadlessCapacityError` when too many tasks are already in flight.
   */
  const dispatchHeadlessTaskMethod = async (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
    // Composite Issue source when dispatched by ScheduleScanner. Manual and
    // external runs leave it undefined.
    trigger?: HeadlessTaskTrigger,
    resumeId?: string,
    inquiry?: HeadlessTaskInquiry,
  ): Promise<{ taskId: string; resumeId: string }> => {
    if (catalog.get(ws.id)?.lifecycle !== 'active') {
      throw new Error(`workspace is not active: ${ws.id}`);
    }
    if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
      throw new Error(`adapter "${adapter.id}" has no headless mode`);
    }
    await ensureAgentCredentialReady({
      meta: ws,
      agentId: adapter.id,
      adapter,
      logger: launcherLogger,
    });
    if (headlessTasks.runningCount() >= MAX_CONCURRENT_HEADLESS) {
      throw new HeadlessCapacityError(MAX_CONCURRENT_HEADLESS);
    }
    let nativeResume: SessionFactoryContext['resume'];
    let parentTaskId: string | undefined;
    if (resumeId) {
      const identity = resumeRegistry.get(resumeId);
      if (!identity) throw new HeadlessResumeError('not_found', 'resume conversation not found');
      if (identity.lifecycle === 'retired') {
        throw new HeadlessResumeError('retired', 'resume conversation is retired');
      }
      if (identity.wsId !== ws.id) {
        throw new HeadlessResumeError('wrong_workspace', 'resume conversation belongs to another workspace');
      }
      if (identity.agent !== adapter.id) {
        throw new HeadlessResumeError('wrong_agent', `resume conversation belongs to ${identity.agent}`);
      }
      if (!identity.agentSessionId) {
        throw new HeadlessResumeError('not_ready', 'runtime session id has not been captured yet');
      }
      await sessionRegistry.ensureLoaded(ws.id);
      const interactive = sessionRegistry.findByResumeId(ws.id, resumeId);
      if (interactive?.state === 'running') {
        throw new HeadlessResumeError('busy', 'this conversation is open in an interactive session');
      }
      // Reserve before the first await below. Without this, two HTTP requests
      // can both pass the check and mutate one native transcript concurrently.
      if (!claimResume(resumeId)) {
        throw new HeadlessResumeError('busy', 'this conversation already has a running turn');
      }
      nativeResume = { sessionId: identity.agentSessionId };
      parentTaskId = identity.latestTaskId ?? headlessTasks.latestForResumeId(resumeId)?.taskId;
    }
    let rec: HeadlessTaskRecord;
    try {
      // ResumeRegistry is the sole allocator for product conversation ids.
      // HeadlessTaskRegistry only records executions against that identity.
      const identity = await resumeRegistry.ensure({
        ...(resumeId ? { resumeId } : {}),
        wsId: ws.id,
        agent: adapter.id,
      });
      if (catalog.get(ws.id)?.lifecycle !== 'active') {
        throw new Error(`workspace stopped accepting work during dispatch: ${ws.id}`);
      }
      rec = await headlessTasks.create({
        wsId: ws.id,
        agent: adapter.id,
        prompt,
        startedAt: Date.now(),
        resumeId: identity.resumeId,
        ...(parentTaskId ? { parentTaskId } : {}),
        ...(trigger ? { trigger } : {}),
        ...(inquiry ? { inquiry } : {}),
      });
      await resumeRegistry.ensure({
        resumeId: identity.resumeId,
        wsId: ws.id,
        agent: adapter.id,
        latestTaskId: rec.taskId,
      });
    } catch (err) {
      if (resumeId) activeResumeIds.delete(resumeId);
      throw err;
    }
    if (!resumeId) activeResumeIds.add(rec.resumeId);
    // Fire-and-forget: run to natural exit, then fill the record. Process
    // failures and terminal in-band runtime errors fail the task; retryable
    // errors followed by a later assistant reply remain visible in Activity
    // without turning a recovered run into a false failure.
    void runHeadlessTaskMethod(ws, adapter, prompt, timeoutMs, {
      taskId: rec.taskId,
      resumeId: rec.resumeId,
      ...(nativeResume ? { resume: nativeResume } : {}),
      onSessionId: (id) => {
        void Promise.all([
          headlessTasks.setAgentSessionId(rec.taskId, id),
          resumeRegistry.bindAgentSessionId(rec.resumeId, id),
        ]).catch((err) =>
          launcherLogger.warn('headless.session_id_record_failed', {
            taskId: rec.taskId, resumeId: rec.resumeId, err,
          }),
        );
      },
    })
      .then(async (r) => {
        const status = headlessTaskStatus(r);
        await headlessTasks.complete(rec.taskId, {
          status,
          finishedAt: Date.now(),
          durationMs: r.durationMs,
          exitCode: r.exitCode,
          signal: r.signal,
          killed: r.killed,
          output: {
            hasAssistantReply: r.structured.assistantText !== null,
            ...(r.structured.assistantText
              ? { assistantPreview: r.structured.assistantText.slice(0, 1000) }
              : {}),
            blockCount: r.structured.blocks.length,
            toolCalls: r.structured.metrics.toolCalls,
            toolFailures: r.structured.metrics.toolFailures,
          },
        });
        await completeIssueCommentInquiry({
          task: rec,
          status,
          assistantText: r.structured.assistantText,
          ...(status !== 'done' && r.stderrTail ? { error: r.stderrTail.slice(-1000) } : {}),
        });
        // Scheduled one-shot issues are the only board items whose lifecycle can
        // be closed mechanically from a run exit. Repeating schedules keep their
        // issue open; failed one-shots stay open so the operator can inspect and
        // decide whether to rerun.
        try {
          const issueWorkspace = trigger?.kind === 'issue'
            ? registry.get(trigger.workspaceId)
            : undefined;
          const issueCompletion = await completeOneShotIssueAfterRun({
            wsDir: issueWorkspace?.dir ?? ws.dir,
            issueId: issueWorkspace && trigger?.kind === 'issue' ? trigger.issueId : undefined,
            status,
            exitCode: r.exitCode,
            killed: r.killed,
          });
          if (issueCompletion.updated) {
            launcherLogger.info('issue.oneshot_completed', {
              wsId: trigger?.kind === 'issue' ? trigger.workspaceId : ws.id,
              issueId: issueCompletion.issueId,
              previousStatus: issueCompletion.previousStatus,
              taskId: rec.taskId,
            });
          } else if (issueCompletion.reason === 'mutation_failed' || issueCompletion.reason === 'issues_unavailable') {
            launcherLogger.warn('issue.oneshot_complete_skipped', {
              wsId: ws.id,
              issueId: trigger?.kind === 'issue' ? trigger.issueId : undefined,
              taskId: rec.taskId,
              reason: issueCompletion.reason,
              error: issueCompletion.error,
            });
          }
        } catch (err) {
          launcherLogger.warn('issue.oneshot_complete_failed', {
            wsId: ws.id,
            issueId: trigger?.kind === 'issue' ? trigger.issueId : undefined,
            taskId: rec.taskId,
            err,
          });
        }
      })
      .catch(async (err) => {
        const message = err instanceof Error ? err.message : String(err);
        await headlessTasks.complete(rec.taskId, {
          status: 'failed',
          finishedAt: Date.now(),
          error: message,
        });
        await completeIssueCommentInquiry({
          task: rec,
          status: 'failed',
          error: message,
        });
      })
      .finally(() => activeResumeIds.delete(rec.resumeId));
    return { taskId: rec.taskId, resumeId: rec.resumeId };
  };

  // ── Workspace self-scheduling. Scan each workspace's own `.alice/issues/*.md`
  // files and fire due SCHEDULED issues as headless runs through the SAME dispatch
  // primitive (issues without a `when` are pure board items, ignored here). The
  // scanner owns its own tick (infra periodicity, NOT a scheduled task) and
  // persists only a last-fired marker — never the schedule itself, which lives
  // solely in the workspace's file.
  const scheduleMarkers = await ScheduleMarkerStore.load(
    join(config.launcherRoot, 'state', 'schedule-markers.json'),
    launcherLogger.child({ scope: 'schedule-markers' }),
  );
  const scheduleScanner = new ScheduleScanner({
    registry,
    resolveResumeWorkspace: (resumeId) => {
      const identity = resumeRegistry.get(resumeId);
      return identity && identity.lifecycle !== 'retired' ? registry.get(identity.wsId) : undefined;
    },
    resolveAdapter: async (ws, agentId, resumeId) => {
      if (resumeId) {
        const identity = resumeRegistry.get(resumeId);
        if (!identity) throw new Error(`unknown resume conversation: ${resumeId}`);
        if (identity.lifecycle === 'retired') throw new Error(`retired resume conversation: ${resumeId}`);
        if (identity.wsId !== ws.id) throw new Error(`resume conversation workspace resolution drifted`);
        return resolveAdapter(ws, identity.agent);
      }
      if (agentId) return resolveAdapter(ws, agentId);
      return resolveAdapter(ws, await resolveIssueDefaultAgentId(ws));
    },
    dispatch: dispatchHeadlessTaskMethod,
    markers: scheduleMarkers,
    logger: launcherLogger.child({ scope: 'schedule' }),
  });
  // Read-only aggregation for the Schedules dashboard (GET /api/schedule).
  // Walks each workspace's live declaration + the scanner's marker; the route
  // layer stays a thin adapter and the marker store stays private.
  const scheduleSnapshot = async (): Promise<ScheduleSnapshot> => {
    // Warm path: the scanner rebuilds this every tick (it already reads every
    // declaration), so serving its cache is O(1) — no per-request disk walk.
    const cached = scheduleScanner.snapshot();
    if (cached) return cached;
    // Cold path: only before the scanner's first tick (delayed to stay
    // test-safe). One live read-only build — no firing.
    const nowMs = Date.now();
    const workspaces = await Promise.all(
      registry.list().map(async (ws): Promise<ScheduleSnapshotWorkspace> => {
        const res = await readWorkspaceIssues(ws.dir);
        if (!res.ok) {
          return {
            wsId: ws.id,
            tag: ws.tag,
            status: res.reason,
            ...(res.reason === 'invalid' ? { error: res.error } : {}),
            tasks: [],
          };
        }
        const tasks: ScheduleSnapshotTask[] = [];
        for (const issue of res.issues) {
          // Only SCHEDULED issues (those carrying a `when`) reach the schedule
          // snapshot; unscheduled issues are pure board work items.
          if (!issue.when) continue;
          tasks.push(
            snapshotScheduledIssue(
              issue,
              issue.when,
              scheduleMarkers.get(ws.id, issue.id) ?? null,
              nowMs,
              DEFAULT_INTERVAL_MS,
            ),
          );
        }
        return { wsId: ws.id, tag: ws.tag, status: 'ok', tasks };
      }),
    );
    return { workspaces };
  };

  // Read-only aggregation for the global Issue board (GET /api/issues). Mirrors
  // scheduleSnapshot's cold path, but returns ALL issues (not just scheduled
  // ones) and the board's two-valued status. Always a live read: the scanner's
  // warm cache holds only the SCHEDULED projection, so it can't reconstruct the
  // board's unscheduled work items — and the board is a low-frequency poll.
  const issuesSnapshot = async (): Promise<IssuesSnapshot> => {
    const nowMs = Date.now();
    const workspaces = await Promise.all(
      registry.list().map(async (ws): Promise<IssuesSnapshotWorkspace> => {
        const res = await readWorkspaceIssues(ws.dir);
        if (!res.ok) {
          // 'absent' (no issues dir) is an empty board for that workspace, not an
          // error; only a genuinely unreadable dir (e.g. retired issue.json) is
          // surfaced as 'invalid' with its actionable hint.
          if (res.reason === 'absent') {
            return { wsId: ws.id, tag: ws.tag, status: 'ok', issues: [] };
          }
          return { wsId: ws.id, tag: ws.tag, status: 'invalid', error: res.error, issues: [] };
        }
        const issues: IssuesSnapshotIssue[] = res.issues.map((issue) => {
          // Unscheduled ⇒ pure board work item, no firing markers.
          if (!issue.when) return snapshotBoardIssue(issue, null);
          // Scheduled ⇒ reuse the schedule snapshot's math so the board's
          // last/next match the Schedules dashboard exactly.
          const fired = snapshotScheduledIssue(
            issue,
            issue.when,
            scheduleMarkers.get(ws.id, issue.id) ?? null,
            nowMs,
            DEFAULT_INTERVAL_MS,
          );
          const latestRun = headlessTasks.list({ issue: { workspaceId: ws.id, issueId: issue.id } })[0];
          return snapshotBoardIssue(
            issue,
            {
              lastFiredAtMs: fired.lastFiredAtMs,
              nextDueAtMs: fired.nextDueAtMs,
              automationHealth: issueAutomationHealth({
                status: issue.status,
                nowMs,
                nextDueAtMs: fired.nextDueAtMs,
                ownerState: automationOwnerState(issue.assignee, resumeRegistry),
                ...(latestRun ? { latestRun: automationLatestRun(latestRun) } : {}),
              }),
            },
          );
        });
        return { wsId: ws.id, tag: ws.tag, status: 'ok', issues };
      }),
    );
    // Cross-workspace name-clash detection (mutates rows in place + returns the
    // colliding display titles). Detection only — never enforced at write time.
    const duplicateNames = annotateNameCollisions(workspaces);
    return { workspaces, duplicateNames };
  };

  // Read-only DETAIL for ONE issue (GET /api/issues/:wsId/:id). Resolves the
  // workspace, live-reads its issues, finds the matching id, enriches a scheduled
  // issue with the SAME firing math as the board (so last/next agree), and joins
  // the headless registry on wsId+issueId for the independent Runs history.
  // Returns null when the workspace, its issues dir, or the id is absent —
    // the route maps that to a 404. Includes canonical What (the list omits it).
  const issueDetail = async (wsId: string, id: string): Promise<IssueDetail | null> => {
    const ws = registry.get(wsId);
    if (!ws) return null;
    const res = await readWorkspaceIssues(ws.dir);
    if (!res.ok) return null; // absent or unreadable issues dir ⇒ no such issue
    const issue = res.issues.find((i) => i.id === id);
    if (!issue) return null;
    const commentsResult = await readIssueComments(ws.dir, issue.id);
    const comments = commentsResult.ok ? commentsResult.comments : [];
    if (!commentsResult.ok) {
      launcherLogger.warn('issue.comments_invalid', { wsId: ws.id, issueId: issue.id, error: commentsResult.error });
    }
    let scheduledSnapshot: ScheduleSnapshotTask | null = null;
    if (issue.when) {
      const fired = snapshotScheduledIssue(
        issue,
        issue.when,
        scheduleMarkers.get(ws.id, issue.id) ?? null,
        Date.now(),
        DEFAULT_INTERVAL_MS,
      );
      scheduledSnapshot = fired;
    }
    // Newest-first already (registry.list reverses); filter to this issue's runs.
    const runs = headlessTasks.list({ issue: { workspaceId: ws.id, issueId: issue.id } }).map((task) => {
      const identity = resumeRegistry.get(task.resumeId);
      return issueRunRecord(task, identity?.lifecycle !== 'retired' && Boolean(identity?.agentSessionId));
    });
    const markers: IssueFiringMarkers | null = scheduledSnapshot ? {
      lastFiredAtMs: scheduledSnapshot.lastFiredAtMs,
      nextDueAtMs: scheduledSnapshot.nextDueAtMs,
      automationHealth: issueAutomationHealth({
        status: issue.status,
        nowMs: Date.now(),
        nextDueAtMs: scheduledSnapshot.nextDueAtMs,
        ownerState: automationOwnerState(issue.assignee, resumeRegistry),
        ...(runs[0] ? {
          latestRun: {
            taskId: runs[0].taskId,
            status: runs[0].status,
            ...(runs[0].failure ? { failure: runs[0].failure } : {}),
          },
        } : {}),
      }),
    } : null;
    // The issue→inbox cross-link: the reports this issue produced (entries this
    // workspace pushed whose server-stamped origin.issueId is this issue).
    // Joined here in the domain so CLI / MCP get it too, not just the HTTP route.
    let inboxReports: IssueDetail['inboxReports'] = [];
    if (inboxStore) {
      const { entries } = await inboxStore.read({ limit: 1000 });
      inboxReports = inboxReportsForIssue(entries, ws.id, issue.id).map((entry) => {
        let origin = toSafeInboxOrigin(entry.origin);
        if (origin && !origin.resumeId && origin.kind === 'headless' && origin.runId) {
          const resumeId = headlessTasks.get(origin.runId)?.resumeId;
          if (resumeId) origin = { ...origin, resumeId };
        }
        if (origin && !origin.resumeId && origin.kind === 'interactive' && origin.sessionId) {
          const resumeId = sessionRegistry.get(ws.id, origin.sessionId)?.resumeId;
          if (resumeId) origin = { ...origin, resumeId };
        }
        return { ...entry, ...(origin ? { origin } : { origin: undefined }) };
      });
    }
    const provenance = issueProvenanceRecords(provenanceStore.list({
      artifact: { kind: 'issue', workspaceId: ws.id, issueId: issue.id },
    }));
    const activity = issueActivityRecords(provenance, comments);
    return { issue: detailIssue(issue, markers), comments, runs, inboxReports, provenance, activity };
  };

  const retryingIssueKeys = new Set<string>();
  const retryIssue = async (wsId: string, id: string): Promise<IssueDetail> => {
    const key = `${wsId}:${id}`;
    const ws = registry.get(wsId);
    if (!ws) throw new IssueRetryError('not_found', 'Workspace not found.');
    const issueResult = await readWorkspaceIssues(ws.dir);
    const issue = issueResult.ok
      ? issueResult.issues.find((candidate) => candidate.id === id)
      : undefined;
    if (!issue) throw new IssueRetryError('not_found', 'Issue not found.');
    if (!issue.when) {
      throw new IssueRetryError('not_scheduled', 'Only scheduled Issues can be retried.');
    }
    if (issue.status === 'done' || issue.status === 'canceled') {
      throw new IssueRetryError(
        'not_fireable',
        `This Issue is ${issue.status}; reopen it before retrying.`,
      );
    }
    const latest = headlessTasks.list({ issue: { workspaceId: wsId, issueId: id } })[0];
    if (latest?.status === 'running' || retryingIssueKeys.has(key)) {
      throw new IssueRetryError('already_running', 'This Issue already has a run in progress.');
    }
    if (!latest || (latest.status !== 'failed' && latest.status !== 'interrupted')) {
      throw new IssueRetryError(
        'not_retryable',
        'Only the latest failed or interrupted scheduled run can be retried.',
      );
    }

    retryingIssueKeys.add(key);
    try {
      const { taskId } = await scheduleScanner.runIssueNow(wsId, id);
      launcherLogger.info('issue.retry_dispatched', {
        wsId,
        issueId: id,
        previousTaskId: latest.taskId,
        taskId,
      });
    } catch (err) {
      if (err instanceof ScheduledIssueRunNowError) {
        throw new IssueRetryError(err.code, err.message);
      }
      throw err;
    } finally {
      retryingIssueKeys.delete(key);
    }

    const detail = await issueDetail(wsId, id);
    if (!detail) throw new IssueRetryError('not_found', 'Issue not found.');
    return detail;
  };

  const sessionDirectory = async (
    wsId: string,
    limit = 50,
  ): Promise<WorkspaceSessionDirectory | null> => {
    const ws = registry.get(wsId);
    if (!ws) return null;
    await sessionRegistry.ensureLoaded(wsId);
    return buildWorkspaceSessionDirectory({
      workspace: { id: ws.id, tag: ws.tag },
      identities: resumeRegistry.list({ wsId, limit }),
      interactiveFor: (resumeId) => sessionRegistry.findByResumeId(wsId, resumeId),
      latestExecutionFor: (resumeId) => headlessTasks.latestForResumeId(resumeId),
      isActive: (resumeId) => activeResumeIds.has(resumeId),
    });
  };

  // Resolve a `[[name]]` token to the issues (across ALL workspaces) that claim
  // it. A token matches an issue when, case-insensitively, it equals the issue's
  // `id` (filename slug) OR its `title` — both are legitimate name handles an
  // author might link. Live read like the board; a bad workspace is skipped, not
  // propagated. Multiple matches = a collision the UI disambiguates by wsId.
  const resolveIssuesByName = async (name: string): Promise<WikilinkIssueRef[]> => {
    const token = name.trim().toLowerCase();
    if (!token) return [];
    const out: WikilinkIssueRef[] = [];
    await Promise.all(
      registry.list().map(async (ws) => {
        const res = await readWorkspaceIssues(ws.dir);
        if (!res.ok) return;
        for (const issue of res.issues) {
          if (issue.id.toLowerCase() === token || issue.title.trim().toLowerCase() === token) {
            out.push({ wsId: ws.id, wsTag: ws.tag, id: issue.id, title: issue.title });
          }
        }
      }),
    );
    return out;
  };

  const pool = new SessionPool(
    (wsId, ctx) => {
      const ws = registry.get(wsId);
      if (!ws) throw new Error(`workspace not found: ${wsId}`);
      const adapter = resolveAdapter(ws, ctx.agentId);
      // Assigned-id resume (e.g. pi): on a FRESH spawn of an id-assigning
      // adapter, mint a uuid, thread it through composeCommand's {sessionId}
      // intent (`--session-id`, create-or-reopen), and persist it as resumeHint
      // immediately — "self-archive", so reattach resumes BY ID instead of
      // fragile `--continue`/last. The record is pre-allocated (SessionPool.spawn
      // takes a pre-allocated recordId), so the registry update is safe;
      // fire-and-forget like the transcript-watcher's hint write.
      // Capture fresh-ness BEFORE the assigned-id rewrite below: an id-assigning
      // adapter (pi) overwrites `resume` to `{ sessionId }` on a fresh spawn, so
      // `resume === undefined` is no longer a valid "is this fresh?" test once we
      // pass it down — the quick-chat seed must key off the ORIGINAL intent.
      const isFresh = ctx.resume === undefined;
      let resume = ctx.resume;
      if (isFresh && adapter.capabilities.assignsSessionId) {
        const sessionId = randomUUID();
        resume = { sessionId };
        void sessionRegistry
          .update(wsId, ctx.recordId, { resumeHint: { kind: 'agent-session-id', value: sessionId } })
          .catch((err) =>
            launcherLogger.warn('assigned_session_id.persist_failed', { wsId, recordId: ctx.recordId, err }),
          );
        const record = sessionRegistry.get(wsId, ctx.recordId);
        if (record) {
          void resumeRegistry.bindAgentSessionId(record.resumeId, sessionId).catch((err) =>
            launcherLogger.warn('assigned_session_id.resume_map_failed', {
              wsId, recordId: ctx.recordId, resumeId: record.resumeId, err,
            }),
          );
        }
      }
      const productSession = sessionRegistry.get(wsId, ctx.recordId);
      const { command: composedCommand, env, transcriptDir } = composeSpawnInputs(
        ws,
        adapter,
        resume,
        // Seed only on a genuinely fresh spawn (not a resume that an id-assigning
        // adapter rewrote into a `{ sessionId }` intent).
        isFresh ? ctx.initialPrompt : undefined,
        // INTERACTIVE-only session identity: the pre-allocated SessionRegistry
        // record id (= what the pool keys by). Mirrors the headless path's
        // AQ_RUN_ID, but injected HERE in the pool factory — the sole interactive
        // PTY-spawn seam. The headless dispatch and the offline probe call
        // composeSpawnInputs directly (NOT through the pool), so neither ever
        // carries AQ_SESSION_ID; a spawn carries AQ_RUN_ID XOR AQ_SESSION_ID. The
        // `alice` shim forwards it as the `x-openalice-session` header, resolved
        // server-side against the session registry — agent never sees it.
        {
          ...terminalThemeEnv(ctx.terminalTheme),
          AQ_SESSION_ID: ctx.recordId,
          ...(productSession?.resumeId ? {
            OPENALICE_RESUME_ID: productSession.resumeId,
            OPENALICE_SIGNATURE: `@${productSession.resumeId}`,
          } : {}),
        },
      );

      // path.trace — single line capturing every path the spawn touches. The
      // raison d'être of the workspace-sessions.log file: any two fields that
      // should be equal but aren't are the bug, eyeball-comparable. Keep this
      // verbose; the file is grep-only, not human-tailed.
      launcherLogger.event('path.trace', {
        where: 'session.spawn',
        wsId,
        recordId: ctx.recordId,
        agent: adapter.id,
        wsDir: ws.dir,
        spawnCwd: ws.dir,
        envPWD: env['PWD'] ?? null,
        envHOME: env['HOME'] ?? null,
        transcriptDir,
        projectKey: transcriptDir ? basename(transcriptDir) : null,
        composedCommand,
        resumeMode: resume === undefined
          ? 'fresh'
          : resume === 'last' ? 'last' : 'by-id',
        resumeId: resume && resume !== 'last' ? resume.sessionId : null,
        // grep-able flag; the prompt text itself is already in composedCommand.
        // Keys off the original fresh-ness, not `resume` (pi rewrites it).
        seeded: isFresh && !!ctx.initialPrompt,
      });

      return {
        opts: {
          command: composedCommand,
          cwd: ws.dir,
          env,
          initialCols: 80,
          initialRows: 24,
          logger: launcherLogger.child({ scope: 'session', wsId, agent: adapter.id }),
          replayBufferBytes: config.replayBufferBytes,
          highWatermarkBytes: config.bpHighWatermarkBytes,
          lowWatermarkBytes: config.bpLowWatermarkBytes,
          ...(ctx.initialReplayBytes ? { initialReplayBytes: ctx.initialReplayBytes } : {}),
        },
        adapter,
      };
    },
    launcherLogger.child({ scope: 'pool' }),
    transcriptWatcher,
  );

  const webPi = new WebPiSessionHost(
    launcherLogger.child({ scope: 'webpi-host' }),
    {
      onExit: (recordId, reason) => {
        // Intentional handoffs are followed by an explicit caller-owned state
        // update (paused, terminal-running, or deleted). Letting this async
        // callback also write `paused` would race a WebPi -> TUI switch.
        if (reason.intentional) return;
        const record = sessionRegistry.findById(recordId);
        if (!record) return;
        void sessionRegistry.update(record.wsId, record.id, {
          state: 'paused',
          lastActiveAt: new Date().toISOString(),
        }).catch((err) => launcherLogger.warn('webpi.pause_update_failed', { recordId, err }));
      },
    },
  );

  const startWebPiSession = async (
    meta: WorkspaceMeta,
    record: SessionRecord,
  ): Promise<WebPiSnapshot> => {
    const operationLease = workspaceOperationGuard.acquire(meta.id, 'webpi-start');
    if (!operationLease) throw new Error(`workspace is busy with ${workspaceOperationGuard.current(meta.id)}`);
    try {
    if (record.agent !== 'pi') throw new Error('WebPi is available only for Pi Sessions');
    const adapter = adapters.get('pi');
    if (!adapter?.composeWebCommand) throw new Error('installed Pi adapter has no WebPi surface');
    const nativeSessionId = resumeRegistry.get(record.resumeId)?.agentSessionId
      ?? record.resumeHint?.value;
    if (!nativeSessionId) throw new Error('Pi Session has no resumable native session id');
    const resume = { sessionId: nativeSessionId } as const;
    const { cwd, env } = composeSpawnInputs(meta, adapter, resume, undefined, {
      AQ_SESSION_ID: record.id,
      OPENALICE_RESUME_ID: record.resumeId,
      OPENALICE_SIGNATURE: `@${record.resumeId}`,
    });
    const command = adapter.composeWebCommand(config.command, { cwd, env, resume });
    launcherLogger.event('path.trace', {
      where: 'webpi.spawn',
      wsId: meta.id,
      recordId: record.id,
      resumeId: record.resumeId,
      nativeSessionId,
      spawnCwd: cwd,
      composedCommand: command,
    });
    const snapshot = await webPi.start({
      recordId: record.id,
      wsId: record.wsId,
      resumeId: record.resumeId,
      command,
      cwd,
      env,
    });
    await sessionRegistry.update(record.wsId, record.id, {
      state: 'running',
      surface: 'webpi',
      lastActiveAt: new Date().toISOString(),
    });
    return snapshot;
    } finally {
      operationLease.release();
    }
  };

  const workspaceRuntimeActivityMethod = (workspaceId: string): WorkspaceRuntimeActivity => {
    const sessions = sessionRegistry.listFor(workspaceId).flatMap((record) => {
      const terminal = pool.get(record.id);
      const browser = webPi.get(record.id);
      if (!terminal && !browser) return [];
      return [{
        sessionId: record.id,
        resumeId: record.resumeId,
        name: record.name,
        agent: record.agent,
        surface: terminal ? 'terminal' as const : 'webpi' as const,
        startedAt: terminal?.startedAt ?? browser?.startedAt ?? null,
      }];
    });
    const headless = headlessActivity.list(workspaceId);
    return {
      busy: sessions.length > 0 || headless.length > 0,
      sessions,
      headless,
    };
  };
  const lifecycle = new WorkspaceLifecycleManager({
    launcherRoot: config.launcherRoot,
    registry,
    catalog,
    resumeRegistry,
    sessionRegistry,
    scrollbackStore,
    headlessTasks,
    pool,
    webPi,
    isWorkspaceHeadlessActive: (id) => headlessActivity.has(id),
    operationGuard: workspaceOperationGuard,
    logger: launcherLogger.child({ scope: 'workspace-lifecycle' }),
  });
  await lifecycle.recover();
  const templateUpgrades = new TemplateUpgradeManager({
    registry,
    templates,
    workspaceRuntimeActivity: workspaceRuntimeActivityMethod,
    operationGuard: workspaceOperationGuard,
    logger: launcherLogger.child({ scope: 'template-upgrade' }),
  });
  await templateUpgrades.recover();
  const workspaceAbsorbs = new WorkspaceAbsorbManager({
    registry,
    catalog,
    lifecycle,
    operationGuard: workspaceOperationGuard,
    workspaceRuntimeActivity: workspaceRuntimeActivityMethod,
    logger: launcherLogger.child({ scope: 'workspace-absorb' }),
  });
  await workspaceAbsorbs.recover();
  // Recovery owns the active/departed boundary. Scheduled work must not see an
  // interrupted offboarding/upgrade row between registry load and repair.
  scheduleScanner.start();

  const detectAgents = (): Record<string, AgentAvailability> => {
    const out: Record<string, AgentAvailability> = {};
    const env = { ...process.env, PATH: buildCliPath(process.env) };
    for (const a of adapters.list()) {
      const override = isAgentRuntime(a) ? runtimeInstallOverride(a.id, env) : null;
      if (override) {
        out[a.id] = override;
        continue;
      }
      // No declared binary (shell → `$SHELL`) is always available.
      out[a.id] = a.binary ? detectAgentBinary(a.id, a.binary, { env }) : { installed: true, path: null };
    }
    return out;
  };

  let shuttingDown = false;

  const publicMeta = async (w: WorkspaceMeta): Promise<unknown> => {
    const metadata = await readWorkspaceMetadata(w.dir);
    await sessionRegistry.ensureLoaded(w.id).catch(() => undefined);
    const sessions = sessionRegistry.listFor(w.id).map((r) => {
      const terminal = pool.get(r.id);
      const browser = webPi.get(r.id);
      return {
        id: r.id,
        wsId: r.wsId,
        agent: r.agent,
        name: r.name,
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt,
        state: r.state === 'running' && (terminal || browser) ? 'running' : 'paused',
        surface: browser ? 'webpi' : (r.surface ?? 'terminal'),
        resumeId: r.resumeId,
        pid: terminal?.pid ?? browser?.pid ?? null,
        startedAt: terminal?.startedAt ?? browser?.startedAt ?? null,
        title: r.title ?? null,
        sourceRunId: r.sourceRunId ?? null,
      };
    });
    // Workspace AI provider override signals — read by the Overview
    // dashboard for the "⚙ Workspace override" footer per card. Cheap
    // (single statSync each) so it's safe on the regular list poll.
    const agentOverride = {
      claude: existsSync(join(w.dir, '.claude', 'settings.local.json')),
      codex: existsSync(join(w.dir, '.codex')),
      opencode: existsSync(join(w.dir, 'opencode.json')),
      pi: existsSync(join(w.dir, '.pi-agent')),
    };
    // Version lineage + upgrade hint. Applied template state, not mutable
    // README frontmatter, is authoritative: changing a document is not the
    // same thing as completing a reviewed three-way upgrade.
    let currentVersion: string | undefined;
    let upgradeAvailable: { from: string; to: string } | null = null;
    if (w.template) {
      const tpl = templates.get(w.template);
      if (tpl) {
        currentVersion = await templateUpgrades.currentVersion(w);
        if (
          tpl.upgradeStrategy === 'managed-context'
          && currentVersion
          && compareVersions(tpl.version, currentVersion) > 0
        ) {
          upgradeAvailable = { from: currentVersion, to: tpl.version };
        }
      }
    }
    return {
      ...w,
      ...(metadata.ok ? metadata.metadata : {}),
      ...(!metadata.ok && metadata.reason === 'invalid' ? { metadataError: metadata.error } : {}),
      sessions,
      agentOverride,
      ...(currentVersion !== undefined ? { currentVersion } : {}),
      upgradeAvailable,
    };
  };

  const dispose = async (reason: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    launcherLogger.info('workspaces.dispose', { reason, activeSessions: pool.size() });
    scheduleScanner.stop();
    pool.disposeAll('plugin shutdown');
    await webPi.stopAll('plugin shutdown');
    transcriptWatcher.disposeAll();
  };

  return {
    config,
    registry,
    catalog,
    lifecycle,
    templateUpgrades,
    workspaceAbsorbs,
    operationGuard: workspaceOperationGuard,
    sessionRegistry,
    scrollbackStore,
    templates,
    adapters,
    creator,
    pool,
    webPi,
    transcriptWatcher,
    workspaceRuntimeActivity: workspaceRuntimeActivityMethod,
    resolveOrCreateChatWorkspace: resolveOrCreateChatWorkspaceMethod,
    resolveDefaultAgentId,
    resolveAdapter,
    startWebPiSession,
    publicMeta,
    detectAgents,
    getAgentRuntimeReadiness: getAgentRuntimeReadinessMethod,
    beginAgentRuntimeReadinessProbe: beginAgentRuntimeReadinessProbeMethod,
    probeAgentRuntimeReadiness: probeAgentRuntimeReadinessMethod,
    computeSpawnPlan,
    runHeadlessProbe: runHeadlessProbeMethod,
    runHeadlessTask: runHeadlessTaskMethod,
    dispatchHeadlessTask: dispatchHeadlessTaskMethod,
    scheduleSnapshot,
    issuesSnapshot,
    issueDetail,
    retryIssue,
    sessionDirectory,
    resolveIssuesByName,
    headlessTasks,
    resumeRegistry,
    provenanceStore,
    isResumeActive: (resumeId) => activeResumeIds.has(resumeId),
    claimResume,
    releaseResume: (resumeId) => activeResumeIds.delete(resumeId),
    headlessCapacity: MAX_CONCURRENT_HEADLESS,
    headlessLogsDir,
    isShuttingDown: () => shuttingDown,
    dispose,
  };
}

export type { SessionFactoryContext };

/**
 * Compare two dotted-version strings (e.g. "1.0.0" vs "1.2.3"). Returns
 * 1 if a > b, -1 if a < b, 0 if equal. Non-numeric segments fall back to
 * lexical comparison so a template author who writes `version: 1.0.0-rc1`
 * still gets sensible ordering. Deliberately not pulling in semver — the
 * field is convention, not contract; this is enough to drive a badge.
 */
function compareVersions(a: string, b: string): number {
  const pa = a.split('.');
  const pb = b.split('.');
  const len = Math.max(pa.length, pb.length);
  for (let i = 0; i < len; i++) {
    const sa = pa[i] ?? '0';
    const sb = pb[i] ?? '0';
    const na = Number(sa);
    const nb = Number(sb);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na > nb ? 1 : -1;
    } else {
      if (sa !== sb) return sa > sb ? 1 : -1;
    }
  }
  return 0;
}
