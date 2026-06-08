/**
 * POST /:id/headless — the automation dispatch route. Covers the validation /
 * agent-resolution / dispatch branches against a stubbed WorkspaceService
 * (no real spawn). Modeled on trading-config.spec's harness.
 */
import { describe, expect, it, vi } from 'vitest';

import { createWorkspaceRoutes } from './workspaces.js';
import { HeadlessCapacityError, type WorkspaceService } from '../../workspaces/service.js';

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
  opts: { meta?: any; adapters?: Record<string, any>; resolveTo?: any; dispatch?: any } = {},
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
  const dispatchHeadlessTask = opts.dispatch ?? vi.fn(async () => ({ taskId: 'task-1' }));
  const svc = {
    registry: { get: (id: string) => (id === 'ws-1' ? meta : undefined) },
    adapters: { get: (a: string) => adapters[a] },
    resolveAdapter: (_m: any, a?: string) => opts.resolveTo ?? adapters[a ?? 'claude'] ?? claude,
    config: { launcherRepoRoot: '/repo' },
    runHeadlessTask,
    dispatchHeadlessTask,
  } as unknown as WorkspaceService;
  return { app: createWorkspaceRoutes(svc), runHeadlessTask, dispatchHeadlessTask };
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
