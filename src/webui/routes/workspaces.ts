/**
 * Hono routes for the Workspaces feature, mounted at /api/workspaces.
 *
 * Thin adapter over WorkspaceService — each handler dispatches to the same
 * launcher domain modules (registry / pool / creator / sessionRegistry) that
 * the original `server/src/index.ts` `handleHttp` switch did.
 */

import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';
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
import { HeadlessCapacityError, resumeFromRecord, type SessionFactoryContext, type WorkspaceService } from '../../workspaces/service.js';
import { isAgentRuntime, type WorkspaceAiCred } from '../../workspaces/cli-adapter.js';
import { addCredential, readCredentials, readWorkspaceDefaultAgent, setCredentialLastModel, credentialWires, credentialWireShapeEnum, type Credential } from '../../core/config.js';
import { inferCredentialVendor, resolveAnthropicAuthMode } from '../../core/credential-inference.js';
import {
  compatibleCredentials,
  matchCredentialByApiKey,
  resolveInjectionModel,
  credentialToWorkspaceAiCred,
} from '../../workspaces/credential-injection.js';

/**
 * Agent runtimes that have NO login of their own (provider-agnostic) — they
 * cannot start without an injected AI config. claude/codex run on their own CLI
 * login, so quick-chat leaves them alone; opencode/pi must be seeded with a
 * vault credential or they ENOENT-die at spawn. Keep in sync with the dropdown's
 * visibility on the quick-chat composer.
 */
const LOGINLESS_AGENTS = new Set(['opencode', 'pi']);

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The spawn body's `resume` value is an AGENT-side session id, whose shape is
// adapter-native: uuid for claude/codex/pi, `ses_<base62>` for opencode. The
// launcher-side record ids in URL params stay strict-uuid (SESSION_ID_RE) —
// this looser shape applies ONLY to the resume intent passed through to the
// adapter's own resume flag.
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
const QUICK_CHAT_TEMPLATE = 'chat';

const MONTH_ABBR = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] as const;

/**
 * Tag for TODAY's chat workspace — `chat-<mon><day>` (e.g. `chat-jun15`).
 * Quick-chat is one-workspace-per-DAY: today's conversations are sessions inside
 * today's workspace. The format mirrors the frontend's `defaultTagFor`
 * (`<template>-<month><day>`, en-US short month lowercased) so a quick-chat-
 * created daily workspace is byte-identical to one created from the form on the
 * same day — the two converge on the same workspace instead of duplicating.
 */
function todayChatTag(): string {
  const now = new Date();
  return `${QUICK_CHAT_TEMPLATE}-${MONTH_ABBR[now.getMonth()]}${now.getDate()}`;
}

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

/** Max stored length of a session title (the seed message); the row truncates further. */
const MAX_SESSION_TITLE = 200;

/** The 201 body both `/:id/sessions/spawn` and `/quick-chat` return. */
interface SpawnedSessionBody {
  readonly sessionId: string;
  readonly wsId: string;
  readonly name: string;
  readonly pid: number;
  readonly agent: string;
  readonly agentSessionId: string | null;
  readonly startedAt: number;
  /** The seed message, when the session was seeded — its sidebar title. */
  readonly title: string | null;
}

type SpawnSessionResult =
  | { readonly ok: true; readonly session: SpawnedSessionBody }
  | { readonly ok: false; readonly status: number; readonly body: { error: string; message?: string } };

export function createWorkspaceRoutes(svc: WorkspaceService): Hono {
  const app = new Hono();

  const resolveDefaultAgentId = async (meta: WorkspaceMeta): Promise<string | undefined> => {
    const configured = await readWorkspaceDefaultAgent().catch(() => null);
    if (configured && meta.agents.includes(configured)) {
      const adapter = svc.adapters.get(configured);
      if (adapter && isAgentRuntime(adapter)) return configured;
    }
    return meta.agents.find((id) => {
      const adapter = svc.adapters.get(id);
      return adapter ? isAgentRuntime(adapter) : false;
    });
  };

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
      readonly initialPrompt?: string;
    },
  ): Promise<SpawnSessionResult> {
    const id = meta.id;
    const { resume, initialPrompt } = opts;
    const agentId = opts.agentId ?? await resolveDefaultAgentId(meta);
    if (!agentId) {
      return { ok: false, status: 400, body: { error: 'no_agent_runtime', message: 'workspace has no agent runtime enabled' } };
    }
    if (!svc.adapters.get(agentId)) {
      return { ok: false, status: 400, body: { error: 'unknown_agent', message: `no adapter: ${agentId}` } };
    }
    const adapter = svc.resolveAdapter(meta, agentId);
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
    const recordId = randomUUID();
    const recordName = svc.sessionRegistry.nextName(id, adapter.id, prefix);
    const nowIso = new Date().toISOString();
    const title = initialPrompt ? initialPrompt.slice(0, MAX_SESSION_TITLE) : undefined;
    const record: SessionRecord = {
      id: recordId,
      wsId: id,
      agent: adapter.id,
      name: recordName,
      createdAt: nowIso,
      lastActiveAt: nowIso,
      state: 'running',
      ...(title !== undefined ? { title } : {}),
    };
    try {
      await svc.sessionRegistry.create(record);
    } catch (err) {
      launcherLogger.error('session_registry.create_failed', { id, recordId, err });
      return { ok: false, status: 500, body: { error: 'registry_failed', message: (err as Error).message } };
    }
    try {
      const ctx: SessionFactoryContext = {
        ...(resume !== undefined ? { resume } : {}),
        agentId,
        ...(initialPrompt !== undefined ? { initialPrompt } : {}),
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
      return {
        ok: true,
        session: {
          sessionId: session.recordId,
          wsId: session.wsId,
          name: session.name,
          pid: session.pid,
          agent: adapter.id,
          agentSessionId: session.agentSessionId,
          startedAt: session.startedAt,
          title: title ?? null,
        },
      };
    } catch (err) {
      await svc.sessionRegistry.remove(id, recordId).catch(() => undefined);
      launcherLogger.error('workspace.session_spawn_failed', { id, err });
      return { ok: false, status: 500, body: { error: 'spawn_failed', message: (err as Error).message } };
    }
  }

  // TODAY's chat workspace, by its daily tag (`chat-jun15`). A workspace someone
  // happened to tag `chat-jun15` with a non-chat template doesn't count — the
  // daily bucket is a chat-template workspace.
  const findTodaysChat = (): WorkspaceMeta | undefined => {
    const tag = todayChatTag();
    return svc.registry.list().find((w) => w.template === QUICK_CHAT_TEMPLATE && w.tag === tag);
  };

  // Serializes quick-chat's find-or-create so two concurrent FIRST-OF-DAY
  // launches don't both bootstrap today's workspace — the loser's `registry.add`
  // would throw on the duplicate tag and leak an orphaned bootstrap dir.
  // In-process chain (quick-chat is low-frequency, single-process); the `.catch`
  // keeps a failed run from poisoning the gate forever.
  let chatWsGate: Promise<unknown> = Promise.resolve();

  const findOrCreateChatWorkspace = async (): Promise<
    { ok: true; meta: WorkspaceMeta } | { ok: false; status: number; body: { error: string; message?: string } }
  > => {
    const existing = findTodaysChat();
    if (existing) return { ok: true, meta: existing };
    let created: Awaited<ReturnType<typeof svc.creator.create>>;
    try {
      created = await svc.creator.create(todayChatTag(), QUICK_CHAT_TEMPLATE);
    } catch (err) {
      // e.g. a concurrent create committed today's tag first. Re-find — the
      // winner's workspace now exists.
      const after = findTodaysChat();
      if (after) return { ok: true, meta: after };
      launcherLogger.error('quick_chat.create_threw', { err });
      return { ok: false, status: 500, body: { error: 'create_failed', message: (err as Error).message } };
    }
    if (!created.ok) {
      // tag_in_use means today's workspace was created concurrently — re-find it.
      if (created.code === 'tag_in_use') {
        const after = findTodaysChat();
        if (after) return { ok: true, meta: after };
      }
      const status =
        created.code === 'tag_in_use' ? 409
        : created.code === 'unknown_template' ? 400
        : created.code === 'invalid_tag' ? 400
        : created.code === 'unknown_agent' ? 400
        : 500;
      launcherLogger.error('quick_chat.create_failed', { code: created.code, message: created.message });
      return { ok: false, status, body: { error: created.code, message: created.message } };
    }
    return { ok: true, meta: created.workspace };
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

  // Seed a loginless agent (opencode/pi) with a vault credential before it
  // spawns — claude/codex carry their own CLI login and never reach here. Picks
  // the user's choice, else the cred this workspace already uses, else the first
  // compatible one; writes the agent's native AI-config and remembers the model.
  // Returns an HTTP-mappable error only for the dead-end case (no compatible
  // credential at all), so the composer can bounce the user to Settings.
  const injectLoginlessCredential = async (
    meta: WorkspaceMeta,
    agentId: string,
    pickedSlug: string | undefined,
  ): Promise<{ ok: true } | { ok: false; status: number; body: { error: string; agent: string; settingsTarget: string } }> => {
    const adapter = svc.adapters.get(agentId);
    if (!adapter?.writeAiConfig) return { ok: true }; // not a configurable agent — let spawn proceed
    const credentials = await readCredentials();
    const compatible = compatibleCredentials(credentials, agentId);
    if (compatible.length === 0) {
      return { ok: false, status: 400, body: { error: 'no_ai_credential', agent: agentId, settingsTarget: 'ai-provider' } };
    }
    const compatMap = new Map(compatible);
    const detected = await detectWorkspaceCred(meta, agentId, credentials);
    const chosenSlug =
      (pickedSlug && compatMap.has(pickedSlug) ? pickedSlug : undefined) ??
      (detected && compatMap.has(detected.slug) ? detected.slug : undefined) ??
      compatible[0][0];
    const cred = compatMap.get(chosenSlug);
    if (!cred) return { ok: true };
    const model = resolveInjectionModel(cred);
    const wsCred = credentialToWorkspaceAiCred(cred, agentId, model ? { model } : {});
    if (!wsCred) {
      // compatibleCredentials guarantees a wire, so this is unreachable — but a
      // loud skip beats injecting a mismatched shape.
      launcherLogger.warn('quick_chat.cred_inject_incompatible', { agent: agentId, slug: chosenSlug });
      return { ok: true };
    }
    try {
      await adapter.writeAiConfig(meta.dir, wsCred);
      if (model) await setCredentialLastModel(chosenSlug, model).catch(() => undefined);
      launcherLogger.info('quick_chat.cred_injected', {
        id: meta.id, agent: agentId, slug: chosenSlug,
        ...(model ? { model } : {}),
        ...(detected && detected.slug !== chosenSlug ? { replaced: detected.slug } : {}),
      });
    } catch (err) {
      // Best-effort — a write failure shouldn't block the launch; the agent will
      // surface its own missing-config error in the terminal.
      launcherLogger.warn('quick_chat.cred_inject_failed', { id: meta.id, agent: agentId, slug: chosenSlug, err });
    }
    return { ok: true };
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

  app.post('/:id/sessions/spawn', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'not_found' }, 404);

    let resume: SessionFactoryContext['resume'];
    let agentId: string | undefined;
    let initialPrompt: string | undefined;
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const raw = fields['resume'];
      if (raw === 'last') resume = 'last';
      else if (typeof raw === 'string' && AGENT_SESSION_ID_RE.test(raw)) resume = { sessionId: raw };
      const rawAgent = fields['agent'];
      if (typeof rawAgent === 'string' && rawAgent.length > 0) agentId = rawAgent;
      // Quick-chat seed (fresh-only): a first message the TUI opens already
      // working on. Ignored when resuming — seeding + resume is ambiguous on
      // codex's `resume <id>` / pi's `--session-id`.
      const seed = parseSeedPrompt(fields['initialPrompt']);
      if (seed && 'error' in seed) return c.json(seed, 400);
      if (seed && resume === undefined) initialPrompt = seed.prompt;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    const result = await spawnInteractiveSession(meta, {
      ...(agentId !== undefined ? { agentId } : {}),
      ...(resume !== undefined ? { resume } : {}),
      ...(initialPrompt !== undefined ? { initialPrompt } : {}),
    });
    if (!result.ok) return c.json(result.body, result.status as 400 | 500);
    return c.json(result.session, 201);
  });

  // Quick-chat launch — the "type a message → you're in" front door, decoupled
  // from the multi-step create-workspace UI. Enters TODAY's chat workspace
  // (creating it on the day's first use), then spawns a fresh interactive session
  // seeded with the user's first message. One POST returns both the workspace
  // and the live session, so the client can drop the user straight into the TUI.
  // Body: { prompt: string; agent?: string }
  app.post('/quick-chat', async (c) => {
    let prompt: string;
    let agentId: string | undefined;
    let credentialSlug: string | undefined;
    let targetWsId: string | undefined;
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
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }

    // One chat workspace per DAY: enter today's if it exists, else create it.
    // Each send is a new SESSION inside today's workspace (conversations =
    // sessions, resumable from the chat sidebar) — closer to a traditional
    // chatbot while staying aligned with the Workspace/Session model. Create is
    // heavy (bash + git + skill injection) but happens at most once per day. The
    // find-or-create runs through `chatWsGate` so concurrent first-of-day
    // launches don't double-bootstrap.
    let meta: WorkspaceMeta;
    if (targetWsId) {
      // Targeted: spawn a new session into the given existing workspace.
      const found = svc.registry.list().find((w) => w.id === targetWsId);
      if (!found) return c.json({ error: 'workspace_not_found' }, 404);
      meta = found;
    } else {
      const run = chatWsGate.catch(() => undefined).then(() => findOrCreateChatWorkspace());
      chatWsGate = run;
      const target = await run;
      if (!target.ok) return c.json(target.body, target.status as 400 | 409 | 500);
      meta = target.meta;
    }

    // A loginless runtime (opencode/pi) can't start without an AI config — seed
    // it from the vault before spawn. The dead-end (no compatible credential at
    // all) returns 400 no_ai_credential so the composer bounces to Settings
    // instead of spawning an agent that'll instantly die on a missing key.
    const effectiveAgent = agentId ?? await resolveDefaultAgentId(meta);
    if (!effectiveAgent) {
      return c.json({ error: 'no_agent_runtime', message: 'workspace has no agent runtime enabled' }, 400);
    }
    if (LOGINLESS_AGENTS.has(effectiveAgent)) {
      const inject = await injectLoginlessCredential(meta, effectiveAgent, credentialSlug);
      if (!inject.ok) return c.json(inject.body, inject.status as 400);
    }

    const spawn = await spawnInteractiveSession(meta, {
      ...(agentId !== undefined ? { agentId } : {}),
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
      if (!validId(id) || !SESSION_ID_RE.test(token)) {
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
    if (!validId(id) || !SESSION_ID_RE.test(token)) {
      return c.json({ error: 'not_found' }, 404);
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
      const resume = resumeFromRecord(record, adapter);
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
        resumeId: plan.resumeId,
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
      try {
        const ctx: SessionFactoryContext = {
          ...(resume !== undefined ? { resume } : {}),
          agentId: record.agent,
          recordId: record.id,
          recordName: record.name,
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
          wsId: session.wsId,
          name: session.name,
          pid: session.pid,
          agent: adapter.id,
          startedAt: session.startedAt,
        });
      } catch (err) {
        launcherLogger.error('workspace.session_resume_failed', { id, token, err });
        return c.json({ error: 'resume_failed', message: (err as Error).message }, 500);
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
    if (!validId(id) || !SESSION_ID_RE.test(token)) {
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

    const resume = resumeFromRecord(record, adapter);
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
        resumeId: plan.resumeId,
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
    if (!validId(id) || !SESSION_ID_RE.test(token)) {
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
      // 'fresh' (no resume flag), 'last' (force --continue), or a UUID
      // string (force --resume <uuid>). Lets the probe seed a brand-new
      // session before any real interaction has produced a transcript.
      const rawResume = fields['resume'];
      if (rawResume !== undefined && rawResume !== 'auto') {
        if (rawResume === 'fresh') resumeOverride = 'none';
        else if (rawResume === 'last') resumeOverride = 'last';
        else if (typeof rawResume === 'string' && SESSION_ID_RE.test(rawResume)) {
          resumeOverride = { sessionId: rawResume };
        } else {
          return c.json({ error: 'bad_request', message: 'resume must be "auto", "fresh", "last", or a UUID' }, 400);
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
            : resumeFromRecord(record, adapter);
    launcherLogger.info('workspace.probe_started', {
      id, sessionId: token, agent: adapter.id, promptLen: prompt.length, timeoutMs,
      resumeMode: resume === undefined ? 'fresh' : resume === 'last' ? 'last' : 'by-id',
    });
    try {
      const result = await svc.runHeadlessProbe(meta, adapter, resume, prompt, timeoutMs);
      return c.json(result);
    } catch (err) {
      launcherLogger.error('workspace.probe_failed', { id, token, err });
      return c.json({ error: 'probe_failed', message: (err as Error).message }, 500);
    }
  });

  // Headless task dispatch — the standard automation API. Spawns the
  // workspace's agent CLI in one-shot headless mode with a positional prompt,
  // runs to natural exit, returns exit/duration + bounded output tails. The
  // agent reports its actual result via `inbox_push`; this endpoint just waits
  // on the process exit (the turn boundary). No session/PTY — a fresh one-shot
  // clone each call (no respawn, not pooled). Synchronous: the request stays
  // open until the task exits (the cron/automation trigger calls
  // `svc.runHeadlessTask` directly instead). Body: { prompt, agent?, timeoutMs? }.
  //   curl -XPOST .../:id/headless -d '{"prompt":"...","agent":"claude"}'
  app.post('/:id/headless', async (c) => {
    const id = c.req.param('id');
    if (!validId(id)) return c.json({ error: 'not_found' }, 404);
    let prompt: string;
    let timeoutMs: number;
    let agentId: string | undefined;
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
      wait = fields['wait'] === true;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    const meta = svc.registry.get(id);
    if (!meta) return c.json({ error: 'workspace_not_found' }, 404);
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
    const effectiveAgentId = agentId ?? await resolveDefaultAgentId(meta);
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
        launcherLogger.error('workspace.headless_failed', { id, agent: adapter.id, err });
        return c.json({ error: 'headless_failed', message: (err as Error).message }, 500);
      }
    }
    // Default → async: record + spawn in the background, return the taskId. The
    // run's status is queryable at GET /api/headless/:taskId; the agent reports
    // its actual result via the Inbox.
    try {
      const { taskId } = await svc.dispatchHeadlessTask(meta, adapter, prompt, timeoutMs);
      return c.json({ taskId, status: 'running' }, 202);
    } catch (err) {
      if (err instanceof HeadlessCapacityError) {
        return c.json({ error: 'capacity', message: err.message }, 429);
      }
      launcherLogger.error('workspace.headless_failed', { id, agent: adapter.id, err });
      return c.json({ error: 'headless_failed', message: (err as Error).message }, 500);
    }
  });

  app.delete('/:id/sessions/:sid', async (c) => {
    const id = c.req.param('id');
    const token = c.req.param('sid');
    if (!validId(id) || !SESSION_ID_RE.test(token)) {
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
      | { apiKey?: string; baseUrl?: string; agent?: string; vendor?: string; wireShape?: string }
      | null;
    const apiKey = body?.apiKey?.trim();
    if (!apiKey) return c.json({ error: 'apiKey_required' }, 400);
    const baseUrl = body?.baseUrl?.trim() || undefined;
    const wireParse = credentialWireShapeEnum.safeParse(body?.wireShape);
    // The workspace modal saves a single hand-entered shape; capture it as a
    // one-entry wires map (the vault can later add more shapes for the same key —
    // dedup-by-key upgrades in place). Subscriptions never flow through here.
    const cred: Credential = {
      vendor: inferCredentialVendor({ agent: body?.agent, baseUrl }),
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
