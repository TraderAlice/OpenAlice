import { describe, expect, it, vi } from 'vitest';

import type { AgentRuntimeReadinessSnapshot } from '../../workspaces/agent-runtime-readiness.js';
import type { WorkspaceService } from '../../workspaces/service.js';
import { createAgentRuntimeRoutes } from './agent-runtimes.js';

const snapshot: AgentRuntimeReadinessSnapshot = {
  agents: {
    claude: {
      agent: 'claude',
      displayName: 'Claude Code',
      installed: true,
      binPath: '/usr/bin/claude',
      status: 'checking',
      ready: false,
      source: 'unknown',
      checkedAt: null,
      durationMs: null,
    },
  },
  overallReady: false,
  checkedAt: null,
};

function build() {
  const beginAgentRuntimeReadinessProbe = vi.fn(() => ({
    agents: ['claude'],
    snapshot,
  }));
  const svc = {
    adapters: {
      get: (id: string) => id === 'claude'
        ? {
            id: 'claude',
            displayName: 'Claude Code',
            capabilities: {
              parallelPerCwd: true,
              resumeLast: false,
              resumeById: true,
              transcriptDiscovery: 'fs-watch',
              headless: true,
            },
            composeCommand: () => ['claude'],
          }
        : id === 'shell'
          ? {
              id: 'shell',
              displayName: 'Shell',
              kind: 'utility',
              capabilities: {
                parallelPerCwd: true,
                resumeLast: false,
                resumeById: false,
                transcriptDiscovery: 'none',
              },
              composeCommand: () => ['sh'],
            }
          : undefined,
    },
    getAgentRuntimeReadiness: () => snapshot,
    beginAgentRuntimeReadinessProbe,
  } as unknown as WorkspaceService;
  return { app: createAgentRuntimeRoutes(svc), beginAgentRuntimeReadinessProbe };
}

describe('agent runtime routes', () => {
  it('returns the global cached readiness snapshot', async () => {
    const { app } = build();
    const res = await app.request('/readiness');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(snapshot);
  });

  it('starts all probes asynchronously and returns 202', async () => {
    const { app, beginAgentRuntimeReadinessProbe } = build();
    const res = await app.request('/readiness/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    expect(res.status).toBe(202);
    expect(beginAgentRuntimeReadinessProbe).toHaveBeenCalledWith(undefined);
    expect(await res.json()).toMatchObject({ agents: ['claude'], snapshot });
  });

  it('accepts one agent and rejects unknown or utility adapters', async () => {
    const { app, beginAgentRuntimeReadinessProbe } = build();
    const claude = await app.request('/readiness/probe', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agent: 'claude' }),
    });
    expect(claude.status).toBe(202);
    expect(beginAgentRuntimeReadinessProbe).toHaveBeenCalledWith('claude');

    for (const agent of ['', 'ghost', 'shell']) {
      const res = await app.request('/readiness/probe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agent }),
      });
      expect(res.status).toBe(400);
    }
  });
});
