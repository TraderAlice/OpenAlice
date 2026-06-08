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

import { probeAnthropic, probeOpenAI } from '../../workspaces/agent-probe.js';
import { listDir, PathTraversal, readWorkspaceFile } from '../../workspaces/file-service.js';
import { gitLog, gitStatus } from '../../workspaces/git-service.js';
import { logger as launcherLogger } from '../../workspaces/logger.js';
import type { SessionRecord } from '../../workspaces/session-registry.js';
import { HeadlessCapacityError, resumeFromRecord, type SessionFactoryContext, type WorkspaceService } from '../../workspaces/service.js';
import type { WorkspaceAiCred } from '../../workspaces/cli-adapter.js';
import { addCredential, readCredentials, type Credential } from '../../core/config.js';
import { inferCredentialVendor } from '../../core/credential-inference.js';

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function createWorkspaceRoutes(svc: WorkspaceService): Hono {
  const app = new Hono();

  // ── templates / agents ───────────────────────────────────────────────────

  app.get('/templates', (c) => {
    return c.json({
      templates: svc.templates.list().map((t) => ({
        name: t.name,
        ...(t.description !== undefined ? { description: t.description } : {}),
        ...(t.displayName !== undefined ? { displayName: t.displayName } : {}),
        ...(t.groupOrder !== undefined ? { groupOrder: t.groupOrder } : {}),
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
    return c.json({
      agents: svc.adapters.list().map((a) => ({
        id: a.id,
        displayName: a.displayName,
        capabilities: a.capabilities,
      })),
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
    const rawToolAccess = fields['toolAccess'];
    const toolAccess = rawToolAccess === 'cli' ? 'cli' : rawToolAccess === 'mcp' ? 'mcp' : undefined;
    const result = await svc.creator.create(
      tag,
      templateName,
      agentsRequested && agentsRequested.length > 0 ? agentsRequested : undefined,
      { toolAccess },
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
    try {
      const body = await safeJson(c);
      const fields = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      const raw = fields['resume'];
      if (raw === 'last') resume = 'last';
      else if (typeof raw === 'string' && SESSION_ID_RE.test(raw)) resume = { sessionId: raw };
      const rawAgent = fields['agent'];
      if (typeof rawAgent === 'string' && rawAgent.length > 0) agentId = rawAgent;
    } catch (err) {
      return c.json({ error: 'bad_request', message: (err as Error).message }, 400);
    }
    if (agentId && !svc.adapters.get(agentId)) {
      return c.json({ error: 'unknown_agent', message: `no adapter: ${agentId}` }, 400);
    }
    const adapter = svc.resolveAdapter(meta, agentId);
    try {
      if (adapter.bootstrap) {
        await adapter.bootstrap({
          wsId: id,
          cwd: meta.dir,
          launcherRepoRoot: svc.config.launcherRepoRoot,
        });
      }
    } catch (err) {
      launcherLogger.error('adapter.bootstrap_failed', { id, agent: adapter.id, err });
      return c.json({ error: 'bootstrap_failed', message: (err as Error).message }, 500);
    }
    await svc.sessionRegistry.ensureLoaded(id);
    const prefix = adapter.namePrefix ?? adapter.id[0] ?? 's';
    const recordId = randomUUID();
    const recordName = svc.sessionRegistry.nextName(id, adapter.id, prefix);
    const nowIso = new Date().toISOString();
    const record: SessionRecord = {
      id: recordId,
      wsId: id,
      agent: adapter.id,
      name: recordName,
      createdAt: nowIso,
      lastActiveAt: nowIso,
      state: 'running',
    };
    try {
      await svc.sessionRegistry.create(record);
    } catch (err) {
      launcherLogger.error('session_registry.create_failed', { id, recordId, err });
      return c.json({ error: 'registry_failed', message: (err as Error).message }, 500);
    }
    try {
      const ctx: SessionFactoryContext = {
        ...(resume !== undefined ? { resume } : {}),
        ...(agentId !== undefined ? { agentId } : {}),
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
      });
      return c.json({
        sessionId: session.recordId,
        wsId: session.wsId,
        name: session.name,
        pid: session.pid,
        agent: adapter.id,
        agentSessionId: session.agentSessionId,
        startedAt: session.startedAt,
      }, 201);
    } catch (err) {
      await svc.sessionRegistry.remove(id, recordId).catch(() => undefined);
      launcherLogger.error('workspace.session_spawn_failed', { id, err });
      return c.json({ error: 'spawn_failed', message: (err as Error).message }, 500);
    }
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
    const record = svc.sessionRegistry.get(id, token);
    if (!record) return c.json({ error: 'not_found' }, 404);
    if (record.state === 'running' && svc.pool.get(token)) {
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
    launcherLogger.info('path.trace', {
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
    // (→ workspace default) stays fine.
    if (agentId && !meta.agents.includes(agentId)) {
      return c.json({ error: 'agent_not_enabled', message: `agent "${agentId}" not enabled on this workspace` }, 400);
    }
    const adapter = svc.resolveAdapter(meta, agentId);
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

  app.get('/agent-profiles', async (c) => {
    try {
      const raw = await readFile(resolvePath('data/config/ai-provider-manager.json'), 'utf8');
      const parsed = JSON.parse(raw) as { profiles?: Record<string, ProfileShape> };
      const profiles = parsed.profiles ?? {};
      const list = Object.entries(profiles).map(([name, p]) => ({
        name,
        baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : null,
        apiKey: typeof p.apiKey === 'string' ? p.apiKey : null,
        model: typeof p.model === 'string' ? p.model : null,
        authMode: p.authMode === 'bearer' ? 'bearer' : p.authMode === 'x-api-key' ? 'x-api-key' : null,
      }));
      return c.json({ profiles: list });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') return c.json({ profiles: [] });
      launcherLogger.warn('agent_profiles.read_failed', { err });
      return c.json({ error: 'profiles_read_failed', message: (err as Error).message }, 500);
    }
  });

  // Central credential store, surfaced to the workspace AI-config modal. The
  // "Load from saved credential" picker reads this list; the "Save to Alice"
  // dialog POSTs here so a hand-entered provider becomes reusable. apiKey is
  // returned so the picker can flash it into the form (same exposure as the
  // legacy agent-profiles route; both are behind the admin-token gate).
  app.get('/credentials', async (c) => {
    try {
      const credentials = await readCredentials();
      const list = Object.entries(credentials).map(([slug, cred]) => ({
        slug,
        vendor: cred.vendor,
        authType: cred.authType,
        baseUrl: cred.baseUrl ?? null,
        apiKey: cred.apiKey ?? null,
      }));
      return c.json({ credentials: list });
    } catch (err) {
      launcherLogger.warn('credentials.read_failed', { err });
      return c.json({ error: 'credentials_read_failed', message: (err as Error).message }, 500);
    }
  });

  app.post('/credentials', async (c) => {
    const body = (await safeJson(c)) as
      | { apiKey?: string; baseUrl?: string; agent?: string; vendor?: string }
      | null;
    const apiKey = body?.apiKey?.trim();
    if (!apiKey) return c.json({ error: 'apiKey_required' }, 400);
    const baseUrl = body?.baseUrl?.trim() || undefined;
    // Subscriptions never flow through the workspace modal — these are always
    // api-key credentials.
    const cred: Credential = {
      vendor: inferCredentialVendor({ agent: body?.agent, baseUrl }),
      authType: 'api-key',
      apiKey,
      ...(baseUrl ? { baseUrl } : {}),
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
    if (!baseUrl || !apiKey || !model) {
      return c.json({ ok: false, error: 'baseUrl, apiKey, and model are all required' }, 400);
    }

    try {
      // opencode and pi both drive providers through OpenAI Chat Completions
      // (opencode via @ai-sdk/openai-compatible, pi via api:"openai-completions")
      // — so their provider test probes with wireApi 'chat' (not 'responses',
      // which is codex-only).
      const result = agent === 'claude'
        ? await probeAnthropic({
            baseUrl,
            apiKey,
            model,
            authMode: body?.authMode === 'bearer' ? 'bearer' : 'x-api-key',
          })
        : await probeOpenAI({
            baseUrl,
            apiKey,
            model,
            wireApi: (agent === 'opencode' || agent === 'pi')
              ? 'chat'
              : body?.wireApi === 'chat' ? 'chat' : 'responses',
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

interface ProfileShape {
  baseUrl?: unknown;
  apiKey?: unknown;
  model?: unknown;
  authMode?: unknown;
}

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
