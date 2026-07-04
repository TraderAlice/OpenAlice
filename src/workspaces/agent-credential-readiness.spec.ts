import { beforeEach, describe, expect, it, vi } from 'vitest';

import { readCredentials, setCredentialLastModel, type Credential } from '@/core/config.js';
import type { CliAdapter, WorkspaceAiCred } from './cli-adapter.js';
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
  agents: ['claude', 'opencode', 'pi'],
};

const openaiKey: Credential = {
  vendor: 'openai',
  authType: 'api-key',
  apiKey: 'sk-oa',
  wires: { 'openai-chat': '' },
};

function adapter(id: string, cfg: WorkspaceAiCred | null = null) {
  return {
    id,
    displayName: id,
    capabilities: {
      parallelPerCwd: true,
      resumeLast: true,
      resumeById: true,
      transcriptDiscovery: 'none',
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
  it('treats claude/codex style runtimes as ready because they own login state', async () => {
    const a = adapter('claude');
    const row = await getAgentCredentialReadiness({ meta, agentId: 'claude', adapter: a, credentials: {} });

    expect(row.ready).toBe(true);
    expect(row.requiresCredential).toBe(false);
    expect(row.source).toBe('runtime-login');
    expect(a.readAiConfig).not.toHaveBeenCalled();
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
      model: 'gpt-5.5',
      wireShape: 'openai-chat',
      contextWindow: 1_000_000,
    }));
    expect(vi.mocked(setCredentialLastModel)).toHaveBeenCalledWith('openai-1', 'gpt-5.5');
  });

  it('does not treat a custom credential without a remembered model as injectable', async () => {
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
    expect(row.ready).toBe(false);
    expect(row.source).toBe('missing');

    await expect(ensureAgentCredentialReady({ meta, agentId: 'opencode', adapter: a }))
      .rejects.toBeInstanceOf(AgentCredentialError);
  });
});
