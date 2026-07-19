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
import { TemplateUpgradeError } from '../../workspaces/template-upgrade.js';
import { WorkspaceAbsorbError } from '../../workspaces/workspace-absorb.js';
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
    sessionDirectory?: any;
    lifecycle?: any;
    templateUpgrades?: any;
    workspaceAbsorbs?: any;
  } = {},
) {
  const claude = {
    id: 'claude',
    capabilities: { headless: true },
    composeHeadlessCommand: () => [],
    lifecycle: { prepareWorkspace: vi.fn(async () => {}) },
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
  const lifecycle = opts.lifecycle ?? {
    listDeparted: vi.fn(() => []),
    assess: vi.fn(async () => null),
    offboard: vi.fn(async () => ({ ok: true, workspace: { id: 'ws-1', lifecycle: 'departed' }, assessment: {} })),
    restore: vi.fn(async () => ({ ok: true, workspace: { id: 'ws-1', lifecycle: 'active' }, assessment: {} })),
    purge: vi.fn(async () => ({ ok: true, workspace: { id: 'ws-1', lifecycle: 'purged' }, assessment: {} })),
  };
  const templateUpgrades = opts.templateUpgrades ?? {
    plan: vi.fn(async () => ({ workspaceId: 'ws-1', planDigest: 'digest-1' })),
    apply: vi.fn(async () => ({
      workspaceId: 'ws-1', fromVersion: '1.0.0', toVersion: '2.0.0',
      commit: 'abc123', changedPaths: ['README.md'], keptPaths: [],
    })),
  };
  const workspaceAbsorbs = opts.workspaceAbsorbs ?? {
    plan: vi.fn(async () => ({
      source: { id: 'ws-2', tag: 'source' },
      target: { id: 'ws-1', tag: 'target' },
      planDigest: 'absorb-digest-1',
    })),
    apply: vi.fn(async () => ({
      sourceWorkspaceId: 'ws-2', targetWorkspaceId: 'ws-1', commit: 'absorb123',
      changedPaths: ['research/new.md'], skippedPaths: [], departedDir: '/departed/ws-2',
    })),
  };
  const svc = {
    registry: { get: (id: string) => (id === 'ws-1' ? meta : undefined) },
    adapters: { get: (a: string) => adapters[a] },
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
    lifecycle,
    templateUpgrades,
    workspaceAbsorbs,
    sessionDirectory: vi.fn(async (id: string) => id === 'ws-1'
      ? (opts.sessionDirectory ?? {
          workspace: { id: 'ws-1', tag: 'demo' },
          sessions: [{ resumeId: 'resume-1', agent: 'claude', createdAt: 1, updatedAt: 2, resumable: true, active: false }],
        })
      : null),
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
    lifecycle,
    templateUpgrades,
    workspaceAbsorbs,
  };
}

async function get(app: any, path: string) {
  const res = await app.request(path)
  return { status: res.status, body: await res.json().catch(() => null) as any }
}

describe('GET /:id/resumes', () => {
  it('returns the safe product Session directory', async () => {
    const { app } = build()
    const result = await get(app, '/ws-1/resumes')
    expect(result.status).toBe(200)
    expect(result.body.sessions).toEqual([
      expect.objectContaining({ resumeId: 'resume-1', agent: 'claude', resumable: true }),
    ])
    expect(JSON.stringify(result.body)).not.toContain('agentSessionId')
  })
})

describe('GET /signatures/:resumeId', () => {
  it('resolves a globally signed Session without exposing its native runtime id', async () => {
    const { app } = build({ resumeIdentity: {
      resumeId: 'resume-kind-owl-abc123', wsId: 'ws-peer', agent: 'codex', agentSessionId: 'native-secret',
    } })
    const result = await get(app, '/signatures/resume-kind-owl-abc123')
    expect(result.status).toBe(200)
    expect(result.body).toEqual({
      signature: '@resume-kind-owl-abc123',
      resumeId: 'resume-kind-owl-abc123',
      workspaceId: 'ws-peer',
      agent: 'codex',
      resumable: true,
    })
    expect(JSON.stringify(result.body)).not.toContain('native-secret')
  })
})

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

async function del(app: any, path: string) {
  const res = await app.request(path, { method: 'DELETE' });
  return { status: res.status, body: await res.json().catch(() => null) as any };
}

describe('Workspace lifecycle routes', () => {
  it('lists departed Workspaces and restores one through the lifecycle manager', async () => {
    const lifecycle = {
      listDeparted: vi.fn(() => [{ id: 'ws-old', lifecycle: 'departed' }]),
      restore: vi.fn(async () => ({ ok: true, workspace: { id: 'ws-old', lifecycle: 'active' }, assessment: {} })),
      assess: vi.fn(), offboard: vi.fn(), purge: vi.fn(),
    };
    const { app } = build({ lifecycle });
    expect(await get(app, '/departed')).toMatchObject({
      status: 200,
      body: { workspaces: [{ id: 'ws-old', lifecycle: 'departed' }] },
    });
    expect((await post(app, '/departed/ws-old/restore')).status).toBe(200);
    expect(lifecycle.restore).toHaveBeenCalledWith('ws-old');
  });

  it('maps a live-run offboarding blocker to 409 without deleting state', async () => {
    const lifecycle = {
      listDeparted: vi.fn(), restore: vi.fn(), assess: vi.fn(), purge: vi.fn(),
      offboard: vi.fn(async () => ({
        ok: false, code: 'blocked', message: '1 headless run is still active',
        assessment: { canOffboard: false },
      })),
    };
    const { app } = build({ lifecycle });
    const result = await del(app, '/ws-1');
    expect(result).toMatchObject({
      status: 409,
      body: { error: 'blocked', assessment: { canOffboard: false } },
    });
  });

  it('purges only through the departed route', async () => {
    const lifecycle = {
      listDeparted: vi.fn(), restore: vi.fn(), assess: vi.fn(), offboard: vi.fn(),
      purge: vi.fn(async () => ({ ok: true, workspace: { id: 'ws-old', lifecycle: 'purged' }, assessment: {} })),
    };
    const { app } = build({ lifecycle });
    expect((await del(app, '/departed/ws-old')).status).toBe(200);
    expect(lifecycle.purge).toHaveBeenCalledWith('ws-old');
  });
});

describe('Workspace template upgrade routes', () => {
  it('returns a review plan and applies only the accepted resolution values', async () => {
    const templateUpgrades = {
      plan: vi.fn(async () => ({ workspaceId: 'ws-1', planDigest: 'digest-1' })),
      apply: vi.fn(async () => ({
        workspaceId: 'ws-1', fromVersion: '1.0.0', toVersion: '2.0.0',
        commit: 'abc123', changedPaths: ['README.md'], keptPaths: ['AGENTS.md'],
      })),
    };
    const { app } = build({ templateUpgrades });

    expect(await get(app, '/ws-1/template-upgrade')).toMatchObject({
      status: 200,
      body: { plan: { planDigest: 'digest-1' } },
    });
    const applied = await post(app, '/ws-1/template-upgrade', {
      planDigest: 'digest-1',
      resolutions: { 'AGENTS.md': 'workspace', 'README.md': 'anything-else' },
    });
    expect(applied.status).toBe(200);
    expect(templateUpgrades.apply).toHaveBeenCalledWith('ws-1', {
      planDigest: 'digest-1',
      resolutions: { 'AGENTS.md': 'workspace' },
    });
  });

  it('maps a changed preview to a recoverable 409 with the refreshed plan', async () => {
    const refreshed = { workspaceId: 'ws-1', planDigest: 'digest-2' } as any;
    const templateUpgrades = {
      plan: vi.fn(),
      apply: vi.fn(async () => {
        throw new TemplateUpgradeError('stale_plan', 'Review the refreshed plan.', refreshed);
      }),
    };
    const { app } = build({ templateUpgrades });
    const result = await post(app, '/ws-1/template-upgrade', { planDigest: 'digest-1' });

    expect(result).toMatchObject({
      status: 409,
      body: { error: 'stale_plan', plan: { planDigest: 'digest-2' } },
    });
  });

  it('rejects apply requests without a reviewed plan digest', async () => {
    const { app, templateUpgrades } = build();
    const result = await post(app, '/ws-1/template-upgrade', {});
    expect(result).toMatchObject({ status: 400, body: { error: 'bad_request' } });
    expect(templateUpgrades.apply).not.toHaveBeenCalled();
  });
});

describe('Workspace absorb routes', () => {
  it('previews a direction and passes only supported conflict resolutions', async () => {
    const workspaceAbsorbs = {
      plan: vi.fn(async () => ({
        source: { id: 'ws-2', tag: 'source' }, target: { id: 'ws-1', tag: 'target' },
        planDigest: 'absorb-digest-1',
      })),
      apply: vi.fn(async () => ({
        sourceWorkspaceId: 'ws-2', targetWorkspaceId: 'ws-1', commit: 'abc123',
        changedPaths: ['research/new.md'], skippedPaths: [], departedDir: '/departed/ws-2',
      })),
    };
    const { app } = build({ workspaceAbsorbs });

    expect(await get(app, '/ws-1/absorb/ws-2')).toMatchObject({
      status: 200,
      body: { plan: { planDigest: 'absorb-digest-1' } },
    });
    const applied = await post(app, '/ws-1/absorb/ws-2', {
      planDigest: 'absorb-digest-1',
      resolutions: {
        'research/a.md': 'both',
        'research/b.md': 'source',
        'research/c.md': 'target',
        'research/d.md': 'delete',
      },
    });
    expect(applied.status).toBe(200);
    expect(workspaceAbsorbs.apply).toHaveBeenCalledWith({
      targetWorkspaceId: 'ws-1',
      sourceWorkspaceId: 'ws-2',
      planDigest: 'absorb-digest-1',
      resolutions: {
        'research/a.md': 'both',
        'research/b.md': 'source',
        'research/c.md': 'target',
      },
    });
  });

  it('returns a refreshed plan when the reviewed digest is stale', async () => {
    const refreshed = { source: { id: 'ws-2' }, target: { id: 'ws-1' }, planDigest: 'new' } as any;
    const workspaceAbsorbs = {
      plan: vi.fn(),
      apply: vi.fn(async () => {
        throw new WorkspaceAbsorbError(
          'stale_plan',
          'One Workspace changed after preview.',
          refreshed,
        );
      }),
    };
    const { app } = build({ workspaceAbsorbs });
    const result = await post(app, '/ws-1/absorb/ws-2', { planDigest: 'old' });
    expect(result).toMatchObject({
      status: 409,
      body: { error: 'stale_plan', plan: { planDigest: 'new' } },
    });
  });
});

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
      lifecycle: { prepareWorkspace: vi.fn(async () => {}) },
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

  function buildResume(workspaceId = 'ws-1', resolverOnly = false) {
    const session = {
      recordId: TOKEN,
      wsId: workspaceId,
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
      wsId: workspaceId,
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
      registry: { get: () => resolverOnly ? undefined : ({ id: workspaceId, dir: '/w', agents: ['claude'] }) },
      resolveRuntimeWorkspace: resolverOnly
        ? () => ({ id: workspaceId, dir: '/w', agents: ['claude'] })
        : undefined,
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

  it('resumes a native Manager runtime through the reserved runtime resolver', async () => {
    const { app, spawn } = buildResume('workspace-manager', true);
    const result = await post(app, `/workspace-manager/sessions/${TOKEN}/resume`);

    expect(result.body.ok).toBe(true);
    expect(spawn).toHaveBeenCalledOnce();
  });
});

describe('WebPi surface routes', () => {
  const TOKEN = 'pi-calm-amber-river';

  function buildWebPi() {
    const order: string[] = [];
    const record = {
      id: TOKEN,
      resumeId: 'resume-webpi',
      wsId: 'ws-1',
      agent: 'pi',
      name: 'p1',
      createdAt: '2026-07-12T00:00:00.000Z',
      lastActiveAt: '2026-07-12T00:00:00.000Z',
      state: 'running',
      surface: 'terminal',
    };
    const snapshot = {
      recordId: TOKEN,
      wsId: 'ws-1',
      resumeId: 'resume-webpi',
      pid: 9001,
      startedAt: 1,
      phase: 'idle',
      state: {},
      messages: [],
      streamingMessage: null,
      error: null,
      stderrTail: '',
      revision: 1,
    };
    const adapter = {
      id: 'pi',
      capabilities: { resumeById: true },
      readAiConfig: vi.fn(async () => ({ baseUrl: 'https://example.test', apiKey: 'test', model: 'model' })),
      writeAiConfig: vi.fn(async () => undefined),
      lifecycle: { prepareWorkspace: vi.fn(async () => { order.push('prepare-workspace'); }) },
    };
    const webPi = {
      get: vi.fn(() => snapshot),
      has: vi.fn(() => false),
      stop: vi.fn(async () => false),
      prompt: vi.fn(async () => ({ ...snapshot, phase: 'working' })),
      abort: vi.fn(async () => snapshot),
    };
    const svc = {
      registry: { get: () => ({ id: 'ws-1', dir: '/w', agents: ['pi'] }) },
      sessionRegistry: {
        get: () => record,
        update: vi.fn(async (_wsId: string, _id: string, patch: any) => Object.assign(record, patch)),
      },
      resumeRegistry: { get: () => ({ agentSessionId: 'native-pi' }) },
      adapters: { get: () => adapter },
      pool: {
        get: vi.fn(() => ({ pid: 123, startedAt: 1 })),
        disposeToken: vi.fn(() => { order.push('terminal-stopped'); return true; }),
      },
      webPi,
      startWebPiSession: vi.fn(async () => { order.push('webpi-started'); return snapshot; }),
      isResumeActive: vi.fn(() => false),
      config: { launcherRepoRoot: '/repo' },
    } as unknown as WorkspaceService;
    return { app: createWorkspaceRoutes(svc), order, svc, webPi };
  }

  it('hands an existing Pi Session from its PTY to WebPi', async () => {
    const { app, order, svc } = buildWebPi();
    const result = await post(app, `/ws-1/sessions/${TOKEN}/webpi/open`);
    expect(result.status).toBe(200);
    expect(result.body.snapshot).toMatchObject({ resumeId: 'resume-webpi', phase: 'idle' });
    expect(order).toEqual(['prepare-workspace', 'terminal-stopped', 'webpi-started']);
    expect(svc.startWebPiSession).toHaveBeenCalledOnce();
  });

  it('passes browser prompts straight to the live Pi RPC host', async () => {
    const { app, webPi } = buildWebPi();
    const result = await post(app, `/ws-1/sessions/${TOKEN}/webpi/prompt`, { message: 'hello Pi' });
    expect(result.status).toBe(200);
    expect(webPi.prompt).toHaveBeenCalledWith(TOKEN, 'hello Pi');
    expect(result.body.snapshot.phase).toBe('working');
  });

  it('returns a tiny unchanged response when the browser already has the revision', async () => {
    const { app } = buildWebPi();
    const result = await get(app, `/ws-1/sessions/${TOKEN}/webpi?revision=1`);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ unchanged: true, revision: 1 });
  });
});

describe('Workspace manager surface routes', () => {
  it('diagnoses a Manager Session through the reserved runtime workspace', async () => {
    const meta = {
      id: 'workspace-manager',
      tag: 'Workspace Manager',
      dir: '/floor/workspaces',
      agents: ['opencode'],
      createdAt: new Date(0).toISOString(),
    };
    const session = {
      id: 'opencode-manager-test',
      resumeId: 'resume-manager-test',
      wsId: meta.id,
      agent: 'opencode',
      name: 'o1',
      createdAt: '2026-07-16T00:00:00.000Z',
      lastActiveAt: '2026-07-16T00:01:00.000Z',
      state: 'running',
      surface: 'terminal',
      resumeHint: { kind: 'agent-session-id', value: 'native-opencode' },
    };
    const adapter = {
      id: 'opencode',
      capabilities: { resumeById: true, resumeLast: true },
    };
    const computeSpawnPlan = vi.fn(() => ({
      spawnCwd: meta.dir,
      envPWD: meta.dir,
      transcriptDir: null,
      projectKey: 'manager-key',
      composedCommand: ['opencode', '--session', 'native-opencode'],
      resumeMode: 'by-id',
      nativeSessionId: 'native-opencode',
    }));
    const svc = {
      registry: { get: vi.fn(() => undefined) },
      resolveRuntimeWorkspace: vi.fn((id: string) => id === meta.id ? meta : undefined),
      sessionRegistry: {
        ensureLoaded: vi.fn(async () => undefined),
        get: vi.fn((_wsId: string, id: string) => id === session.id ? session : undefined),
      },
      resumeRegistry: { get: vi.fn(() => ({ agentSessionId: 'native-opencode' })) },
      adapters: { get: vi.fn(() => adapter) },
      computeSpawnPlan,
      pool: {
        liveSessionsFor: vi.fn(() => [{
          id: session.id,
          pid: 92,
          startedAt: 2,
          agentSessionId: 'native-opencode',
        }]),
      },
      config: { launcherRepoRoot: '/repo' },
    } as unknown as WorkspaceService;

    const result = await get(
      createWorkspaceRoutes(svc),
      `/workspace-manager/sessions/${session.id}/diagnostics`,
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({
      workspace: { id: 'workspace-manager', dir: '/floor/workspaces' },
      record: { id: session.id, agent: 'opencode' },
      wouldResume: {
        mode: 'by-id',
        nativeSessionId: 'native-opencode',
        composedCommand: ['opencode', '--session', 'native-opencode'],
      },
    });
    expect(computeSpawnPlan).toHaveBeenCalledWith(
      meta,
      adapter,
      { sessionId: 'native-opencode' },
    );
  });

  it('starts a launcher-owned Pi conversation directly in WebPi with the manager contract', async () => {
    const meta = {
      id: 'workspace-manager',
      tag: 'Workspace Manager',
      dir: '/floor/workspaces',
      agents: ['pi'],
      createdAt: new Date(0).toISOString(),
    };
    let createdRecord: any = null;
    const adapter = {
      id: 'pi',
      namePrefix: 'p',
      capabilities: { resumeById: true },
      lifecycle: { prepareWorkspace: vi.fn(async () => undefined) },
    };
    const snapshot = {
      recordId: 'pi-manager-test',
      wsId: meta.id,
      resumeId: 'resume-manager-test',
      pid: 91,
      startedAt: 1,
      phase: 'working',
      state: {},
      messages: [],
      streamingMessage: null,
      error: null,
      stderrTail: '',
      revision: 1,
    };
    const startWebPiSession = vi.fn(async () => snapshot);
    const prompt = vi.fn(async () => snapshot);
    const disposeToken = vi.fn(() => true);
    const svc = {
      managerWorkspace: meta,
      registry: {
        list: () => [{ id: 'ws-1' }, { id: 'ws-2' }],
        get: () => undefined,
      },
      adapters: { get: (id: string) => id === 'pi' ? adapter : undefined },
      resolveAdapter: () => adapter,
      getAgentRuntimeReadiness: () => ({
        agents: { pi: { ready: true, source: 'managed-runtime' } },
      }),
      resumeRegistry: {
        get: vi.fn(() => null),
        ensure: vi.fn(async () => ({ resumeId: 'resume-manager-test' })),
      },
      sessionRegistry: {
        ensureLoaded: vi.fn(async () => undefined),
        findById: vi.fn(() => undefined),
        nextName: vi.fn(() => 'p1'),
        create: vi.fn(async (record: any) => { createdRecord = record; }),
        get: vi.fn(() => createdRecord),
        listFor: vi.fn(() => createdRecord ? [createdRecord] : []),
        update: vi.fn(async (_wsId: string, _recordId: string, patch: any) => {
          Object.assign(createdRecord, patch);
          return createdRecord;
        }),
        remove: vi.fn(async () => undefined),
      },
      pool: {
        get: vi.fn(() => undefined),
        spawn: vi.fn((_wsId: string, ctx: any) => ({
          recordId: ctx.recordId,
          wsId: meta.id,
          name: ctx.recordName,
          pid: 90,
          startedAt: 1,
        })),
        disposeToken,
      },
      startWebPiSession,
      webPi: { get: vi.fn(() => snapshot), prompt },
      config: { launcherRepoRoot: '/repo' },
    } as unknown as WorkspaceService;
    const app = createWorkspaceRoutes(svc);

    expect(await get(app, '/manager')).toMatchObject({
      status: 200,
      body: { manager: { id: 'workspace-manager', activeWorkspaceCount: 2, sessions: [] } },
    });

    const result = await post(app, '/manager/quick-start', { prompt: 'Audit the floor.' });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      manager: { id: 'workspace-manager', activeWorkspaceCount: 2 },
      session: { wsId: 'workspace-manager', agent: 'pi', surface: 'webpi' },
      snapshot: { phase: 'working' },
    });
    expect(disposeToken).toHaveBeenCalledWith(createdRecord.id, 'switch fresh manager Session to WebPi');
    expect(startWebPiSession).toHaveBeenCalledWith(
      meta,
      createdRecord,
      expect.objectContaining({
        approveProject: true,
        appendSystemPrompt: expect.stringContaining('Workspace Manager'),
        skills: [join('/repo', 'default', 'skills', 'workspace-manager')],
      }),
    );
    expect(prompt).toHaveBeenCalledWith(createdRecord.id, 'Audit the floor.');
  });

  it('starts any enabled agent runtime in its native TUI with the manager contract', async () => {
    const meta = {
      id: 'workspace-manager',
      tag: 'Workspace Manager',
      dir: '/floor/workspaces',
      agents: ['claude', 'codex', 'opencode', 'pi'],
      createdAt: new Date(0).toISOString(),
    };
    const records = new Map<string, any>();
    const adapter = {
      id: 'codex',
      namePrefix: 'x',
      capabilities: { resumeById: true },
      lifecycle: { prepareWorkspace: vi.fn(async () => undefined) },
    };
    let spawnedContext: any = null;
    let liveSession: any = null;
    const startWebPiSession = vi.fn();
    const svc = {
      managerWorkspace: meta,
      registry: { list: () => [{ id: 'ws-1' }], get: () => undefined },
      adapters: { get: (id: string) => id === 'codex' ? adapter : undefined },
      resolveAdapter: () => adapter,
      getAgentRuntimeReadiness: () => ({
        agents: { codex: { ready: true, source: 'global-login' } },
      }),
      resumeRegistry: {
        get: vi.fn(() => null),
        ensure: vi.fn(async () => ({ resumeId: 'resume-manager-codex' })),
      },
      sessionRegistry: {
        ensureLoaded: vi.fn(async () => undefined),
        findById: vi.fn((id: string) => records.get(id)),
        nextName: vi.fn(() => 'x1'),
        create: vi.fn(async (record: any) => { records.set(record.id, record); }),
        get: vi.fn((_wsId: string, id: string) => records.get(id)),
        listFor: vi.fn(() => [...records.values()]),
        remove: vi.fn(async () => undefined),
      },
      pool: {
        get: vi.fn((id: string) => liveSession?.recordId === id ? liveSession : undefined),
        spawn: vi.fn((_wsId: string, ctx: any) => {
          spawnedContext = ctx;
          liveSession = {
            recordId: ctx.recordId,
            wsId: meta.id,
            name: ctx.recordName,
            pid: 92,
            startedAt: 2,
          };
          return liveSession;
        }),
      },
      startWebPiSession,
      webPi: { get: vi.fn(() => null) },
      config: { launcherRepoRoot: '/repo' },
    } as unknown as WorkspaceService;
    const app = createWorkspaceRoutes(svc);

    const result = await post(app, '/manager/quick-start', {
      prompt: 'Map ownership.',
      agent: 'codex',
    });
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      session: { wsId: 'workspace-manager', agent: 'codex', surface: 'terminal' },
      snapshot: null,
    });
    expect(spawnedContext).toMatchObject({ agentId: 'codex' });
    expect(result.body).toMatchObject({ session: { title: 'Map ownership.' } });
    expect(spawnedContext.initialPrompt).toContain('OpenAlice Workspace Manager');
    expect(spawnedContext.initialPrompt).toContain('User request:\nMap ownership.');
    expect(startWebPiSession).not.toHaveBeenCalled();

    const unsupported = await post(app, '/manager/quick-start', {
      prompt: 'Open a shell.',
      agent: 'shell',
    });
    expect(unsupported).toMatchObject({
      status: 400,
      body: { error: 'unsupported_agent_runtime' },
    });
  });
});
