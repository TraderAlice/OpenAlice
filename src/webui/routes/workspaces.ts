/**
 * Hono routes for the Workspaces feature, mounted at /api/workspaces.
 *
 * Thin adapter over WorkspaceService — each handler dispatches to the same
 * launcher domain modules (registry / pool / creator / sessionRegistry) that
 * the original `server/src/index.ts` `handleHttp` switch did.
 */

import { Hono } from 'hono';
import { readFile } from 'node:fs/promises';
import { join, resolve as resolvePath } from 'node:path';

import { probeByWireShape } from '../../workspaces/agent-probe.js';
import type { WireShape } from '../../ai-providers/preset-catalog.js';

/** A workspace agent's default wire shape when the credential/form doesn't say. */
const DEFAULT_WIRE_BY_AGENT: Record<string, WireShape> = {
  claude: 'anthropic',
  codex: 'openai-responses',
  opencode: 'openai-chat',
  pi: 'openai-chat',
};
import { listDir, PathTraversal, readWorkspaceFile } from '../../workspaces/file-service.js';
import { gitLog, gitStatus } from '../../workspaces/git-service.js';
import { logger as launcherLogger } from '../../workspaces/logger.js';
import { readWorkspaceMetadata, workspaceMetadataSchema, writeWorkspaceMetadata } from '../../workspaces/workspace-metadata.js';
import type { SessionRecord } from '../../workspaces/session-registry.js';
import type { WorkspaceMeta } from '../../workspaces/workspace-registry.js';
import { HeadlessCapacityError, HeadlessResumeError, resumeFromRecord, type SessionFactoryContext, type WorkspaceService } from '../../workspaces/service.js';
import { isAgentRuntime, type CliAdapter, type WorkspaceAiCred } from '../../workspaces/cli-adapter.js';
import { generatePetnameId } from '../../workspaces/petname-id.js';
import { addCredential, readCredentials, setCredentialLastModel, credentialWires, credentialWireShapeEnum, type Credential } from '../../core/config.js';
import { inferCredentialVendor, resolveAnthropicAuthMode } from '../../core/credential-inference.js';
import { compatibleCredentials, matchCredentialByApiKey } from '../../workspaces/credential-injection.js';
import {
  AgentCredentialError,
  ensureAgentCredentialReady,
  getAgentCredentialReadiness,
} from '../../workspaces/agent-credential-readiness.js';
import { isTerminalThemeVariant, type TerminalThemeVariant } from '../../workspaces/terminal-theme.js';
import {
  readQuickChatPreferences,
  rememberRecentChatWorkspace,
  type QuickChatPreferences,
} from '../../core/preferences.js';
import { CHAT_WORKSPACE_TEMPLATE } from '../../workspaces/chat-workspace-resolver.js';

// The spawn body's `resume` value is an AGENT-side session id, whose shape is
// adapter-native: uuid for claude/codex/pi, `ses_<base62>` for opencode. This
// looser shape applies ONLY to the resume intent passed through to the adapter's
// own resume flag; launcher-side record ids use `validId`.
const AGENT_SESSION_ID_RE = /^[A-Za-z0-9_.-]{8,128}$/;

/** Upper bound on a quick-chat seed prompt — matches the headless-dispatch cap. */
const MAX_SEED_PROMPT = 16000;

// In-flight resume coalescing, keyed `${wsId}::${recordId}`. A frontend
// double-fire (two POST /resume within ms — ANG-120) would otherwise both pass
// the "already running?" gate while the session is still paused and each call
// pool.spawn() → two agent processes racing on one transcript. Later callers
// await the in-flight resume; the in-lock pool.get() re-check then yields
// alreadyRunning instead of a second spawn.
const resumeInFlight = new Map<string, Promise<unknown>>();

/** The template quick-chat reuses-or-creates its workspace from. */
interface QuickChatWorkspacePreferenceDeps {
  readQuickChatPreferences(): Promise<QuickChatPreferences>;
  rememberRecentChatWorkspace(workspaceId: string | null): Promise<QuickChatPreferences>;
}

const defaultQuickChatWorkspacePreferenceDeps: QuickChatWorkspacePreferenceDeps = {
  readQuickChatPreferences: () => readQuickChatPreferences(),
  rememberRecentChatWorkspace: (workspaceId) => rememberRecentChatWorkspace(workspaceId),
};

/**
 * Validate an optional quick-chat seed prompt (the first message a fresh
 * interactive TUI opens already working on). Returns the trimmed prompt, `null`
 * when absent/blank (→ a normal unseeded fresh spawn), or a `{error}` to surface
 * as a 400. Mirrors the headless-dispatch validation so the interactive-seed and
 * one-shot paths agree on shape + cap.
 */
function parseSeedPrompt(
  raw: unknown,
): { prompt: string } | { error: string; message: string } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'string') {
    return { error: 'bad_request', message: 'initialPrompt must be a string' };
  }
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_SEED_PROMPT) {
    return { error: 'prompt_too_long', message: `max ${MAX_SEED_PROMPT} chars` };
  }
  return { prompt: trimmed };
}

function parseTerminalThemeField(raw: unknown): TerminalThemeVariant | { error: string; message: string } | undefined {
  if (raw === undefined) return undefined;
  if (isTerminalThemeVariant(raw)) return raw;
  return { error: 'bad_request', message: 'terminalTheme must be "light" or "dark"' };
}

/** Max stored length of a session title (the seed message); the row truncates further. */
const MAX_SESSION_TITLE = 200;

/** The 201 body both `/:id/sessions/spawn` and `/quick-chat` return. */
interface SpawnedSessionBody {
  readonly sessionId: string;
  readonly wsId: string;
  readonly name: string;
  readonly pid: number;
  readonly agent: string;
  readonly resumeId: string;
  readonly startedAt: number;
  /** The seed message, when the session was seeded — its sidebar title. */
  readonly title: string | null;
}

interface PublicSessionBody {
  readonly id: string;
  readonly wsId: string;
  readonly agent: string;
  readonly name: string;
  readonly createdAt: string;
  readonly lastActiveAt: string;
  readonly state: 'running' | 'paused';
  readonly resumeId: string;
  readonly pid: number | null;
  readonly startedAt: number | null;
  readonly title: string | null;
  readonly sourceRunId: string | null;
}

type OpenHeadlessSessionResult =
  | { readonly ok: true; readonly created: boolean; readonly session: PublicSessionBody }
  | { readonly ok: false; readonly status: 400 | 404 | 409 | 500; readonly body: { error: string; message?: string } };

type SpawnSessionResult =
  | { readonly ok: true; readonly session: SpawnedSessionBody }
  | { readonly ok: false; readonly status: number; readonly body: { error: string; message?: string } };

export function createWorkspaceRoutes(
  svc: WorkspaceService,
  quickChatPreferences: QuickChatWorkspacePreferenceDeps = defaultQuickChatWorkspacePreferenceDeps,
): Hono {
  const app = new Hono();
  const headlessSessionInFlight = new Map<string, Promise<OpenHeadlessSessionResult>>();

  /**
   * Spawn one interactive PTY session in an existing workspace — the shared
   * core of `POST /:id/sessions/spawn` and `POST /quick-chat` (so the two never
   * drift on bootstrap / record-creation / pool-spawn). Resolves the adapter,
   * runs its bootstrap, pre-allocates the SessionRecord, and hands the
   * SessionFactoryContext (incl. the optional fresh-spawn `initialPrompt`) to
   * the pool. Returns the SpawnedSession body or an HTTP-mappable error.
   */
  async function spawnInteractiveSession(
    meta: WorkspaceMeta,
    opts: {
      readonly agentId?: string;
      readonly resume?: SessionFactoryContext['resume'];
      /** Product-level conversation id. Resolved to a native id only here. */
      readonly resumeId?: string;
      readonly initialPrompt?: string;
      readonly title?: string;
      readonly sourceRunId?: string;
      readonly credentialSlug?: string;
      readonly terminalTheme?: TerminalThemeVariant;
    },
  ): Promise<SpawnSessionResult> {
    const id = meta.id;
    const initialPrompt = opts.initialPrompt;
    let resume = opts.resume;
    const requestedIdentity = opts.resumeId ? svc.resumeRegistry.get(opts.resumeId) : null;
    if (opts.resumeId && !requestedIdentity) {
      return { ok: false, status: 404, body: { error: 'resume_not_found' } };
    }
    if (requestedIdentity && requestedIdentity.wsId !== id) {
      return { ok: false, status: 400, body: { error: 'resume_wrong_workspace' } };
    }
    if (requestedIdentity && !requestedIdentity.agentSessionId) {
      return { ok: false, status: 409, body: { error: 'resume_not_ready', message: 'runtime session id has not been captured yet' } };
    }
    if (opts.resumeId && svc.isResumeActive?.(opts.resumeId)) {
      return { ok: false, status: 409, body: { error: 'resume_busy', message: 'this conversation already has a running turn' } };
    }
    if (requestedIdentity?.agentSessionId) resume = { sessionId: requestedIdentity.agentSessionId };
    const agentId = opts.agentId ?? requestedIdentity?.agent ?? await svc.resolveDefaultAgentId(meta);
    if (!agentId) {
      return { ok: false, status: 400, body: { error: 'no_agent_runtime', message: 'workspace has no agent runtime enabled' } };
    }
    if (!svc.adapters.get(agentId)) {
      return { ok: false, status: 400, body: { error: 'unknown_agent', message: `no adapter: ${agentId}` } };
    }
    const adapter = svc.resolveAdapter(meta, agentId);
    if (requestedIdentity && requestedIdentity.agent !== adapter.id) {
      return { ok: false, status: 400, body: { error: 'resume_wrong_agent' } };
    }
    const runtimeReadiness = svc.getAgentRuntimeReadiness().agents[adapter.id];
    const runtimeIsGloballyReady =
      runtimeReadiness?.ready === true &&
      (runtimeReadiness.source === 'global-config' ||
        runtimeReadiness.source === 'global-login' ||
        runtimeReadiness.source === 'managed-runtime');
    try {
      if (!runtimeIsGloballyReady) {
        await ensureAgentCredentialReady({
          meta,
          agentId: adapter.id,
          adapter,
          ...(opts.credentialSlug ? { pickedCredentialSlug: opts.credentialSlug } : {}),
          logger: launcherLogger,
        });
      }
    } catch (err) {
      if (err instanceof AgentCredentialError) {
        return { ok: false, status: 400, body: err.toBody() };
      }
      launcherLogger.warn('agent_cred.ensure_failed', { id, agent: adapter.id, err });
      return { ok: false, status: 500, body: { error: 'agent_credential_failed', message: (err as Error).message } };
    }
    try {
      if (adapter.bootstrap) {
        await adapter.bootstrap({ wsId: id, cwd: meta.dir, launcherRepoRoot: svc.config.launcherRepoRoot });
      }
    } catch (err) {
      launcherLogger.error('adapter.bootstrap_failed', { id, agent: adapter.id, err });
      return { ok: false, status: 500, body: { error: 'bootstrap_failed', message: (err as Error).message } };
    }
    await svc.sessionRegistry.ensureLoaded(id);
    const prefix = adapter.namePrefix ?? adapter.id[0] ?? 's';
    const recordId = generatePetnameId(adapter.id, {
      fallbackPrefix: 'session',
      isTaken: (candidate) =>
        svc.sessionRegistry.findById(candidate) !== undefined ||
        svc.pool.get(candidate) !== undefined,
    });
    const recordName = svc.sessionRegistry.nextName(id, adapter.id, prefix);
    const nowIso = new Date().toISOString();
    const titleSource = opts.title?.trim() || initialPrompt;
    const title = titleSource ? titleSource.slice(0, MAX_SESSION_TITLE) : undefined;
    const claimedResume = opts.resumeId
      ? (svc.claimResume?.(opts.resumeId) ?? true)
      : false;
    if (opts.resumeId && !claimedResume) {
      return { ok: false, status: 409, body: { error: 'resume_busy', message: 'this conversation already has a running turn' } };
    }
    const releaseClaim = () => {
      if (claimedResume && opts.resumeId) svc.releaseResume?.(opts.resumeId);
    };
    let identity: { resumeId: string };
    try {
      identity = await svc.resumeRegistry.ensure({
        ...(opts.resumeId ? { resumeId: opts.resumeId } : {}),
        wsId: id,
        agent: adapter.id,
        ...(resume && resume !== 'last' ? { agentSessionId: resume.sessionId } : {}),
      });
    } catch (err) {
      releaseClaim();
      return { ok: false, status: 500, body: { error: 'resume_registry_failed', message: (err as Error).message } };
    }
    const record: SessionRecord = {
      id: recordId,
      resumeId: identity.resumeId,
      wsId: id,
      agent: adapter.id,
      name: recordName,
      createdAt: nowIso,
      lastActiveAt: nowIso,
      state: 'running',
      ...(title !== undefined ? { title } : {}),
      ...(opts.sourceRunId ? { sourceRunId: opts.sourceRunId } : {}),
      ...(resume && resume !== 'last'
        ? { resumeHint: { kind: 'agent-session-id' as const, value: resume.sessionId } }
        : {}),
    };
    try {
      await svc.sessionRegistry.create(record);
    } catch (err) {
      releaseClaim();
      launcherLogger.error('session_registry.create_failed', { id, recordId, err });
      return { ok: false, status: 500, body: { error: 'registry_failed', message: (err as Error).message } };
    }
    try {
      const ctx: SessionFactoryContext = {
        ...(resume !== undefined ? { resume } : {}),
        agentId,
        ...(initialPrompt !== undefined ? { initialPrompt } : {}),
        ...(opts.terminalTheme !== undefined ? { terminalTheme: opts.terminalTheme } : {}),
        recordId,
        recordName,
      };
      const session = svc.pool.spawn(id, ctx);
      launcherLogger.info('workspace.session_spawned', {
        id,
        sessionId: session.recordId,
        name: session.name,
        pid: session.pid,
        agent: adapter.id,
        resume: resume === undefined ? null : resume === 'last' ? 'last' : resume.sessionId,
        seeded: resume === undefined && !!initialPrompt,
      });
      releaseClaim();
      return {
        ok: true,
        session: {
          sessionId: session.recordId,
          wsId: session.wsId,
          name: session.name,
          pid: session.pid,
          agent: adapter.id,
          resumeId: identity.resumeId,
          startedAt: session.startedAt,
          title: title ?? null,
        },
      };
    } catch (err) {
      releaseClaim();
      await svc.sessionRegistry.remove(id, recordId).catch(() => undefined);
      launcherLogger.error('workspace.session_spawn_failed', { id, err });
      return { ok: false, status: 500, body: { error: 'spawn_failed', message: (err as Error).message } };
    }
  }

  const publicSession = (record: SessionRecord): PublicSessionBody => {
    const live = svc.pool.get(record.id);
    return {
      id: record.id,
      wsId: record.wsId,
      agent: record.agent,
      name: record.name,
      createdAt: record.createdAt,
      lastActiveAt: record.lastActiveAt,
      state: record.state === 'running' && live ? 'running' : 'paused',
      resumeId: record.resumeId,
      pid: live?.pid ?? null,
      startedAt: live?.startedAt ?? null,
      title: record.title ?? null,
      sourceRunId: record.sourceRunId ?? null,
    };
  };

  const mappedResumeForRecord = (
    record: SessionRecord,
    adapter: CliAdapter,
  ): SessionFactoryContext['resume'] => {
    const nativeId = svc.resumeRegistry.get(record.resumeId)?.agentSessionId;
    return nativeId && adapter.capabilities.resumeById
      ? { sessionId: nativeId }
      : resumeFromRecord(record, adapter);
  };

  const openResumeAsSession = async (
    meta: WorkspaceMeta,
    resumeId: string,
    title?: string,
  ): Promise<OpenHeadlessSessionResult> => {
    await svc.sessionRegistry.ensureLoaded(meta.id);
    const existing = svc.sessionRegistry.findByResumeId(meta.id, resumeId);
    if (existing) return { ok: true, created: false, session: publicSession(existing) };
    const identity = svc.resumeRegistry.get(resumeId);
    if (!identity || identity.wsId !== meta.id) return { ok: false, status: 404, body: { error: 'resume_not_found' } };
    const task = identity.latestTaskId ? svc.headlessTasks.get(identity.latestTaskId) : null;
    if (task?.status === 'running') {
      return {
        ok: false,
        status: 409,
        body: { error: 'run_still_running', message: 'wait for the headless run to finish before continuing it interactively' },
      };
    }

    if (!identity.agentSessionId) {
      return {
        ok: false,
        status: 409,
        body: { error: 'session_unavailable', message: 'this run did not capture a resumable agent session id' },
      };
    }
    const adapter = svc.adapters.get(identity.agent);
    if (!adapter || !adapter.capabilities.resumeById) {
      return {
        ok: false,
        status: 409,
        body: { error: 'resume_unsupported', message: `${identity.agent} cannot resume this conversation` },
      };
    }

    const spawned = await spawnInteractiveSession(meta, {
      agentId: identity.agent,
      resumeId,
      title: task?.prompt ?? title ?? `Conversation ${resumeId}`,
      ...(task ? { sourceRunId: task.taskId } : {}),
    });
    if (!spawned.ok) {
      return {
        ok: false,
        status: spawned.status === 400 ? 400 : 500,
        body: spawned.body,
      };
    }
    const record = svc.sessionRegistry.get(meta.id, spawned.session.sessionId);
    if (!record) {
      return { ok: false, status: 500, body: { error: 'registry_failed', message: 'spawned session record is missing' } };
    }
    return { ok: true, created: true, session: publicSession(record) };
  };

  const rememberRecentChat = async (meta: WorkspaceMeta): Promise<void> => {
    if (meta.template !== CHAT_WORKSPACE_TEMPLATE) return;
    try {
      await quickChatPreferences.rememberRecentChatWorkspace(meta.id);
    } catch (err) {
      launcherLogger.warn('quick_chat.preference_write_failed', { id: meta.id, err });
    }
  };

  // Detect which vault credential a workspace's loginless agent is currently
  // configured with (null when none / hand-edited). The "which cred is this
  // workspace using" probe the overwrite-notice and reuse-default both build on.
  const detectWorkspaceCred = async (
    meta: WorkspaceMeta,
    agentId: string,
    credentials: Record<string, Credential>,
  ): Promise<{ slug: string; model: string | null } | null> => {
    const adapter = svc.adapters.get(agentId);
    if (!adapter?.readAiConfig) return null;
    const cfg = await adapter.readAiConfig(meta.dir).catch(() => null);
    if (!cfg) return null;
    const slug = matchCredentialByApiKey(credentials, cfg.apiKey);
    return slug ? { slug, model: cfg.model ?? null } : null;
  };

  // ── templates / agents ───────────────────────────────────────────────────

  app.get('/templates', (c) => {
    return c.json({
      templates: svc.templates.list().map((t) => ({
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        ...(t.displayName !== undefined ? { displayName: t.displayName } : {}),
        ...(t.groupOrder !== undefined ? { groupOrder: t.groupOrder } : {}),
        ...(t.community !== undefined ? { community: t.community } : {}),
        defaultAgents: t.defaultAgents,
        version: t.version,
        hasReadme: t.readmePath !== undefined,
      })),
    });
  });

  // Raw README markdown (frontmatter included — the client strips it before
  // rendering). 404 when the template doesn't ship a README yet; we don't
  // synthesize a placeholder. Cheap on-demand disk read, no cache.
  app.get('/templates/:name/readme', async (c) => {
    const name = c.req.param('name');
    const tpl = svc.templates.get(name);
    if (!tpl) return c.json({ error: 'unknown_template' }, 404);
    if (!tpl.readmePath) return c.json({ error: 'no_readme' }, 404);
    try {
      const raw = await readFile(tpl.readmePath, 'utf8');
      return c.body(raw, 200, { 'content-type': 'text/markdown; charset=utf-8' });
    } catch (err) {
      launcherLogger.warn('template.readme_read_failed', { name, err });
      return c.json({ error: 'read_failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/agents', (c) => {
    // Probe the host PATH so the frontend can mark missing runtimes and guide
    // the user to install them — registration ≠ installed (see agent-detect.ts).
    const availability = svc.detectAgents();
    return c.json({
      agents: svc.adapters.list().map((a) => {
        const av = availability[a.id];
        return {
          id: a.id,
          displayName: a.displayName,
          kind: isAgentRuntime(a) ? 'agent' : 'utility',
          capabilities: a.capabilities,
          installed: av?.installed ?? true,
          binPath: av?.path ?? null,
        };
      }),
    });
  });

  app.get('/agent-runtime-readiness', (c) => {
    return c.json(svc.getAgentRuntimeReadiness());
  });

  app.post('/agent-runtime-readiness/probe', async (c) => {
    const body = await safeJson(c).catch(() => null);
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const rawAgent = fields['agent'];
    let agent: string | undefined;
    if (rawAgent !== undefined) {
      if (typeof rawAgent !== 'string' || rawAgent.length === 0) {
        return c.json({ error: 'bad_request', message: 'agent must be a non-empty string' }, 400);
      }
      const adapter = svc.adapters.get(rawAgent);
      if (!adapter || !isAgentRuntime(adapter)) {
        return c.json({ error: 'unknown_agent', message: `no agent runtime: ${rawAgent}` }, 400);
      }
      agent = rawAgent;
    }
    try {
      return c.json(await svc.probeAgentRuntimeReadiness(agent));
    } catch (err) {
      launcherLogger.warn('agent_runtime_readiness.probe_failed', { agent, err });
      return c.json(
        { error: 'runtime_readiness_probe_failed', message: (err as Error).message },
        500,
      );
    }
  });

  // ── workspaces collection ────────────────────────────────────────────────

  app.get('/', async (c) => {
    const workspaces = await Promise.all(svc.registry.list().map((w) => svc.publicMeta(w)));
    return c.json({ workspaces });
  });

  app.post('/', async (c) => {
    const body = await safeJson(c);
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const tag = fields['tag'];
    if (typeof tag !== 'string') {
      return c.json({ error: 'tag_required' }, 400);
    }
    const rawTemplate = fields['template'];
    let templateName: string;
    if (typeof rawTemplate === 'string' && rawTemplate.length > 0) {
      templateName = rawTemplate;
    } else {
      const def = svc.templates.defaultName();
      if (!def) {
        return c.json({
          error: 'no_templates_configured',
          message: 'no templates discovered; set AQ_TEMPLATES_DIR or AQ_BOOTSTRAP_SCRIPT',
        }, 500);
      }
      templateName = def;
    }
    const rawAgents = fields['agents'];
    const agentsRequested = Array.isArray(rawAgents)
      ? rawAgents.filter((a): a is string => typeof a === 'string' && a.length > 0)
      : undefined;
    const result = await svc.creator.create(
      tag,
      templateName,
      agentsRequested && agentsRequested.length > 0 ? agentsRequested : undefined,
    );
    if (!result.ok) {
      const status =
        result.code === 'invalid_tag' ? 400
        : result.code === 'unknown_template' ? 400
        : result.code === 'unknown_agent' ? 400
        : result.code === 'tag_in_use' ? 409
        : 500;
      return c.json({
        error: result.code,
        message: result.message,
        stderr: 'stderr' in result && result.stderr ? result.stderr.slice(-4000) : undefined,
      }, status);
    }
    return c.json({ workspace: await svc.publicMeta(result.workspace) }, 201);
  });

  app.patch('/:id/metadata', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);

    const body = await safeJson(c);
    const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    const current = await readWorkspaceMetadata(meta.dir);
    const nextObj: Record<string, unknown> = current.ok ? { ...current.metadata } : {};
    if ('displayName' in fields) {
      const v = fields['displayName'];
      if (v === null) delete nextObj['displayName'];
      else nextObj['displayName'] = v;
    }
    if ('description' in fields) {
      const v = fields['description'];
      if (v === null) delete nextObj['description'];
      else nextObj['description'] = v;
    }
    const next = workspaceMetadataSchema.safeParse(nextObj);
    if (!next.success) {
      return c.json({
        error: 'invalid_metadata',
        message: next.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
      }, 400);
    }
    try {
      await writeWorkspaceMetadata(meta.dir, next.data);
      launcherLogger.info('workspace.metadata_saved', { id });
      return c.json({ workspace: await svc.publicMeta(meta) });
    } catch (err) {
      if (err instanceof PathTraversal) return c.json({ error: 'invalid_path' }, 400);
      launcherLogger.warn('workspace.metadata_write_failed', { id, err });
      return c.json({ error: 'write_failed', message: (err as Error).message }, 500);
    }
  });

  // ── single workspace (DELETE + git/files sub-resources) ──────────────────

  app.delete('/:id', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const purge = c.req.query('purge') === 'true';
    svc.pool.dispose(id, 'workspace deleted');
    const removed = await svc.registry.remove(id);
    if (!removed) return c.json({ error: 'not_found' }, 404);
    const droppedRecords = await svc.sessionRegistry
      .removeAllFor(id)
      .catch((err) => {
        launcherLogger.warn('session_registry.remove_all_failed', { id, err });
        return [] as readonly SessionRecord[];
      });
    await svc.scrollbackStore.removeAllFor(id);
    let purged = false;
    if (purge) {
      try {
        const { rm } = await import('node:fs/promises');
        await rm(removed.dir, { recursive: true, force: true });
        purged = true;
      } catch (err) {
        launcherLogger.error('workspace.purge_failed', { id, dir: removed.dir, err });
      }
    }
    launcherLogger.info('workspace.removed', {
      id,
      dir: removed.dir,
      purged,
      droppedSessions: droppedRecords.length,
    });
    return c.json({ ok: true, purged });
  });

  app.get('/:id/git/log', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    const limitRaw = Number.parseInt(c.req.query('limit') ?? '30', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 30;
    try {
      const entries = await gitLog(meta.dir, limit);
      return c.json({ entries });
    } catch (err) {
      launcherLogger.warn('git.log_failed', { id, err });
      return c.json({ error: 'git_failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/:id/git/status', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    try {
      const status = await gitStatus(meta.dir);
      return c.json(status);
    } catch (err) {
      launcherLogger.warn('git.status_failed', { id, err });
      return c.json({ error: 'git_failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/:id/files', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    const p = c.req.query('path') ?? '';
    try {
      const listing = await listDir(meta.dir, p);
      return c.json(listing);
    } catch (err) {
      if (err instanceof PathTraversal) {
        return c.json({ error: 'invalid_path', message: err.message }, 400);
      }
      launcherLogger.warn('files.list_failed', { id, path: p, err });
      return c.json({ error: 'list_failed', message: (err as Error).message }, 500);
    }
  });

  /**
   * Read a single UTF-8 text file from inside a workspace. Used by the
   * Inbox detail pane to render `docs` pointers live (no snapshot — the
   * workspace folder is the source of truth, see InboxStore doc).
   *
   * 404 when the workspace or the file is missing — callers (Inbox UI)
   * use this to render tombstone states. Larger than 1 MiB returns 413
   * so the inbox can't be weaponised into a large-file viewer.
   */
  app.get('/:id/file', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
    const p = c.req.query('path') ?? '';
    if (!p) return c.json({ error: 'path required' }, 400);
    try {
      const content = await readWorkspaceFile(meta.dir, p);
      if (content === null) return c.json({ error: 'file_not_found' }, 404);
      if (content.length > 1024 * 1024) {
        return c.json({ error: 'file_too_large', sizeBytes: content.length }, 413);
      }
      return c.json({ path: p, content });
    } catch (err) {
      if (err instanceof PathTraversal) {
        return c.json({ error: 'invalid_path', message: err.message }, 400);
      }
      launcherLogger.warn('files.read_failed', { id, path: p, err });
      return c.json({ error: 'read_failed', message: (err as Error).message }, 500);
    }
  });

  // ── sessions ─────────────────────────────────────────────────────────────

  // Materialize one product-owned conversation as a stable interactive
  // Session. The frontend supplies only resumeId; native CLI ids stay in the
  // backend ResumeRegistry.
  app.post('/:id/resumes/:resumeId/session', async (c) => {
    const id = c.req.param('id');
    const resumeId = c.req.param('resumeId');
    if (!validId(id) || !validId(resumeId)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
    const body = await safeJson(c).catch(() => null);
    const fields = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const title = typeof fields['title'] === 'string' ? fields['title'] : undefined;
    const key = `${id}::${resumeId}`;
    let run = headlessSessionInFlight.get(key);
    if (!run) {
      run = openResumeAsSession(meta, resumeId, title);
      headlessSessionInFlight.set(key, run);
    }
    try {
      const result = await run;
      if (!result.ok) return c.json(result.body, result.status);
      return c.json({ session: result.session, created: result.created }, result.created ? 201 : 200);
    } finally {
      if (headlessSessionInFlight.get(key) === run) headlessSessionInFlight.delete(key);
    }
  });

  // Compatibility route for bookmarked task links. It resolves taskId to the
  // product resumeId server-side and never accepts a native session id.
  app.post('/:id/headless/:taskId/session', async (c) => {
    const id = c.req.param('id');
    const taskId = c.req.param('taskId');
    if (!validId(id) || !validId(taskId)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);

    const task = svc.headlessTasks.get(taskId);
    if (!task || task.wsId !== id) return c.json({ error: 'run_not_found' }, 404);
    const body = await safeJson(c).catch(() => null);
    const fields = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const title = typeof fields['title'] === 'string' ? fields['title'] : undefined;

    const key = `${id}::${taskId}`;
    let run = headlessSessionInFlight.get(key);
    if (!run) {
      run = openResumeAsSession(meta, task.resumeId, title);
      headlessSessionInFlight.set(key, run);
    }
    try {
      const result = await run;
      if (!result.ok) return c.json(result.body, result.status);
      return c.json(
        { session: result.session, created: result.created },
        result.created ? 201 : 200,
      );
    } finally {
      if (headlessSessionInFlight.get(key) === run) headlessSessionInFlight.delete(key);
    }
  });

  app.post('/:id/sessions/spawn', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);

    let resumeId: string | undefined;
    let agentId: string | undefined;
    let initialPrompt: string | undefined;
    let credentialSlug: string | undefined;
    let terminalTheme: TerminalThemeVariant | undefined;
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const rawResumeId = fields['resumeId'];
      if (typeof rawResumeId === 'string' && validId(rawResumeId)) resumeId = rawResumeId;
      const rawAgent = fields['agent'];
      if (typeof rawAgent === 'string' && rawAgent.length > 0) agentId = rawAgent;
      const rawSlug = fields['credentialSlug'];
      if (typeof rawSlug === 'string' && rawSlug.length > 0) credentialSlug = rawSlug;
      const theme = parseTerminalThemeField(fields['terminalTheme']);
      if (theme && typeof theme === 'object' && 'error' in theme) return c.json(theme, 400);
      terminalTheme = theme;
      // Quick-chat seed (fresh-only): a first message the TUI opens already
      // working on. Ignored when resuming — seeding + resume is ambiguous on
      // codex's `resume <id>` / pi's `--session-id`.
      const seed = parseSeedPrompt(fields['initialPrompt']);
      if (seed && 'error' in seed) return c.json(seed, 400);
      if (seed && resumeId === undefined) initialPrompt = seed.prompt;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    const result = await spawnInteractiveSession(meta, {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(resumeId !== undefined ? { resumeId } : {}),
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
      ...(credentialSlug !== undefined ? { credentialSlug } : {}),
      ...(terminalTheme !== undefined ? { terminalTheme } : {}),
    });
    if (!result.ok) return c.json(result.body, result.status as 400 | 500);
    return c.json(result.session, 201);
  });

  // Quick-chat launch — the "type a message → you're in" front door, decoupled
  // from the explicit create-workspace UI. Enters the recent Chat workspace (or
  // creates one stable starter workspace when none exists), then spawns a fresh
  // interactive session seeded with the user's first message. One POST returns
  // both workspace and live session so the client can enter the TUI directly.
  // Body: { prompt: string; agent?: string }
  app.post('/quick-chat', async (c) => {
    let prompt: string;
    let agentId: string | undefined;
    let credentialSlug: string | undefined;
    let targetWsId: string | undefined;
    let terminalTheme: TerminalThemeVariant | undefined;
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const seed = parseSeedPrompt(fields['prompt']);
      if (seed === null) return c.json({ error: 'prompt_required' }, 400);
      if ('error' in seed) return c.json(seed, 400);
      prompt = seed.prompt;
      const rawAgent = fields['agent'];
      if (typeof rawAgent === 'string' && rawAgent.length > 0) agentId = rawAgent;
      // Optional: which vault credential to seed a loginless runtime with. Only
      // consulted for opencode/pi; claude/codex ignore it (own login).
      const rawSlug = fields['credentialSlug'];
      if (typeof rawSlug === 'string' && rawSlug.length > 0) credentialSlug = rawSlug;
      // Optional: spawn into THIS existing workspace instead of today's. The
      // chat sidebar's per-workspace "+" ("Ask Alice, but in this workspace").
      const rawTarget = fields['targetWsId'];
      if (typeof rawTarget === 'string' && rawTarget.length > 0) targetWsId = rawTarget;
      const theme = parseTerminalThemeField(fields['terminalTheme']);
      if (theme && typeof theme === 'object' && 'error' in theme) return c.json(theme, 400);
      terminalTheme = theme;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }

    // Each send is a new Session in a durable Chat Workspace. The explicit
    // target wins; otherwise the resolver uses recentChatWorkspaceId, falls back
    // to the most recently active Chat workspace, and creates only when none
    // exists. The gate prevents concurrent first launches from double-bootstrap.
    let meta: WorkspaceMeta;
    if (targetWsId) {
      // Targeted: spawn a new session into the given existing workspace.
      const found = svc.registry.list().find((w) => w.id === targetWsId);
      if (!found) return c.json({ error: 'workspace_not_found' }, 404);
      meta = found;
      await rememberRecentChat(meta);
    } else {
      const preference = await quickChatPreferences.readQuickChatPreferences().catch((err) => {
        launcherLogger.warn('quick_chat.preference_read_failed', { err });
        return null;
      });
      const target = await svc.resolveOrCreateChatWorkspace(
        preference?.recentChatWorkspaceId,
      );
      if (!target.ok) {
        const status =
          target.code === 'tag_in_use' ? 409
          : target.code === 'unknown_template' ? 400
          : target.code === 'invalid_tag' ? 400
          : target.code === 'unknown_agent' ? 400
          : 500;
        launcherLogger.error('quick_chat.create_failed', {
          code: target.code,
          message: target.message,
        });
        return c.json(
          { error: target.code, message: target.message },
          status as 400 | 409 | 500,
        );
      }
      meta = target.workspace;
      await rememberRecentChat(meta);
    }

    const spawn = await spawnInteractiveSession(meta, {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(credentialSlug !== undefined ? { credentialSlug } : {}),
      ...(terminalTheme !== undefined ? { terminalTheme } : {}),
      initialPrompt: prompt,
    });
    if (!spawn.ok) return c.json(spawn.body, spawn.status as 400 | 500);
    return c.json({ workspace: await svc.publicMeta(meta), session: spawn.session }, 201);
  });

  // pause / stop (alias)
  for (const action of ['pause', 'stop'] as const) {
    app.post(`/:id/sessions/:sid/${action}`, async (c) => {
      const id = c.req.param('id');
      const token = c.req.param('sid');
      if (!validId(id) || !validId(token)) {
        return c.json({ error: 'not_found' }, 404);
      }
      const record = svc.sessionRegistry.get(id, token);
      const live = svc.pool.get(token);
      if (!record && !live) return c.json({ error: 'not_found' }, 404);

      let scrollbackRel: string | null = null;
      if (record?.agent === 'shell' && live) {
        try {
          const dump = live.dumpReplayBuffer();
          if (dump.length > 0) {
            scrollbackRel = await svc.scrollbackStore.dump(id, token, dump);
          }
        } catch (err) {
          launcherLogger.warn('scrollback.dump_failed', { id, token, err });
        }
      }
      const wasRunning = svc.pool.disposeToken(token, action === 'pause' ? 'paused' : 'tab stop');
      if (record) {
        const patch: Partial<SessionRecord> = {
          state: 'paused',
          lastActiveAt: new Date().toISOString(),
        };
        if (scrollbackRel) patch.scrollbackFile = scrollbackRel;
        await svc.sessionRegistry
          .update(id, token, patch)
          .catch((err) =>
            launcherLogger.warn('session_registry.pause_update_failed', { id, token, err }),
          );
      }
      launcherLogger.info('workspace.session_paused', {
        id,
        sessionId: token,
        wasRunning,
        via: action,
        scrollback: scrollbackRel ?? null,
      });
      return c.json({ ok: true, wasRunning });
    });
  }

  app.post('/:id/sessions/:sid/resume', async (c) => {
    const id = c.req.param('id');
    const token = c.req.param('sid');
    if (!validId(id) || !validId(token)) {
      return c.json({ error: 'not_found' }, 404);
    }
    let terminalTheme: TerminalThemeVariant | undefined;
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const theme = parseTerminalThemeField(fields['terminalTheme']);
      if (theme && typeof theme === 'object' && 'error' in theme) return c.json(theme, 400);
      terminalTheme = theme;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    // Serialize concurrent resumes of this record (ANG-120 — see resumeInFlight).
    // A later double-fire awaits the in-flight resume, then doResume()'s in-lock
    // pool.get() re-check short-circuits it to alreadyRunning instead of spawning
    // a second agent on the same transcript.
    const lockKey = `${id}::${token}`;
    const inFlight = resumeInFlight.get(lockKey);
    if (inFlight) await inFlight.catch(() => undefined);
    const run = doResume();
    resumeInFlight.set(lockKey, run);
    try {
      return await run;
    } finally {
      if (resumeInFlight.get(lockKey) === run) resumeInFlight.delete(lockKey);
    }

    async function doResume() {
      const record = svc.sessionRegistry.get(id, token);
      if (!record) return c.json({ error: 'not_found' }, 404);
      if (svc.isResumeActive?.(record.resumeId)) {
        return c.json({ error: 'resume_busy', message: 'this conversation already has a running headless turn' }, 409);
      }
      // Re-check INSIDE the lock: a concurrent resume that just settled may have
      // already spawned this session.
      if (svc.pool.get(token)) {
        return c.json({ ok: true, alreadyRunning: true });
      }
      const meta = svc.registry.get(id);
      if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
      const adapter = svc.adapters.get(record.agent);
      if (!adapter) {
        return c.json({
          error: 'unknown_agent',
          message: `record references unknown adapter: ${record.agent}`,
        }, 500);
      }
      try {
        await ensureAgentCredentialReady({
          meta,
          agentId: adapter.id,
          adapter,
          logger: launcherLogger,
        });
      } catch (err) {
        if (err instanceof AgentCredentialError) {
          return c.json(err.toBody(), 400);
        }
        launcherLogger.warn('agent_cred.ensure_failed_on_resume', { id, agent: adapter.id, err });
        return c.json({ error: 'agent_credential_failed', message: (err as Error).message }, 500);
      }
      const resume = mappedResumeForRecord(record, adapter);
      const plan = svc.computeSpawnPlan(meta, adapter, resume);
      // path.trace at the moment the resume decision is taken — captures what
      // we're ABOUT to do, before bootstrap or spawn. If a downstream step
      // diverges (e.g. claude CLI writes jsonl to a different projectKey),
      // we compare this against the transcript.watch.register trace.
      launcherLogger.event('path.trace', {
        where: 'resume.attempt',
        wsId: id,
        recordId: token,
        agent: adapter.id,
        wsDir: meta.dir,
        spawnCwd: plan.spawnCwd,
        envPWD: plan.envPWD,
        transcriptDir: plan.transcriptDir,
        projectKey: plan.projectKey,
        composedCommand: plan.composedCommand,
        resumeMode: plan.resumeMode,
        resumeId: record.resumeId,
        nativeSessionId: plan.nativeSessionId,
        resumeHintInRecord: record.resumeHint ?? null,
      });
      try {
        if (adapter.bootstrap) {
          await adapter.bootstrap({
            wsId: id,
            cwd: meta.dir,
            launcherRepoRoot: svc.config.launcherRepoRoot,
          });
        }
      } catch (err) {
        launcherLogger.error('adapter.bootstrap_failed_on_resume', { id, agent: adapter.id, err });
        return c.json({ error: 'bootstrap_failed', message: (err as Error).message }, 500);
      }
      let initialReplayBytes: Buffer | null = null;
      if (record.agent === 'shell' && record.scrollbackFile) {
        initialReplayBytes = await svc.scrollbackStore.read(record.scrollbackFile);
      }
      const claimedResume = svc.claimResume?.(record.resumeId) ?? true;
      if (!claimedResume) {
        return c.json({ error: 'resume_busy', message: 'this conversation already has a running turn' }, 409);
      }
      try {
        const ctx: SessionFactoryContext = {
          ...(resume !== undefined ? { resume } : {}),
          agentId: record.agent,
          recordId: record.id,
          recordName: record.name,
          ...(terminalTheme !== undefined ? { terminalTheme } : {}),
          ...(initialReplayBytes ? { initialReplayBytes } : {}),
        };
        const session = svc.pool.spawn(id, ctx);
        // Give the child a brief window to prove it stays up. If it exits
        // within ~800ms (claude --continue against a stale projectKey, broken
        // .mcp.json, missing trust, etc.) we'd otherwise return 200 OK while
        // the pool respawn-loops itself into a circuit breaker behind the
        // user's back. Surface the failure so the caller knows resume failed.
        const earlyExit = await session.waitForFirstExit(800);
        if (earlyExit) {
          svc.pool.disposeToken(token, 'resume_early_exit');
          await svc.sessionRegistry
            .update(id, token, { state: 'paused', lastActiveAt: new Date().toISOString() })
            .catch(() => undefined);
          launcherLogger.warn('workspace.session_resume_early_exit', {
            id,
            sessionId: token,
            agent: adapter.id,
            code: earlyExit.code,
            signal: earlyExit.signal,
          });
          return c.json({
            error: 'spawn_died',
            message: `agent exited within startup window (code=${earlyExit.code})`,
            exitCode: earlyExit.code,
            signal: earlyExit.signal,
          }, 500);
        }
        if (record.scrollbackFile) {
          await svc.scrollbackStore.remove(record.scrollbackFile);
          delete (record as { scrollbackFile?: string }).scrollbackFile;
        }
        await svc.sessionRegistry
          .update(id, token, { state: 'running', lastActiveAt: new Date().toISOString() })
          .catch((err) =>
            launcherLogger.warn('session_registry.resume_update_failed', { id, token, err }),
          );
        launcherLogger.info('workspace.session_resumed', {
          id,
          sessionId: token,
          name: session.name,
          pid: session.pid,
          agent: adapter.id,
          resume: resume === undefined ? null : resume === 'last' ? 'last' : resume.sessionId,
          scrollbackBytes: initialReplayBytes?.length ?? 0,
        });
        return c.json({
          ok: true,
          sessionId: session.recordId,
          resumeId: record.resumeId,
          wsId: session.wsId,
          name: session.name,
          pid: session.pid,
          agent: adapter.id,
          startedAt: session.startedAt,
          title: record.title ?? null,
        });
      } catch (err) {
        launcherLogger.error('workspace.session_resume_failed', { id, token, err });
        return c.json({ error: 'resume_failed', message: (err as Error).message }, 500);
      } finally {
        if (claimedResume) svc.releaseResume?.(record.resumeId);
      }
    }
  });

  // Read-only introspection for a single session. Returns the full set of
  // path-related fields a spawn / resume would compute (via the same
  // `computeSpawnPlan` the pool uses), plus an on-disk snapshot of the
  // transcript dir the adapter is watching. Lets us curl against a stuck
  // workspace and immediately see whether the projectKey / cwd / PWD /
  // transcriptDir / watched dir contents are internally consistent —
  // without having to spawn or read 50k lines of backend stdout.
  app.get('/:id/sessions/:sid/diagnostics', async (c) => {
    const id = c.req.param('id');
    const token = c.req.param('sid');
    if (!validId(id) || !validId(token)) {
      return c.json({ error: 'not_found' }, 404);
    }
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
    await svc.sessionRegistry.ensureLoaded(id).catch(() => undefined);
    const record = svc.sessionRegistry.get(id, token);
    if (!record) return c.json({ error: 'session_not_found' }, 404);
    const adapter = svc.adapters.get(record.agent);
    if (!adapter) {
      return c.json({
        error: 'unknown_agent',
        message: `record references unknown adapter: ${record.agent}`,
      }, 500);
    }

    const resume = mappedResumeForRecord(record, adapter);
    const plan = svc.computeSpawnPlan(meta, adapter, resume);

    let transcriptFiles: { name: string; size: number; mtime: string }[] = [];
    let transcriptExists = false;
    if (plan.transcriptDir) {
      try {
        const { readdir, stat } = await import('node:fs/promises');
        const names = await readdir(plan.transcriptDir);
        transcriptExists = true;
        const results = await Promise.all(
          names.map(async (name) => {
            try {
              const st = await stat(join(plan.transcriptDir as string, name));
              return { name, size: st.size, mtime: st.mtime.toISOString() };
            } catch {
              return null;
            }
          }),
        );
        transcriptFiles = results.filter((r): r is { name: string; size: number; mtime: string } => r !== null);
      } catch {
        transcriptExists = false;
      }
    }

    const liveSessions = svc.pool.liveSessionsFor(id);
    const live = liveSessions.find((s) => s.id === token) ?? null;

    return c.json({
      workspace: {
        id: meta.id,
        dir: meta.dir,
        agents: meta.agents,
      },
      record: {
        id: record.id,
        state: record.state,
        agent: record.agent,
        resumeHint: record.resumeHint ?? null,
        lastActiveAt: record.lastActiveAt,
        createdAt: record.createdAt,
      },
      live: live === null ? null : {
        pid: live.pid,
        startedAt: live.startedAt,
        agentSessionId: live.agentSessionId,
      },
      adapter: {
        id: adapter.id,
        capabilities: adapter.capabilities,
      },
      transcript: {
        projectKey: plan.projectKey,
        dir: plan.transcriptDir,
        exists: transcriptExists,
        files: transcriptFiles,
      },
      wouldResume: {
        mode: plan.resumeMode,
        resumeId: record.resumeId,
        nativeSessionId: plan.nativeSessionId,
        composedCommand: plan.composedCommand,
        spawnCwd: plan.spawnCwd,
        envPWD: plan.envPWD,
      },
    });
  });

  // Headless probe: spawn the adapter's CLI against the workspace with a
  // positional prompt appended, run in a temporary PTY (no pool, no record
  // mutation), kill on timeout, return the PTY-output tail + a jsonl-delta
  // snapshot of the transcript dir. Lets an AI / curl caller verify the
  // full wiring (PWD, MCP, trust, resume) end-to-end without going through
  // the UI. Refuses when a live PTY exists for the same record — they'd
  // collide on the same transcript and the result would be misleading.
  app.post('/:id/sessions/:sid/probe', async (c) => {
    const id = c.req.param('id');
    const token = c.req.param('sid');
    if (!validId(id) || !validId(token)) {
      return c.json({ error: 'not_found' }, 404);
    }
    let prompt: string;
    let timeoutMs: number;
    let resumeOverride: 'none' | 'last' | { sessionId: string } | undefined;
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const rawPrompt = fields['prompt'];
      if (typeof rawPrompt !== 'string' || rawPrompt.length === 0) {
        return c.json({ error: 'prompt_required' }, 400);
      }
      if (rawPrompt.length > 8000) {
        return c.json({ error: 'prompt_too_long', message: 'max 8000 chars' }, 400);
      }
      prompt = rawPrompt;
      const rawTimeout = fields['timeoutMs'];
      timeoutMs = typeof rawTimeout === 'number' && rawTimeout > 0
        ? Math.min(rawTimeout, 120_000)
        : 20_000;
      // resume override: 'auto' (default — follow record's resumeHint),
      // 'fresh' (no resume flag), 'last' (force --continue), or an adapter-
      // native session id string (force --resume/--session <id>). Lets the
      // probe seed a brand-new session before any real interaction has produced
      // a transcript.
      const rawResume = fields['resume'];
      if (rawResume !== undefined && rawResume !== 'auto') {
        if (rawResume === 'fresh') resumeOverride = 'none';
        else if (rawResume === 'last') resumeOverride = 'last';
        else if (typeof rawResume === 'string' && AGENT_SESSION_ID_RE.test(rawResume)) {
          resumeOverride = { sessionId: rawResume };
        } else {
          return c.json({ error: 'bad_request', message: 'resume must be "auto", "fresh", "last", or an agent session id' }, 400);
        }
      }
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
    await svc.sessionRegistry.ensureLoaded(id).catch(() => undefined);
    const record = svc.sessionRegistry.get(id, token);
    if (!record) return c.json({ error: 'session_not_found' }, 404);
    if (svc.pool.get(token)) {
      return c.json({
        error: 'session_live',
        message: 'pause the live PTY before probing — they would race on the transcript',
      }, 409);
    }
    const adapter = svc.adapters.get(record.agent);
    if (!adapter) {
      return c.json({
        error: 'unknown_agent',
        message: `record references unknown adapter: ${record.agent}`,
      }, 500);
    }
    const resume: SessionFactoryContext['resume'] =
      resumeOverride === 'none'
        ? undefined
        : resumeOverride === 'last'
          ? 'last'
          : resumeOverride !== undefined
            ? resumeOverride
            : mappedResumeForRecord(record, adapter);
    launcherLogger.info('workspace.probe_started', {
      id, sessionId: token, agent: adapter.id, promptLen: prompt.length, timeoutMs,
      resumeMode: resume === undefined ? 'fresh' : resume === 'last' ? 'last' : 'by-id',
    });
    try {
      const result = await svc.runHeadlessProbe(meta, adapter, resume, prompt, timeoutMs);
      return c.json(result);
    } catch (err) {
      if (err instanceof AgentCredentialError) {
        return c.json(err.toBody(), 400);
      }
      launcherLogger.error('workspace.probe_failed', { id, token, err });
      return c.json({ error: 'probe_failed', message: (err as Error).message }, 500);
    }
  });

  // Headless task dispatch — the standard automation API. Spawns the
  // workspace's agent CLI in one-shot headless mode with a positional prompt,
  // runs to natural exit, returns exit/duration, a normalized reply/tool
  // timeline, and bounded output tails. `inbox_push` remains the durable
  // user-delivery channel; structured output powers readiness, Automation, and
  // orchestration. No session/PTY — a fresh one-shot clone each call (no
  // respawn, not pooled). Synchronous: the request stays
  // open until the task exits (the cron/automation trigger calls
  // `svc.runHeadlessTask` directly instead). Body: { prompt, agent?, timeoutMs? }.
  //   curl -XPOST .../:id/headless -d '{"prompt":"...","agent":"claude"}'
  app.post('/:id/headless', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    let prompt: string;
    let timeoutMs: number;
    let agentId: string | undefined;
    let resumeId: string | undefined;
    let wait = false;
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const rawPrompt = fields['prompt'];
      // Gate on trimmed length so a whitespace-only prompt can't spawn a no-op
      // agent run; pass the original prompt through unchanged.
      if (typeof rawPrompt !== 'string' || rawPrompt.trim().length === 0) {
        return c.json({ error: 'prompt_required' }, 400);
      }
      if (rawPrompt.length > 16000) {
        return c.json({ error: 'prompt_too_long', message: 'max 16000 chars' }, 400);
      }
      prompt = rawPrompt;
      const rawTimeout = fields['timeoutMs'];
      timeoutMs =
        typeof rawTimeout === 'number' && rawTimeout > 0 ? Math.min(rawTimeout, 1_800_000) : 300_000;
      const rawAgent = fields['agent'];
      if (typeof rawAgent === 'string' && rawAgent.length > 0) agentId = rawAgent;
      const rawResumeId = fields['resumeId'];
      if (typeof rawResumeId === 'string' && validId(rawResumeId)) resumeId = rawResumeId;
      wait = fields['wait'] === true;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
    const resumeIdentity = resumeId ? svc.resumeRegistry.get(resumeId) : null;
    if (resumeId && !resumeIdentity) return c.json({ error: 'resume_not_found' }, 404);
    if (resumeIdentity && resumeIdentity.wsId !== id) {
      return c.json({ error: 'resume_wrong_workspace' }, 409);
    }
    if (wait && resumeId) {
      return c.json({ error: 'resume_requires_async', message: 'resumed turns are recorded runs; omit wait:true' }, 400);
    }
    if (agentId && !svc.adapters.get(agentId)) {
      return c.json({ error: 'unknown_agent', message: `no adapter: ${agentId}` }, 400);
    }
    // An explicit agent must be one ENABLED on this workspace — else
    // resolveAdapter would honor it and spawn a CLI with no provider config
    // injected (silent fallback to the user's global config). Omitting `agent`
    // resolves through the user default / first enabled agent runtime, never
    // through utility adapters such as shell.
    if (agentId && !meta.agents.includes(agentId)) {
      return c.json({ error: 'agent_not_enabled', message: `agent "${agentId}" not enabled on this workspace` }, 400);
    }
    const effectiveAgentId = agentId ?? resumeIdentity?.agent ?? await svc.resolveDefaultAgentId(meta);
    if (!effectiveAgentId) {
      return c.json({ error: 'no_agent_runtime', message: 'workspace has no agent runtime enabled' }, 400);
    }
    const adapter = svc.resolveAdapter(meta, effectiveAgentId);
    if (!adapter.capabilities.headless || !adapter.composeHeadlessCommand) {
      return c.json({ error: 'no_headless', message: `adapter "${adapter.id}" has no headless mode` }, 400);
    }
    // Same one-time bootstrap as a real spawn (trust/MCP wiring), idempotent.
    try {
      if (adapter.bootstrap) {
        await adapter.bootstrap({ wsId: id, cwd: meta.dir, launcherRepoRoot: svc.config.launcherRepoRoot });
      }
    } catch (err) {
      launcherLogger.error('headless.bootstrap_failed', { id, agent: adapter.id, err });
    }
    launcherLogger.info('workspace.headless_started', {
      id,
      agent: adapter.id,
      promptLen: prompt.length,
      timeoutMs,
      wait,
    });
    // `wait:true` → run synchronously and return the full result (curl/tests).
    if (wait) {
      try {
        const result = await svc.runHeadlessTask(meta, adapter, prompt, timeoutMs);
        return c.json(result);
      } catch (err) {
        if (err instanceof AgentCredentialError) {
          return c.json(err.toBody(), 400);
        }
        launcherLogger.error('workspace.headless_failed', { id, agent: adapter.id, err });
        return c.json({ error: 'headless_failed', message: (err as Error).message }, 500);
      }
    }
    // Default → async: record + spawn in the background, return the taskId. The
    // run's status and normalized output are queryable under /api/headless;
    // the agent can additionally publish durable user-facing work to Inbox.
    try {
      const dispatched = resumeId
        ? await svc.dispatchHeadlessTask(meta, adapter, prompt, timeoutMs, undefined, resumeId)
        : await svc.dispatchHeadlessTask(meta, adapter, prompt, timeoutMs);
      return c.json({ ...dispatched, status: 'running' }, 202);
    } catch (err) {
      if (err instanceof HeadlessCapacityError) {
        return c.json({ error: 'capacity', message: err.message }, 429);
      }
      if (err instanceof HeadlessResumeError) {
        return c.json(
          { error: `resume_${err.code}`, message: err.message },
          err.code === 'not_found' ? 404 : 409,
        );
      }
      if (err instanceof AgentCredentialError) {
        return c.json(err.toBody(), 400);
      }
      launcherLogger.error('workspace.headless_failed', { id, agent: adapter.id, err });
      return c.json({ error: 'headless_failed', message: (err as Error).message }, 500);
    }
  });

  app.delete('/:id/sessions/:sid', async (c) => {
    const id = c.req.param('id');
    const token = c.req.param('sid');
    if (!validId(id) || !validId(token)) {
      return c.json({ error: 'not_found' }, 404);
    }
    const record = svc.sessionRegistry.get(id, token);
    if (!record) return c.json({ error: 'not_found' }, 404);
    const wasRunning = svc.pool.disposeToken(token, 'session deleted');
    if (record.scrollbackFile) {
      await svc.scrollbackStore.remove(record.scrollbackFile);
    }
    await svc.sessionRegistry.remove(id, token).catch((err) =>
      launcherLogger.warn('session_registry.delete_failed', { id, token, err }),
    );
    launcherLogger.info('workspace.session_deleted', { id, sessionId: token, wasRunning });
    return c.json({ ok: true, wasRunning });
  });

  // ── agent provider config ────────────────────────────────────────────────
  // Per-workspace AI provider config lives in CLI-native files inside the
  // workspace (`.claude/settings.local.json`, `.codex/config.toml`,
  // `.codex/env.json`). The CLIs read them directly via cwd-discovery /
  // CODEX_HOME. These routes are pure file IO over the launcher's
  // path-traversal guard.


  // Central credential store, surfaced to the workspace AI-config modal. The
  // "Load from saved credential" picker reads this list; the "Save to Alice"
  // dialog POSTs here so a hand-entered provider becomes reusable. apiKey is
  // returned so the picker can flash it into the form (same exposure as the
  // legacy agent-profiles route; both are behind the admin-token gate).
  app.get('/credentials', async (c) => {
    try {
      const credentials = await readCredentials();
      // `?agent=<id>` filters to the credentials that agent can actually be
      // driven by (its wire shapes) — the quick-chat runtime dropdown uses this
      // so it never offers a cred the agent can't speak. apiKey omitted in this
      // mode (the dropdown only needs to label + pick), kept for the modal's
      // unfiltered "load saved" picker.
      const agent = c.req.query('agent');
      const entries = agent ? compatibleCredentials(credentials, agent) : Object.entries(credentials);
      const list = entries.map(([slug, cred]) => ({
        slug,
        vendor: cred.vendor,
        ...(cred.label ? { label: cred.label } : {}),
        authType: cred.authType,
        wires: credentialWires(cred), // shape → endpoint; the modal picks one per agent
        ...(cred.lastModel ? { lastModel: cred.lastModel } : {}),
        ...(agent ? {} : { apiKey: cred.apiKey ?? null }),
      }));
      return c.json({ credentials: list });
    } catch (err) {
      launcherLogger.warn('credentials.read_failed', { err });
      return c.json({ error: 'credentials_read_failed', message: (err as Error).message }, 500);
    }
  });

  app.post('/credentials', async (c) => {
    const body = (await safeJson(c)) as
      | { apiKey?: string; baseUrl?: string; agent?: string; vendor?: string; label?: string; wireShape?: string }
      | null;
    const apiKey = body?.apiKey?.trim();
    if (!apiKey) return c.json({ error: 'apiKey_required' }, 400);
    const baseUrl = body?.baseUrl?.trim() || undefined;
    const label = body?.label?.trim();
    const wireParse = credentialWireShapeEnum.safeParse(body?.wireShape);
    // The workspace modal saves a single hand-entered shape; capture it as a
    // one-entry wires map (the vault can later add more shapes for the same key —
    // dedup-by-key upgrades in place). Subscriptions never flow through here.
    const cred: Credential = {
      vendor: inferCredentialVendor({ agent: body?.agent, baseUrl }),
      ...(label ? { label } : {}),
      authType: 'api-key',
      apiKey,
      ...(wireParse.success ? { wires: { [wireParse.data]: baseUrl ?? '' } } : (baseUrl ? { wires: {} } : {})),
    };
    try {
      const slug = await addCredential(cred);
      launcherLogger.info('credentials.saved', { slug, vendor: cred.vendor });
      return c.json({ slug, vendor: cred.vendor }, 201);
    } catch (err) {
      launcherLogger.warn('credentials.write_failed', { err });
      return c.json({ error: 'credentials_write_failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/:id/agent-config', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    try {
      const [claude, codex, opencode, pi] = await Promise.all([
        svc.adapters.get('claude')?.readAiConfig?.(meta.dir) ?? null,
        svc.adapters.get('codex')?.readAiConfig?.(meta.dir) ?? null,
        svc.adapters.get('opencode')?.readAiConfig?.(meta.dir) ?? null,
        svc.adapters.get('pi')?.readAiConfig?.(meta.dir) ?? null,
      ]);
      return c.json({ claude, codex, opencode, pi });
    } catch (err) {
      if (err instanceof PathTraversal) return c.json({ error: 'invalid_path' }, 400);
      launcherLogger.warn('agent_config.read_failed', { id, err });
      return c.json({ error: 'read_failed', message: (err as Error).message }, 500);
    }
  });

  // Which vault credential this workspace's agent is currently configured with
  // (slug + model), or null. Feeds the quick-chat composer's overwrite notice:
  // "this workspace uses X — sending with Y will switch it". Detection only —
  // never mutates.
  app.get('/:id/agent-config/:agent/credential', async (c) => {
    const id = c.req.param('id');
    const agent = c.req.param('agent');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    try {
      const detected = await detectWorkspaceCred(meta, agent, await readCredentials());
      return c.json({ slug: detected?.slug ?? null, model: detected?.model ?? null });
    } catch (err) {
      if (err instanceof PathTraversal) return c.json({ error: 'invalid_path' }, 400);
      launcherLogger.warn('agent_config.detect_cred_failed', { id, agent, err });
      return c.json({ slug: null, model: null });
    }
  });

  app.get('/:id/agent-readiness', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    try {
      const credentials = await readCredentials();
      const rows = await Promise.all(
        meta.agents
          .map((agentId) => ({ agentId, adapter: svc.adapters.get(agentId) }))
          .filter(({ adapter }) => adapter !== undefined && isAgentRuntime(adapter))
          .map(({ agentId, adapter }) =>
            getAgentCredentialReadiness({ meta, agentId, adapter, credentials }),
          ),
      );
      return c.json({ agents: Object.fromEntries(rows.map((row) => [row.agent, row])) });
    } catch (err) {
      if (err instanceof PathTraversal) return c.json({ error: 'invalid_path' }, 400);
      launcherLogger.warn('agent_readiness.failed', { id, err });
      return c.json({ error: 'readiness_failed', message: (err as Error).message }, 500);
    }
  });

  app.get('/:id/agent-readiness/:agent', async (c) => {
    const id = c.req.param('id');
    const agent = c.req.param('agent');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);
    try {
      const row = await getAgentCredentialReadiness({
        meta,
        agentId: agent,
        adapter: svc.adapters.get(agent),
      });
      return c.json(row);
    } catch (err) {
      if (err instanceof PathTraversal) return c.json({ error: 'invalid_path' }, 400);
      launcherLogger.warn('agent_readiness.failed', { id, agent, err });
      return c.json({ error: 'readiness_failed', message: (err as Error).message }, 500);
    }
  });

  app.put('/:id/agent-config/:agent', async (c) => {
    const id = c.req.param('id');
    const agent = c.req.param('agent');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    if (agent !== 'claude' && agent !== 'codex' && agent !== 'opencode' && agent !== 'pi') {
      return c.json({ error: 'unknown_agent' }, 400);
    }
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);

    const body = (await safeJson(c)) as WorkspaceAiCred | null;
    const cfg = body && typeof body === 'object' ? body : {};
    try {
      const adapter = svc.adapters.get(agent);
      if (!adapter?.writeAiConfig) return c.json({ error: 'unknown_agent' }, 400);
      await adapter.writeAiConfig(meta.dir, cfg);
      // Remember an explicit model choice on the originating vault credential
      // (matched by apiKey) so quick-chat can reuse it without re-prompting.
      // Best-effort: the config was already written; a miss here is cosmetic.
      if (cfg.apiKey && cfg.model) {
        try {
          const slug = matchCredentialByApiKey(await readCredentials(), cfg.apiKey);
          if (slug) await setCredentialLastModel(slug, cfg.model);
        } catch (err) {
          launcherLogger.warn('agent_config.last_model_record_failed', { id, agent, err });
        }
      }
      launcherLogger.info('agent_config.saved', { id, agent });
      return c.json({ ok: true });
    } catch (err) {
      if (err instanceof PathTraversal) return c.json({ error: 'invalid_path' }, 400);
      launcherLogger.warn('agent_config.write_failed', { id, agent, err });
      return c.json({ error: 'write_failed', message: (err as Error).message }, 500);
    }
  });

  // Probe live provider with the form state (does NOT touch workspace files —
  // tests exactly what the user sees in the modal, before they hit Save).
  app.post('/:id/agent-config/:agent/test', async (c) => {
    const id = c.req.param('id');
    const agent = c.req.param('agent');
    if (!validId(id)) return c.json({ ok: false, error: 'invalid_id' }, 400);
    if (agent !== 'claude' && agent !== 'codex' && agent !== 'opencode' && agent !== 'pi') {
      return c.json({ ok: false, error: 'unknown_agent' }, 400);
    }

    const body = (await safeJson(c)) as WorkspaceAiCred | null;
    const baseUrl = typeof body?.baseUrl === 'string' ? body.baseUrl.trim() : '';
    const apiKey = typeof body?.apiKey === 'string' ? body.apiKey.trim() : '';
    const model = typeof body?.model === 'string' ? body.model.trim() : '';
    // baseUrl may be empty (official endpoint); probeByWireShape defaults it.
    if (!apiKey || !model) {
      return c.json({ ok: false, error: 'apiKey and model are required' }, 400);
    }

    try {
      // Same dispatcher as the credential vault — Test means the same thing
      // everywhere. The shape comes from the credential's wireShape (threaded by
      // the modal), defaulting to the agent's native shape.
      const wireShape: WireShape = body?.wireShape ?? DEFAULT_WIRE_BY_AGENT[agent] ?? 'openai-chat';
      const result = await probeByWireShape(wireShape, {
        baseUrl,
        apiKey,
        model,
        // Resolve the anthropic auth header by baseUrl (api.minimax.io → bearer),
        // same as the vault — the modal only sends authMode on the claude tab, so
        // an anthropic-shape cred on an opencode/pi tab needs the baseUrl heuristic.
        authMode: resolveAnthropicAuthMode({ authMode: body?.authMode, baseUrl }),
      });
      return c.json({ ok: true, response: result.text });
    } catch (err) {
      const e = err as { status?: number; message?: string };
      const msg = e.status ? `${e.status} ${e.message ?? 'error'}` : (e.message ?? String(err));
      launcherLogger.info('agent_config.test_failed', { id, agent, msg });
      return c.json({ ok: false, error: msg });
    }
  });

  return app;
}

// ── Agent config helpers ────────────────────────────────────────────────────

// AI-provider config IO moved into the CLI adapters (writeAiConfig /
// readAiConfig on claudeAdapter / codexAdapter). The routes above dispatch
// through svc.adapters so each CLI owns its own file format.

function validId(id: string | undefined): id is string {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]+$/.test(id);
}

async function safeJson(c: import('hono').Context): Promise<unknown> {
  try {
    const body = await c.req.json();
    return body;
  } catch {
    return null;
  }
}
