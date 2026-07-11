/**
 * POST /:id/headless — the automation dispatch route. Covers the validation /
 * agent-resolution / dispatch branches against a stubbed WorkspaceService
 * (no real spawn). Modeled on trading-config.spec's harness.
 */
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createWorkspaceRoutes } from './workspaces.js';
import { HeadlessCapacityError, type WorkspaceService } from '../../workspaces/service.js';
import { readWorkspaceMetadata } from '../../workspaces/workspace-metadata.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

const HEADLESS_RESULT = {
  command: ['claude'],
  cwd: '/w',
  exitCode: 0,
  signal: null,
  killed: false,
  durationMs: 5,
  stdoutTail: 'ok',
  stderrTail: '',
};

function build(
  opts: {
    meta?: any;
    adapters?: Record<string, any>;
    resolveTo?: any;
    dispatch?: any;
    runtimeReadiness?: any;
    resumeIdentity?: any;
  } = {},
) {
  const claude = {
    id: 'claude',
    capabilities: { headless: true },
    composeHeadlessCommand: () => [],
    bootstrap: vi.fn(async () => {}),
  };
  const meta = opts.meta ?? { id: 'ws-1', dir: '/w', agents: ['claude'] };
  const adapters = opts.adapters ?? { claude };
  const runHeadlessTask = vi.fn(async () => HEADLESS_RESULT);
  const dispatchHeadlessTask = opts.dispatch ?? vi.fn(async () => ({ taskId: 'task-1', resumeId: 'resume-1' }));
  const runtimeReadiness = opts.runtimeReadiness ?? {
    agents: {
      claude: {
        agent: 'claude',
        displayName: 'Claude',
        installed: true,
        binPath: '/usr/bin/claude',
        status: 'unknown',
        ready: false,
        source: 'unknown',
        checkedAt: null,
        durationMs: null,
      },
    },
    overallReady: false,
    checkedAt: null,
  };
  const getAgentRuntimeReadiness = vi.fn(() => runtimeReadiness);
  const probeAgentRuntimeReadiness = vi.fn(async () => ({
    ...runtimeReadiness,
    overallReady: true,
    checkedAt: '2026-07-08T00:00:00.000Z',
    agents: {
      ...runtimeReadiness.agents,
      claude: {
        ...runtimeReadiness.agents.claude,
        status: 'ready',
        ready: true,
        source: 'global-login',
        checkedAt: '2026-07-08T00:00:00.000Z',
      },
    },
  }));
  const svc = {
    registry: { get: (id: string) => (id === 'ws-1' ? meta : undefined) },
    adapters: { get: (a: string) => adapters[a] },
    resolveDefaultAgentId: vi.fn(async (m: any) => m.agents[0]),
    resolveAdapter: (_m: any, a?: string) => opts.resolveTo ?? adapters[a ?? 'claude'] ?? claude,
    config: { launcherRepoRoot: '/repo' },
    runHeadlessTask,
    dispatchHeadlessTask,
    resumeRegistry: {
      get: vi.fn(() => opts.resumeIdentity ?? null),
      ensure: vi.fn(async (input: any) => ({ resumeId: input.resumeId ?? 'resume-1', ...input })),
    },
    getAgentRuntimeReadiness,
    probeAgentRuntimeReadiness,
    publicMeta: vi.fn(async (m: any) => {
      const res = await readWorkspaceMetadata(m.dir);
      return { ...m, ...(res.ok ? res.metadata : {}) };
    }),
  } as unknown as WorkspaceService;
  return {
    app: createWorkspaceRoutes(svc),
    runHeadlessTask,
    dispatchHeadlessTask,
    getAgentRuntimeReadiness,
    probeAgentRuntimeReadiness,
  };
}

async function post(app: any, path: string, body?: unknown) {
  const res = await app.request(path, {
    method: 'POST',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = res.status === 204 ? null : await res.json().catch(() => null);
  return { status: res.status, body: json as any };
}

async function patch(app: any, path: string, body?: unknown) {
  const res = await app.request(path, {
    method: 'PATCH',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as any };
}

describe('PATCH /:id/metadata', () => {
  it('writes workspace-owned display metadata without changing launcher identity', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workspace-route-meta-'));
    try {
      const meta = { id: 'ws-1', tag: 'aapl-q1', dir, agents: ['claude'] };
      const { app } = build({ meta });

      const r = await patch(app, '/ws-1/metadata', { displayName: 'AAPL earnings review' });
      expect(r.status).toBe(200);
      expect(r.body.workspace).toMatchObject({
        id: 'ws-1',
        tag: 'aapl-q1',
        displayName: 'AAPL earnings review',
      });

      const readBack = await readWorkspaceMetadata(dir);
      expect(readBack).toEqual({ ok: true, metadata: { displayName: 'AAPL earnings review' } });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('ignores attempts to smuggle registry fields into workspace metadata', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'workspace-route-meta-'));
    try {
      const { app } = build({ meta: { id: 'ws-1', tag: 'stable-tag', dir, agents: ['claude'] } });
      const r = await patch(app, '/ws-1/metadata', { displayName: 'Nice label', id: 'different' });

      expect(r.status).toBe(200);
      expect(r.body.workspace.id).toBe('ws-1');
      expect(r.body.workspace.tag).toBe('stable-tag');
      expect(r.body.workspace.displayName).toBe('Nice label');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('agent runtime readiness routes', () => {
  it('GET returns the cached snapshot without triggering a probe', async () => {
    const { app, getAgentRuntimeReadiness, probeAgentRuntimeReadiness } = build();
    const res = await app.request('/agent-runtime-readiness');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.overallReady).toBe(false);
    expect(getAgentRuntimeReadiness).toHaveBeenCalledOnce();
    expect(probeAgentRuntimeReadiness).not.toHaveBeenCalled();
  });

  it('POST /probe runs all runtimes by default or one requested runtime', async () => {
    const { app, probeAgentRuntimeReadiness } = build();
    const all = await post(app, '/agent-runtime-readiness/probe', {});
    const one = await post(app, '/agent-runtime-readiness/probe', { agent: 'claude' });

    expect(all.status).toBe(200);
    expect(all.body.overallReady).toBe(true);
    expect(one.status).toBe(200);
    expect(probeAgentRuntimeReadiness).toHaveBeenNthCalledWith(1, undefined);
    expect(probeAgentRuntimeReadiness).toHaveBeenNthCalledWith(2, 'claude');
  });

  it('POST /probe rejects unknown or utility agents before probing', async () => {
    const shell = { id: 'shell', kind: 'utility', capabilities: {} };
    const { app, probeAgentRuntimeReadiness } = build({ adapters: { shell } });
    const unknown = await post(app, '/agent-runtime-readiness/probe', { agent: 'ghost' });
    const utility = await post(app, '/agent-runtime-readiness/probe', { agent: 'shell' });

    expect(unknown.status).toBe(400);
    expect(unknown.body.error).toBe('unknown_agent');
    expect(utility.status).toBe(400);
    expect(utility.body.error).toBe('unknown_agent');
    expect(probeAgentRuntimeReadiness).not.toHaveBeenCalled();
  });
});

describe('POST /:id/headless', () => {
  it('404 on a malformed workspace id', async () => {
    const { app } = build();
    expect((await post(app, '/bad.id/headless', { prompt: 'x' })).status).toBe(404);
  });

  it('400 prompt_required on empty or whitespace-only prompt', async () => {
    const { app } = build();
    expect((await post(app, '/ws-1/headless', { prompt: '' })).body.error).toBe('prompt_required');
    expect((await post(app, '/ws-1/headless', { prompt: '   ' })).body.error).toBe('prompt_required');
  });

  it('400 prompt_too_long over 16000 chars', async () => {
    const { app } = build();
    expect((await post(app, '/ws-1/headless', { prompt: 'a'.repeat(16001) })).body.error).toBe('prompt_too_long');
  });

  it('404 workspace_not_found for an unknown workspace', async () => {
    const { app } = build();
    const r = await post(app, '/ws-nope/headless', { prompt: 'x' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('workspace_not_found');
  });

  it('400 unknown_agent when the agent is not a registered adapter', async () => {
    const { app } = build();
    expect((await post(app, '/ws-1/headless', { prompt: 'x', agent: 'ghost' })).body.error).toBe('unknown_agent');
  });

  it('400 agent_not_enabled when the agent exists but is not on the workspace', async () => {
    const codex = { id: 'codex', capabilities: { headless: true }, composeHeadlessCommand: () => [] };
    const { app } = build({
      meta: { id: 'ws-1', dir: '/w', agents: ['claude'] },
      adapters: { claude: { id: 'claude', capabilities: { headless: true } }, codex },
    });
    expect((await post(app, '/ws-1/headless', { prompt: 'x', agent: 'codex' })).body.error).toBe('agent_not_enabled');
  });

  it('400 no_headless when the resolved adapter has no headless mode', async () => {
    const shell = { id: 'shell', capabilities: {} };
    const { app } = build({ meta: { id: 'ws-1', dir: '/w', agents: ['shell'] }, adapters: { shell }, resolveTo: shell });
    expect((await post(app, '/ws-1/headless', { prompt: 'x', agent: 'shell' })).body.error).toBe('no_headless');
  });

  it('clamps timeoutMs to <= 1_800_000 and defaults to 300_000', async () => {
    const { app, dispatchHeadlessTask } = build();
    await post(app, '/ws-1/headless', { prompt: 'x', timeoutMs: 9e9 });
    expect(dispatchHeadlessTask).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'x', 1_800_000);
    await post(app, '/ws-1/headless', { prompt: 'x' });
    expect(dispatchHeadlessTask).toHaveBeenLastCalledWith(expect.anything(), expect.anything(), 'x', 300_000);
  });

  it('continues a headless conversation by product resumeId only', async () => {
    const { app, dispatchHeadlessTask } = build({
      resumeIdentity: {
        resumeId: 'resume-1', wsId: 'ws-1', agent: 'claude', agentSessionId: 'native-hidden',
      },
    });
    const response = await post(app, '/ws-1/headless', { prompt: 'follow up', resumeId: 'resume-1' });
    expect(response.status).toBe(202);
    expect(response.body).toMatchObject({ taskId: 'task-1', resumeId: 'resume-1' });
    expect(dispatchHeadlessTask).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'follow up', 300_000, undefined, 'resume-1',
    );
  });

  it('does not allow wait:true to bypass recorded resume lineage', async () => {
    const { app, dispatchHeadlessTask } = build({
      resumeIdentity: { resumeId: 'resume-1', wsId: 'ws-1', agent: 'claude' },
    });
    const response = await post(app, '/ws-1/headless', {
      prompt: 'follow up', resumeId: 'resume-1', wait: true,
    });
    expect(response.status).toBe(400);
    expect(response.body.error).toBe('resume_requires_async');
    expect(dispatchHeadlessTask).not.toHaveBeenCalled();
  });

  it('async by default → 202 + taskId, dispatches in the background', async () => {
    const { app, dispatchHeadlessTask, runHeadlessTask } = build();
    const r = await post(app, '/ws-1/headless', { prompt: 'do the thing' });
    expect(r.status).toBe(202);
    expect(r.body.taskId).toBe('task-1');
    expect(r.body.status).toBe('running');
    expect(dispatchHeadlessTask).toHaveBeenCalledOnce();
    expect(runHeadlessTask).not.toHaveBeenCalled(); // async path doesn't await the run
  });

  it('wait:true → 200 + the full sync result', async () => {
    const { app, runHeadlessTask, dispatchHeadlessTask } = build();
    const r = await post(app, '/ws-1/headless', { prompt: 'do the thing', wait: true });
    expect(r.status).toBe(200);
    expect(r.body.exitCode).toBe(0);
    expect(runHeadlessTask).toHaveBeenCalledOnce();
    expect(dispatchHeadlessTask).not.toHaveBeenCalled();
  });

  it('429 when the concurrency cap is hit', async () => {
    const dispatch = vi.fn(async () => {
      throw new HeadlessCapacityError(8);
    });
    const { app } = build({ dispatch });
    const r = await post(app, '/ws-1/headless', { prompt: 'x' });
    expect(r.status).toBe(429);
    expect(r.body.error).toBe('capacity');
  });
});

describe('POST /:id/headless/:taskId/session', () => {
  function buildHeadlessSession(opts: { task?: any } = {}) {
    const records = new Map<string, any>();
    const live = new Map<string, any>();
    const adapter = {
      id: 'codex',
      namePrefix: 'x',
      capabilities: { resumeById: true, resumeLast: true },
      bootstrap: vi.fn(async () => {}),
    };
    const task = opts.task ?? {
      taskId: 'run-1',
      resumeId: 'resume-run-1',
      wsId: 'ws-1',
      agent: 'codex',
      prompt: 'Investigate the earnings anomaly',
      status: 'done',
      agentSessionId: '019eb75e-0b1b-7fa2',
    };
    const spawn = vi.fn((_wsId: string, ctx: any) => {
      const session = {
        recordId: ctx.recordId,
        wsId: 'ws-1',
        name: ctx.recordName,
        pid: 4242,
        startedAt: 123,
        agentSessionId: '019eb75e-0b1b-7fa2',
      };
      live.set(ctx.recordId, session);
      return session;
    });
    const sessionRegistry = {
      ensureLoaded: vi.fn(async () => {}),
      findByResumeId: (_wsId: string, resumeId: string) =>
        Array.from(records.values()).find((record) => record.resumeId === resumeId),
      findBySourceRunId: (_wsId: string, runId: string) =>
        Array.from(records.values()).find((record) => record.sourceRunId === runId),
      findById: (id: string) => records.get(id),
      nextName: () => 'x1',
      create: vi.fn(async (record: any) => { records.set(record.id, record); }),
      get: (_wsId: string, id: string) => records.get(id),
      remove: vi.fn(async (_wsId: string, id: string) => records.delete(id)),
    };
    const resumeRecords = new Map<string, any>();
    if (task.resumeId) {
      resumeRecords.set(task.resumeId, {
        resumeId: task.resumeId,
        wsId: task.wsId ?? 'ws-1',
        agent: task.agent ?? 'codex',
        agentSessionId: task.agentSessionId ?? '019eb75e-0b1b-7fa2',
        latestTaskId: task.taskId,
      });
    }
    const svc = {
      registry: { get: (id: string) => id === 'ws-1' ? { id, dir: '/w', agents: ['codex'] } : undefined },
      headlessTasks: { get: (id: string) => id === task.taskId ? task : null },
      sessionRegistry,
      resumeRegistry: {
        get: (id: string) => resumeRecords.get(id) ?? null,
        ensure: vi.fn(async (input: any) => {
          const prior = resumeRecords.get(input.resumeId) ?? {};
          const record = { ...prior, ...input, resumeId: input.resumeId ?? 'resume-created' };
          resumeRecords.set(record.resumeId, record);
          return record;
        }),
      },
      adapters: { get: (id: string) => id === 'codex' ? adapter : undefined },
      resolveAdapter: () => adapter,
      getAgentRuntimeReadiness: () => ({
        agents: { codex: { ready: true, source: 'global-login' } },
      }),
      config: { launcherRepoRoot: '/repo' },
      pool: { get: (id: string) => live.get(id), spawn },
    } as unknown as WorkspaceService;
    return { app: createWorkspaceRoutes(svc), records, spawn };
  }

  it('materializes one persistent Session and reuses it on repeated opens', async () => {
    const { app, records, spawn } = buildHeadlessSession();
    const first = await post(app, '/ws-1/headless/run-1/session');
    const second = await post(app, '/ws-1/headless/run-1/session');

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.session.id).toBe(first.body.session.id);
    expect(spawn).toHaveBeenCalledOnce();
    expect(Array.from(records.values())[0]).toMatchObject({
      sourceRunId: 'run-1',
      resumeId: 'resume-run-1',
      title: 'Investigate the earnings anomaly',
      resumeHint: { kind: 'agent-session-id', value: '019eb75e-0b1b-7fa2' },
    });
  });

  it('coalesces simultaneous opens so one native conversation gets one Session', async () => {
    const { app, spawn } = buildHeadlessSession();
    const [first, second] = await Promise.all([
      post(app, '/ws-1/headless/run-1/session'),
      post(app, '/ws-1/headless/run-1/session'),
    ]);

    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body.session.id).toBe(second.body.session.id);
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('opens the same conversation directly by resumeId without a native id in the request', async () => {
    const { app } = buildHeadlessSession();
    const opened = await post(app, '/ws-1/resumes/resume-run-1/session', {
      title: 'Durable Inbox report',
    });

    expect(opened.status).toBe(201);
    expect(opened.body.session).toMatchObject({
      sourceRunId: 'run-1',
      resumeId: 'resume-run-1',
    });
  });

  it('does not resume a headless run while it is still writing the conversation', async () => {
    const { app, spawn } = buildHeadlessSession({
      task: {
        taskId: 'run-1',
        resumeId: 'resume-run-1',
        wsId: 'ws-1',
        agent: 'codex',
        prompt: 'Still running',
        status: 'running',
        agentSessionId: '019eb75e-0b1b-7fa2',
      },
    });
    const opened = await post(app, '/ws-1/headless/run-1/session');

    expect(opened.status).toBe(409);
    expect(opened.body.error).toBe('run_still_running');
    expect(spawn).not.toHaveBeenCalled();
  });
});

describe('POST /:id/sessions/:sid/resume — concurrent coalescing (ANG-120)', () => {
  const TOKEN = 'claude-calm-amber-river';

  function buildResume() {
    const session = {
      recordId: TOKEN,
      wsId: 'ws-1',
      name: 'c1',
      pid: 4242,
      startedAt: 1,
      waitForFirstExit: vi.fn(async () => null), // stays up
    };
    let live: unknown = undefined; // what pool.get returns; set once spawned
    const spawn = vi.fn(() => {
      live = session;
      return session;
    });
    const record = {
      id: TOKEN,
      resumeId: 'resume-aid',
      wsId: 'ws-1',
      agent: 'claude',
      name: 'c1',
      state: 'paused',
      resumeHint: { kind: 'agent-session-id', value: 'aid' },
    };
    const adapter = { id: 'claude', capabilities: { resumeById: true, resumeLast: false } };
    const svc = {
      sessionRegistry: { get: () => record, update: vi.fn(async () => {}) },
      resumeRegistry: { get: () => ({ agentSessionId: 'aid' }) },
      pool: { get: () => live, spawn, disposeToken: vi.fn() },
      registry: { get: () => ({ id: 'ws-1', dir: '/w', agents: ['claude'] }) },
      adapters: { get: () => adapter },
      computeSpawnPlan: () => ({
        spawnCwd: '/w',
        envPWD: '/w',
        transcriptDir: null,
        projectKey: 'k',
        composedCommand: ['claude'],
        resumeMode: 'by-id',
        nativeSessionId: 'aid',
      }),
      config: { launcherRepoRoot: '/repo' },
    } as unknown as WorkspaceService;
    return { app: createWorkspaceRoutes(svc), spawn };
  }

  it('two simultaneous resumes spawn the agent exactly once', async () => {
    const { app, spawn } = buildResume();
    const path = `/ws-1/sessions/${TOKEN}/resume`;
    const [a, b] = await Promise.all([post(app, path), post(app, path)]);

    expect(spawn).toHaveBeenCalledOnce(); // no double-spawn racing one transcript
    // both succeed: one really resumed, the other coalesced to alreadyRunning
    expect(a.body.ok).toBe(true);
    expect(b.body.ok).toBe(true);
    expect([a.body, b.body].filter((x) => x.alreadyRunning)).toHaveLength(1);
  });
});
