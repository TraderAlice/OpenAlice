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
import { basename, delimiter as pathDelimiter, join } from 'node:path';

import { cliBinPath } from '@/core/paths.js';

import { claudeAdapter } from './adapters/claude.js';
import { codexAdapter } from './adapters/codex.js';
import { opencodeAdapter } from './adapters/opencode.js';
import { piAdapter } from './adapters/pi.js';
import { shellAdapter } from './adapters/shell.js';
import { AdapterRegistry, type CliAdapter } from './cli-adapter.js';
import { loadConfig, type ServerConfig } from './config.js';
import { logger as launcherLogger } from './logger.js';
import { runHeadlessProbe, type HeadlessProbeResult } from './probe.js';
import { runHeadlessTask, type HeadlessTaskResult } from './headless-task.js';
import { HeadlessTaskRegistry } from './headless-task-registry.js';

/** Max concurrent in-flight headless tasks — backstop against unbounded spawn. */
const MAX_CONCURRENT_HEADLESS = 8;

/** Thrown by `dispatchHeadlessTask` when the concurrency cap is hit (→ HTTP 429). */
export class HeadlessCapacityError extends Error {
  constructor(public readonly limit: number) {
    super(`headless capacity reached (${limit} tasks running)`);
    this.name = 'HeadlessCapacityError';
  }
}
import { ScrollbackStore } from './scrollback-store.js';
import { SessionPool, type SessionFactoryContext } from './session-pool.js';
import { SessionRegistry, type SessionRecord } from './session-registry.js';
import { buildSpawnEnv } from './spawn-env.js';
import { readReadmeVersion, TemplateRegistry } from './template-registry.js';
import { TranscriptWatcher } from './transcript-watcher.js';
import { WorkspaceCreator } from './workspace-creator.js';
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
  readonly resumeId: string | null;
  readonly composedCommand: readonly string[];
  readonly spawnCwd: string;
  readonly envPWD: string | null;
  readonly transcriptDir: string | null;
  readonly projectKey: string | null;
}

export interface WorkspaceService {
  readonly config: ServerConfig;
  readonly registry: WorkspaceRegistry;
  readonly sessionRegistry: SessionRegistry;
  readonly scrollbackStore: ScrollbackStore;
  readonly templates: TemplateRegistry;
  readonly adapters: AdapterRegistry;
  readonly creator: WorkspaceCreator;
  readonly pool: SessionPool;
  readonly transcriptWatcher: TranscriptWatcher;
  resolveAdapter(meta: WorkspaceMeta, agentId?: string): CliAdapter;
  publicMeta(w: WorkspaceMeta): Promise<unknown>;
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
   * exit (= done), return exit/duration + output tails. The automation
   * primitive — the agent reports via `inbox_push`; this just waits on exit.
   * Reuses the spawn env/cwd of a fresh interactive spawn (same MCP injection),
   * but is NOT pooled (one-shot, no respawn). Throws if the adapter has no
   * headless mode.
   */
  runHeadlessTask(
    meta: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
  ): Promise<HeadlessTaskResult>;
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
  ): Promise<{ taskId: string }>;
  /** The headless-task management plane (cross-workspace; powers GET /api/headless). */
  headlessTasks: HeadlessTaskRegistry;
  isShuttingDown(): boolean;
  dispose(reason: string): Promise<void>;
}

export interface CreateWorkspaceServiceOptions {
  /** Backend's bound web port — used to derive the CORS allowlist. */
  readonly webPort: number;
  /** Backend's bound MCP port — injected as `OPENALICE_MCP_URL` into each
   *  PTY's env so workspace `mcp.json` templates' `${OPENALICE_MCP_URL:-...}`
   *  fallback bridge resolves to the live backend (not whatever was the
   *  default in template files). */
  readonly mcpPort: number;
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

  const registry = await WorkspaceRegistry.load(
    `${config.launcherRoot}/workspaces.json`,
    launcherLogger.child({ scope: 'registry' }),
  );

  const sessionRegistry = await SessionRegistry.load(
    join(config.launcherRoot, 'state'),
    launcherLogger.child({ scope: 'session-registry' }),
  );

  // The headless-task management plane. load() reconciles leftover `running`
  // records (zombies from a previous Alice life) → `interrupted`.
  const headlessTasks = await HeadlessTaskRegistry.load(
    join(config.launcherRoot, 'state', 'headless-tasks.json'),
    launcherLogger.child({ scope: 'headless-registry' }),
  );

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
      injectMcp: false,
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
    logger: launcherLogger.child({ scope: 'creator' }),
  });

  const transcriptWatcher = new TranscriptWatcher(
    launcherLogger.child({ scope: 'transcript-watch' }),
    sessionRegistry,
  );

  const resolveAdapter = (wsMeta: WorkspaceMeta, agentId?: string): CliAdapter => {
    if (agentId) {
      const a = adapters.get(agentId);
      if (a) return a;
    }
    const fromWorkspace = wsMeta.agents[0];
    if (fromWorkspace) {
      const a = adapters.get(fromWorkspace);
      if (a) return a;
    }
    return adapters.resolve(null);
  };

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
  ): {
    command: readonly string[];
    cwd: string;
    env: Record<string, string>;
    transcriptDir: string | null;
  } => {
    const baseEnv = buildSpawnEnv(process.env, {
      AQ_WS_ID: ws.id,
      AQ_LAUNCHER_REPO_ROOT: config.launcherRepoRoot,
      // Tells workspace templates' `${OPENALICE_MCP_URL:-...}` substitution
      // where to find the backend's MCP endpoint at spawn time. Without
      // this, Claude Code / Codex inside the workspace would fall back to
      // the template-default port literal which may not match the actual
      // backend (guardian can pick a different port if the default is taken).
      OPENALICE_MCP_URL: `http://127.0.0.1:${opts.mcpPort}/mcp`,
      // Prepend the `alice` CLI shim dir so the workspace agent can invoke it
      // from its shell (it reads OPENALICE_MCP_URL + AQ_WS_ID above). Shared
      // script — not written into the workspace, so it never pollutes the
      // workspace's git repo.
      PATH: `${cliBinPath()}${pathDelimiter}${process.env.PATH ?? ''}`,
    }, ws.dir);
    const spawnCtx = {
      ...(resume !== undefined ? { resume } : {}),
      cwd: ws.dir,
      env: baseEnv,
    };
    // Adapter-contributed env (e.g. codex sets CODEX_HOME=<cwd>/.codex so
    // the CLI reads workspace-local config). Merged AFTER baseEnv so the
    // adapter wins on key collisions.
    const adapterEnv = adapter.composeEnv?.(spawnCtx) ?? {};
    const env = { ...baseEnv, ...adapterEnv };
    const command = adapter.composeCommand(config.command, spawnCtx);
    const transcriptDir = adapter.transcriptDir ? adapter.transcriptDir(ws.dir) : null;
    return { command, cwd: ws.dir, env, transcriptDir };
  };

  const computeSpawnPlan = (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
  ): SpawnPlan => {
    const { command, cwd, env, transcriptDir } = composeSpawnInputs(ws, adapter, resume);
    return {
      resumeMode: resume === undefined ? 'fresh' : resume === 'last' ? 'last' : 'by-id',
      resumeId: resume && resume !== 'last' ? resume.sessionId : null,
      composedCommand: command,
      spawnCwd: cwd,
      envPWD: env['PWD'] ?? null,
      transcriptDir,
      projectKey: transcriptDir ? basename(transcriptDir) : null,
    };
  };

  const runHeadlessProbeMethod = async (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    resume: SessionFactoryContext['resume'],
    prompt: string,
    timeoutMs: number,
  ): Promise<HeadlessProbeResult> => {
    const { command, cwd, env, transcriptDir } = composeSpawnInputs(ws, adapter, resume);
    return runHeadlessProbe({
      command,
      cwd,
      env,
      transcriptDir,
      transcriptFileRe: adapter.transcriptFileRe ?? null,
      prompt,
      timeoutMs,
      logger: launcherLogger.child({ scope: 'probe', wsId: ws.id, agent: adapter.id }),
    });
  };

  const runHeadlessTaskMethod = async (
    ws: WorkspaceMeta,
    adapter: CliAdapter,
    prompt: string,
    timeoutMs: number,
  ): Promise<HeadlessTaskResult> => {
    if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
      throw new Error(`adapter "${adapter.id}" has no headless mode`);
    }
    // Reuse a fresh interactive spawn's env/cwd (identical MCP injection),
    // then swap the interactive command for the one-shot headless argv.
    const { cwd, env } = composeSpawnInputs(ws, adapter, undefined);
    const command = adapter.composeHeadlessCommand(config.command, { cwd, env }, prompt);
    return runHeadlessTask({
      command,
      cwd,
      env,
      timeoutMs,
      logger: launcherLogger.child({ scope: 'headless', wsId: ws.id, agent: adapter.id }),
    });
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
  ): Promise<{ taskId: string }> => {
    if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
      throw new Error(`adapter "${adapter.id}" has no headless mode`);
    }
    if (headlessTasks.runningCount() >= MAX_CONCURRENT_HEADLESS) {
      throw new HeadlessCapacityError(MAX_CONCURRENT_HEADLESS);
    }
    const rec = await headlessTasks.create({
      wsId: ws.id,
      agent: adapter.id,
      prompt,
      startedAt: Date.now(),
    });
    // Fire-and-forget: run to natural exit, then fill the record. NOTE: status
    // is judged by exit code — pi can exit 0 on an in-band model error, so
    // "done" means "process exited cleanly", not "the agent succeeded"; the
    // operator confirms via the Inbox / the task's tail.
    void runHeadlessTaskMethod(ws, adapter, prompt, timeoutMs)
      .then((r) =>
        headlessTasks.complete(rec.taskId, {
          status: r.killed ? 'failed' : r.exitCode === 0 ? 'done' : 'failed',
          finishedAt: Date.now(),
          durationMs: r.durationMs,
          exitCode: r.exitCode,
          signal: r.signal,
          killed: r.killed,
        }),
      )
      .catch((err) =>
        headlessTasks.complete(rec.taskId, {
          status: 'failed',
          finishedAt: Date.now(),
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    return { taskId: rec.taskId };
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
      let resume = ctx.resume;
      if (resume === undefined && adapter.capabilities.assignsSessionId) {
        const sessionId = randomUUID();
        resume = { sessionId };
        void sessionRegistry
          .update(wsId, ctx.recordId, { resumeHint: { kind: 'agent-session-id', value: sessionId } })
          .catch((err) =>
            launcherLogger.warn('assigned_session_id.persist_failed', { wsId, recordId: ctx.recordId, err }),
          );
      }
      const { command: composedCommand, env, transcriptDir } = composeSpawnInputs(ws, adapter, resume);

      // path.trace — single line capturing every path the spawn touches. The
      // raison d'être of the workspace-sessions.log file: any two fields that
      // should be equal but aren't are the bug, eyeball-comparable. Keep this
      // verbose; the file is grep-only, not human-tailed.
      launcherLogger.info('path.trace', {
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

  let shuttingDown = false;

  const publicMeta = async (w: WorkspaceMeta): Promise<unknown> => {
    const live = pool.liveSessionsFor(w.id);
    await sessionRegistry.ensureLoaded(w.id).catch(() => undefined);
    const liveById = new Map(live.map((l) => [l.id, l]));
    const sessions = sessionRegistry.listFor(w.id).map((r) => {
      const liveEntry = liveById.get(r.id);
      return {
        id: r.id,
        wsId: r.wsId,
        agent: r.agent,
        name: r.name,
        createdAt: r.createdAt,
        lastActiveAt: r.lastActiveAt,
        state: r.state === 'running' && liveEntry ? 'running' : 'paused',
        agentSessionId: liveEntry?.agentSessionId ?? r.resumeHint?.value ?? null,
        pid: liveEntry?.pid ?? null,
        startedAt: liveEntry?.startedAt ?? null,
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
    // Version lineage + upgrade hint. We read the instance README's
    // frontmatter for the "current" version each list call — cheap (one
    // file read per workspace) and authoritative: the agent self-upgrades
    // by bumping that frontmatter, so reading it live makes the badge
    // disappear without any extra plumbing.
    let currentVersion: string | undefined;
    let upgradeAvailable: { from: string; to: string } | null = null;
    if (w.template) {
      const tpl = templates.get(w.template);
      if (tpl) {
        const instanceReadme = join(w.dir, 'README.md');
        const fromInstance = existsSync(instanceReadme)
          ? await readReadmeVersion(instanceReadme).catch(() => undefined)
          : undefined;
        currentVersion = fromInstance ?? w.spawnedFromVersion;
        // Surface the badge when the template has moved past whatever
        // version the instance self-claims. `compareVersions` returns 1
        // when tpl.version > currentVersion. Missing currentVersion (and
        // no spawnedFromVersion) → no signal, don't guess.
        if (currentVersion && compareVersions(tpl.version, currentVersion) > 0) {
          upgradeAvailable = { from: currentVersion, to: tpl.version };
        }
      }
    }
    return {
      ...w,
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
    pool.disposeAll('plugin shutdown');
    transcriptWatcher.disposeAll();
  };

  return {
    config,
    registry,
    sessionRegistry,
    scrollbackStore,
    templates,
    adapters,
    creator,
    pool,
    transcriptWatcher,
    resolveAdapter,
    publicMeta,
    computeSpawnPlan,
    runHeadlessProbe: runHeadlessProbeMethod,
    runHeadlessTask: runHeadlessTaskMethod,
    dispatchHeadlessTask: dispatchHeadlessTaskMethod,
    headlessTasks,
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
