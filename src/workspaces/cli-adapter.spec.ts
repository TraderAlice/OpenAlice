import { describe, expect, it, vi } from 'vitest';

import {
  prepareAgentRuntimeWorkspace,
  type AgentRuntimeWorkspaceContext,
  type CliAdapter,
} from './cli-adapter.js';

const context: AgentRuntimeWorkspaceContext = {
  wsId: 'ws-test',
  cwd: '/tmp/ws-test',
  launcherRepoRoot: '/repo',
};

function adapterWithLifecycle(
  prepareWorkspace?: (ctx: AgentRuntimeWorkspaceContext) => Promise<void>,
): CliAdapter {
  return {
    id: 'test',
    displayName: 'Test runtime',
    capabilities: {
      parallelPerCwd: true,
      resumeLast: false,
      resumeById: false,
      transcriptDiscovery: 'none',
    },
    composeCommand: () => ['test'],
    ...(prepareWorkspace ? { lifecycle: { prepareWorkspace } } : {}),
  };
}

describe('agent runtime lifecycle', () => {
  it('dispatches workspace preparation through the common hook', async () => {
    const prepareWorkspace = vi.fn(async () => undefined);

    await prepareAgentRuntimeWorkspace(adapterWithLifecycle(prepareWorkspace), context);

    expect(prepareWorkspace).toHaveBeenCalledOnce();
    expect(prepareWorkspace).toHaveBeenCalledWith(context);
  });

  it('is a no-op for runtimes without workspace preparation', async () => {
    await expect(
      prepareAgentRuntimeWorkspace(adapterWithLifecycle(), context),
    ).resolves.toBeUndefined();
  });
});
