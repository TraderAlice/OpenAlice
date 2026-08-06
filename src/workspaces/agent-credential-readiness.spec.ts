import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  readCredentials,
  setCredentialLastModel,
  type Credential,
} from '@/core/config.js';
import { emptyAgentSessionRuntime, type CliAdapter, type WorkspaceAiCred } from './cli-adapter.js';
import {
  AgentCredentialError,
  ensureAgentCredentialReady,
  getAgentCredentialReadiness,
} from './agent-credential-readiness.js';
import type { WorkspaceMeta } from './workspace-registry.js';

vi.mock('@/core/config.js', async (importActual) => {
  const actual = await importActual<typeof import('@/core/config.js')>();
  return {
    ...actual,
    readCredentials: vi.fn(),
    setCredentialLastModel: vi.fn(async () => {}),
  };
});

const meta: WorkspaceMeta = {
  id: 'ws-1',
  tag: 'chat-x',
  dir: '/tmp/ws-1',
  createdAt: '2026-07-04T00:00:00.000Z',
  template: 'chat',
};

const openaiKey: Credential = {
  vendor: 'openai',
  authType: 'api-key',
  apiKey: 'sk-oa',
  wires: { 'openai-chat': '' },
};

function adapter(
  id: string,
  cfg: WorkspaceAiCred | null = null,
  credentialSource: 'runtime-or-workspace' | 'workspace-required' = 'runtime-or-workspace',
) {
  return {
    id,
    displayName: id,
    sessionRuntime: emptyAgentSessionRuntime,
    capabilities: {
      parallelPerCwd: true,
      resumeLast: true,
      resumeById: true,
      transcriptDiscovery: 'none',
      aiProvider: {
        credentialSource,
        wirePreference: id === 'claude' ? ['anthropic'] : ['openai-chat'],
        ...(id === 'opencode' || id === 'pi'
          ? { modelRegistration: { contextWindow: true, reasoning: true } }
          : {}),
      },
    },
    composeCommand: () => [id],
    readAiConfig: vi.fn(async () => cfg),
    writeAiConfig: vi.fn(async () => {}),
  } satisfies CliAdapter;
}

beforeEach(() => {
  vi.mocked(readCredentials).mockReset();
  vi.mocked(setCredentialLastModel).mockClear();
});

describe('agent credential readiness', () => {
  it.each(['claude', 'codex', 'opencode', 'pi'])(
    'treats %s as ready without an Alice credential because the runtime owns login state',
    async (agentId) => {
    const a = adapter(agentId);
    const row = await getAgentCredentialReadiness({ meta, agentId, adapter: a, credentials: {} });

    expect(row.ready).toBe(true);
    expect(row.requiresCredential).toBe(false);
    expect(row.source).toBe('runtime-login');
    expect(a.readAiConfig).toHaveBeenCalledOnce();
  });

  it('accepts an existing usable workspace config even when the Alice vault is empty', async () => {
    const a = adapter('opencode', {
      baseUrl: null,
      apiKey: 'sk-hand-written',
      model: 'deepseek-chat',
      wireShape: 'openai-chat',
    });
    vi.mocked(readCredentials).mockResolvedValue({});

    const row = await ensureAgentCredentialReady({ meta, agentId: 'opencode', adapter: a });

    expect(row.ready).toBe(true);
    expect(row.requiresCredential).toBe(false);
    expect(row.source).toBe('workspace-config');
    expect(a.writeAiConfig).not.toHaveBeenCalled();
  });

  it('does not let an unreadable Alice vault block a native Workspace config', async () => {
    const a = adapter('pi', {
      baseUrl: null,
      apiKey: 'native-project-key',
      model: 'project-model',
      wireShape: 'openai-chat',
    });
    vi.mocked(readCredentials).mockRejectedValue(new Error('vault unavailable'));

    const row = await getAgentCredentialReadiness({ meta, agentId: 'pi', adapter: a });

    expect(row).toMatchObject({
      ready: true,
      requiresCredential: false,
      source: 'workspace-config',
      hasWorkspaceConfig: true,
    });
    expect(a.writeAiConfig).not.toHaveBeenCalled();
  });

  it('does not overwrite an explicit Workspace wire when Quick Chat repeats the same credential', async () => {
    const a = adapter('pi', {
      baseUrl: 'https://api.minimax.io/anthropic',
      apiKey: 'sk-oa',
      model: 'MiniMax-M3',
      wireShape: 'anthropic',
      authMode: 'bearer',
      contextWindow: 512_000,
    });
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });

    const row = await ensureAgentCredentialReady({
      meta,
      agentId: 'pi',
      adapter: a,
      pickedCredentialSlug: 'openai-1',
    });

    expect(row.source).toBe('workspace-config');
    expect(a.writeAiConfig).not.toHaveBeenCalled();
  });

  it('injects a compatible vault credential when no usable workspace config exists', async () => {
    const a = adapter('pi', null);
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });

    const row = await ensureAgentCredentialReady({
      meta,
      agentId: 'pi',
      adapter: a,
      pickedCredentialSlug: 'openai-1',
    });

    expect(row.ready).toBe(true);
    expect(row.source).toBe('launcher-vault');
    expect(a.writeAiConfig).toHaveBeenCalledOnce();
    expect(a.writeAiConfig).toHaveBeenCalledWith('/tmp/ws-1', expect.objectContaining({
      apiKey: 'sk-oa',
      model: 'gpt-5.6',
      wireShape: 'openai-chat',
      contextWindow: 1_050_000,
    }));
    expect(vi.mocked(setCredentialLastModel)).toHaveBeenCalledWith('openai-1', 'gpt-5.6');
  });

  it('keeps native login ready but rejects an explicit credential without a model', async () => {
    const a = adapter('opencode', null);
    vi.mocked(readCredentials).mockResolvedValue({
      custom: {
        vendor: 'custom',
        authType: 'api-key',
        apiKey: 'sk-custom',
        wires: { 'openai-chat': 'https://example.test/v1' },
      },
    });

    const row = await getAgentCredentialReadiness({ meta, agentId: 'opencode', adapter: a });
    expect(row.ready).toBe(true);
    expect(row.source).toBe('runtime-login');

    await expect(ensureAgentCredentialReady({
      meta,
      agentId: 'opencode',
      adapter: a,
      pickedCredentialSlug: 'custom',
    }))
      .rejects.toBeInstanceOf(AgentCredentialError);
  });

  it('keeps automatic injection only for a future runtime that truly requires a Workspace credential', async () => {
    const a = adapter('future', null, 'workspace-required');
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });

    const row = await ensureAgentCredentialReady({ meta, agentId: 'future', adapter: a });

    expect(row.requiresCredential).toBe(true);
    expect(row.source).toBe('launcher-vault');
    expect(a.writeAiConfig).toHaveBeenCalledOnce();
  });
});
