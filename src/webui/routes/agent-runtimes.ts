import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import { isAgentRuntime } from '../../workspaces/cli-adapter.js';
import type { WorkspaceService } from '../../workspaces/service.js';

function parseAgent(body: unknown, svc: WorkspaceService): {
  agent?: string;
  error?: { error: string; message: string };
} {
  const fields = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const rawAgent = fields['agent'];
  if (rawAgent === undefined) return {};
  if (typeof rawAgent !== 'string' || rawAgent.length === 0) {
    return { error: { error: 'bad_request', message: 'agent must be a non-empty string' } };
  }
  const adapter = svc.adapters.get(rawAgent);
  if (!adapter || !isAgentRuntime(adapter)) {
    return { error: { error: 'unknown_agent', message: `no agent runtime: ${rawAgent}` } };
  }
  return { agent: rawAgent };
}

export function createAgentRuntimeRoutes(svc: WorkspaceService): Hono {
  const app = new Hono();

  app.get('/readiness', (c) => c.json(svc.getAgentRuntimeReadiness()));

  app.post('/readiness/probe', async (c) => {
    const parsed = parseAgent(await c.req.json().catch(() => null), svc);
    if (parsed.error) return c.json(parsed.error, 400);
    const started = svc.beginAgentRuntimeReadinessProbe(parsed.agent);
    return c.json({ probeId: randomUUID(), ...started }, 202);
  });

  return app;
}
