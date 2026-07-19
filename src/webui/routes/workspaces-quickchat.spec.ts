/**
 * POST /quick-chat — the loginless-runtime credential injection (opencode/pi).
 * claude/codex carry their own CLI login and must NOT be injected; opencode/pi
 * are seeded from the vault before spawn, and dead-end (no compatible cred) with
 * a 400 the composer turns into a "configure a provider" bounce.
 *
 * core/config is partial-mocked so we can drive the vault per-test without
 * touching the real ai-provider-manager.json.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';

import { createWorkspaceRoutes } from './workspaces.js';
import {
  readCredentials,
  readWorkspaceDefaultAgent,
  readWorkspaceDefaultContextWindow,
  setCredentialLastModel,
  type Credential,
} from '../../core/config.js';
import type { WorkspaceService } from '../../workspaces/service.js';
import type { WorkspaceAiCred } from '../../workspaces/cli-adapter.js';
import { ChatWorkspaceResolver } from '../../workspaces/chat-workspace-resolver.js';

/* eslint-disable @typescript-eslint/no-explicit-any */

vi.mock('../../core/config.js', async (importActual) => {
  const actual = await importActual<typeof import('../../core/config.js')>();
  return {
    ...actual,
    readCredentials: vi.fn(),
    readWorkspaceDefaultAgent: vi.fn(async () => null),
    readWorkspaceDefaultContextWindow: vi.fn(async () => 256_000),
    setCredentialLastModel: vi.fn(async () => {}),
  };
});

const openaiKey: Credential = {
  vendor: 'openai', authType: 'api-key', apiKey: 'sk-oa', wires: { 'openai-chat': '' },
};

function build(opts: {
  workspaces?: any[];
  sessionsByWorkspace?: Record<string, any[]>;
  recentChatWorkspaceId?: string | null;
  claudeConfig?: WorkspaceAiCred | null;
  claudeInteractiveSetupStatus?: 'ready' | 'runtime-onboarding-required' | 'workspace-trust-required' | 'unknown';
  opencodeConfig?: WorkspaceAiCred | null;
  opencodeRuntimeSource?: 'global-config' | 'global-login' | 'managed-runtime';
  runtimeWorkspace?: any;
} = {}) {
  const META = {
    id: 'ws-1',
    dir: '/w',
    agents: ['claude', 'opencode'],
    template: 'chat',
    tag: 'chat-x',
    createdAt: '2026-07-01T00:00:00.000Z',
  };
  const opencode = {
    id: 'opencode',
    namePrefix: 'o',
    writeAiConfig: vi.fn(async () => {}),
    readAiConfig: vi.fn(async () => opts.opencodeConfig ?? null),
  };
  const claude = {
    id: 'claude',
    namePrefix: 'c',
    readAiConfig: vi.fn(async () => opts.claudeConfig ?? null),
    readInteractiveSetupStatus: vi.fn(async () => opts.claudeInteractiveSetupStatus ?? 'ready'),
  };
  const shell = { id: 'shell', kind: 'utility', namePrefix: 'sh' };
  const adapters: Record<string, any> = { opencode, claude, shell };
  const spawn = vi.fn((_wsId: string, ctx: any) => ({
    recordId: ctx.recordId,
    wsId: 'ws-1',
    name: ctx.recordName,
    pid: 1,
    agentSessionId: null,
    startedAt: 1,
  }));
  const setTerminalViewAttributes = vi.fn(() => true);
  const creator = { create: vi.fn(async () => ({ ok: true as const, workspace: META })) };
  const registry = {
    list: () => opts.workspaces ?? [],
    get: (id: string) => (opts.workspaces ?? []).find((w) => w.id === id) ?? (id === META.id ? META : undefined),
  };
  const sessionRegistry = {
    ensureLoaded: vi.fn(async () => {}),
    listFor: vi.fn((wsId: string) => opts.sessionsByWorkspace?.[wsId] ?? []),
    findById: vi.fn(() => undefined),
    nextName: () => 'o1',
    create: vi.fn(async () => {}),
    remove: vi.fn(async () => {}),
  };
  const resumeRecords = new Map<string, any>();
  const resumeRegistry = {
    get: (id: string) => resumeRecords.get(id) ?? null,
    ensure: vi.fn(async (input: any) => {
      const resumeId = input.resumeId ?? `resume-${resumeRecords.size + 1}`;
      const record = { resumeId, ...input };
      resumeRecords.set(resumeId, record);
      return record;
    }),
  };
  const chatWorkspaceResolver = new ChatWorkspaceResolver({
    registry: registry as any,
    sessionRegistry: sessionRegistry as any,
    creator,
  });
  const svc = {
    // Default []: today's tag never matches → creator.create path. Tests that
    // exercise targetWsId pass the workspace in so registry resolves it by id.
    registry,
    resolveRuntimeWorkspace: (id: string) => (
      opts.runtimeWorkspace?.id === id ? opts.runtimeWorkspace : registry.get(id)
    ),
    creator,
    resolveOrCreateChatWorkspace: (preferredWorkspaceId?: string | null) =>
      chatWorkspaceResolver.resolveOrCreate(preferredWorkspaceId),
    resolveAdapter: (_m: any, agentId?: string) => adapters[agentId ?? 'claude'] ?? claude,
    adapters: { get: (id: string) => adapters[id] },
    sessionRegistry,
    resumeRegistry,
    pool: { spawn, get: vi.fn(() => undefined), setTerminalViewAttributes },
    publicMeta: vi.fn(async () => META),
    config: { launcherRepoRoot: '/repo' },
    getAgentRuntimeReadiness: vi.fn(() => ({
      agents: opts.opencodeRuntimeSource
        ? {
            opencode: {
              agent: 'opencode',
              displayName: 'opencode',
              installed: true,
              binPath: '/usr/local/bin/opencode',
              status: 'ready',
              ready: true,
              source: opts.opencodeRuntimeSource,
              checkedAt: '2026-07-12T00:00:00.000Z',
              durationMs: 1,
            },
          }
        : {},
      overallReady: opts.opencodeRuntimeSource !== undefined,
      checkedAt: opts.opencodeRuntimeSource ? '2026-07-12T00:00:00.000Z' : null,
    })),
  } as unknown as WorkspaceService;
  const rememberRecentChatWorkspace = vi.fn(async (workspaceId: string | null) => ({
    lastCredentialByAgent: {},
    recentChatWorkspaceId: workspaceId,
  }));
  const app = createWorkspaceRoutes(svc, {
    readQuickChatPreferences: vi.fn(async () => ({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: opts.recentChatWorkspaceId ?? null,
    })),
    rememberRecentChatWorkspace,
  });
  return { app, opencode, spawn, creator, rememberRecentChatWorkspace, setTerminalViewAttributes };
}

async function quickChat(app: any, body: unknown) {
  const res = await app.request('/quick-chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function get(app: any, path: string) {
  const res = await app.request(path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function spawnSession(app: any, body: unknown) {
  const res = await app.request('/ws-1/sessions/spawn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

beforeEach(() => {
  vi.mocked(readCredentials).mockReset();
  vi.mocked(readWorkspaceDefaultAgent).mockResolvedValue(null);
  vi.mocked(readWorkspaceDefaultContextWindow).mockResolvedValue(256_000);
  vi.mocked(setCredentialLastModel).mockClear();
});

describe('PUT /terminal-view-attributes', () => {
  it('validates and publishes the renderer palette to the session pool', async () => {
    const { app, setTerminalViewAttributes } = build();
    const attributes = {
      foreground: [1, 2, 3],
      background: [4, 5, 6],
      cursor: [7, 8, 9],
      ansi: Array.from({ length: 256 }, () => [0, 0, 0]),
      colorSchemeMode: 'dark',
      cursorStyle: 'block',
      cursorBlink: true,
    };
    const response = await app.request('/terminal-view-attributes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(attributes),
    });

    expect(response.status).toBe(200);
    expect(setTerminalViewAttributes).toHaveBeenCalledWith(attributes);
  });

  it('rejects incomplete palettes', async () => {
    const { app, setTerminalViewAttributes } = build();
    const response = await app.request('/terminal-view-attributes', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foreground: [1, 2, 3], ansi: [] }),
    });

    expect(response.status).toBe(400);
    expect(setTerminalViewAttributes).not.toHaveBeenCalled();
  });
});

describe('GET /credentials — Quick Chat launch metadata', () => {
  it('returns the model a compatible credential would inject before first use', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'google-1': {
        vendor: 'google',
        authType: 'api-key',
        apiKey: 'AQ.test',
        wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
      },
    });
    const { app } = build();

    const result = await get(app, '/credentials?agent=opencode');

    expect(result.status).toBe(200);
    expect(result.body.credentials).toEqual([
      expect.objectContaining({
        slug: 'google-1',
        resolvedModel: 'gemini-3.1-flash-lite',
        resolvedReasoning: true,
        resolvedReasoningEffort: 'minimal',
        resolvedReasoningMode: 'adaptive',
      }),
    ]);
  });

  it('returns the target workspace model, context, and protocol for the selected credential', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'google-1': {
        vendor: 'google',
        authType: 'api-key',
        apiKey: 'AQ.test',
        wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
      },
    });
    const { app } = build({
      opencodeConfig: {
        apiKey: 'AQ.test',
        model: 'gemini-3.5-flash',
        contextWindow: 512_000,
        wireShape: 'google-generative-ai',
        reasoningEffort: 'medium',
      },
    });

    const result = await get(app, '/ws-1/agent-config/opencode/credential');

    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      configured: true,
      slug: 'google-1',
      model: 'gemini-3.5-flash',
      contextWindow: 512_000,
      wireShape: 'google-generative-ai',
      reasoningMode: 'adaptive',
      reasoningEffort: 'medium',
    });
  });

  it('keeps hand-edited Workspace config visible when no vault key matches', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app } = build({
      opencodeConfig: {
        apiKey: 'hand-edited-key',
        model: 'local-manual-model',
        contextWindow: 128_000,
        wireShape: 'openai-chat',
      },
    });

    const result = await get(app, '/ws-1/agent-config/opencode/credential');

    expect(result).toEqual({
      status: 200,
      body: {
        configured: true,
        slug: null,
        model: 'local-manual-model',
        contextWindow: 128_000,
        wireShape: 'openai-chat',
      },
    });
  });

  it('returns Claude project metadata and its native interactive setup gate', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'minimax-1': {
        vendor: 'minimax',
        authType: 'api-key',
        apiKey: 'minimax-test-key',
        wires: { anthropic: 'https://api.example.test/anthropic' },
      },
    });
    const { app } = build({
      claudeConfig: {
        apiKey: 'minimax-test-key',
        model: 'MiniMax-M2.5',
        wireShape: 'anthropic',
      },
      claudeInteractiveSetupStatus: 'workspace-trust-required',
    });

    const result = await get(app, '/ws-1/agent-config/claude/credential');

    expect(result).toEqual({
      status: 200,
      body: {
        configured: true,
        slug: 'minimax-1',
        model: 'MiniMax-M2.5',
        contextWindow: null,
        wireShape: 'anthropic',
        reasoningMode: 'adaptive',
        interactiveSetupStatus: 'workspace-trust-required',
      },
    });
  });

  it('reads launch metadata from the reserved Manager runtime workspace', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'google-1': {
        vendor: 'google',
        authType: 'api-key',
        apiKey: 'AQ.test',
        wires: { 'google-generative-ai': 'https://generativelanguage.googleapis.com/v1beta' },
      },
    });
    const { app } = build({
      runtimeWorkspace: {
        id: 'workspace-manager',
        dir: '/manager',
        agents: ['opencode'],
        template: 'workspace-manager',
        tag: 'Workspace Manager',
        createdAt: '2026-07-16T00:00:00.000Z',
      },
      opencodeConfig: {
        apiKey: 'AQ.test',
        model: 'gemini-3.5-flash',
        contextWindow: 512_000,
        wireShape: 'google-generative-ai',
      },
    });

    const credential = await get(app, '/workspace-manager/agent-config/opencode/credential');
    const readiness = await get(app, '/workspace-manager/agent-readiness');

    expect(credential).toEqual({
      status: 200,
      body: {
        configured: true,
        slug: 'google-1',
        model: 'gemini-3.5-flash',
        contextWindow: 512_000,
        wireShape: 'google-generative-ai',
        reasoningMode: 'adaptive',
      },
    });
    expect(readiness.status).toBe(200);
    expect(readiness.body.agents.opencode).toMatchObject({
      agent: 'opencode',
      ready: true,
      source: 'workspace-config',
      detectedCredentialSlug: 'google-1',
    });
  });

  it('writes AI adjustments to the reserved Manager runtime workspace', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app, opencode } = build({
      runtimeWorkspace: {
        id: 'workspace-manager',
        dir: '/manager',
        agents: ['opencode'],
        template: 'workspace-manager',
        tag: 'Workspace Manager',
        createdAt: '2026-07-16T00:00:00.000Z',
      },
    });
    const config = {
      apiKey: 'AQ.test',
      model: 'gemini-3.5-flash',
      contextWindow: 512_000,
      wireShape: 'google-generative-ai',
    };

    const response = await app.request('/workspace-manager/agent-config/opencode', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(config),
    });

    expect(response.status).toBe(200);
    expect(opencode.writeAiConfig).toHaveBeenCalledWith('/manager', {
      ...config,
      reasoning: true,
      reasoningEffort: 'medium',
    });
  });
});

describe('POST /quick-chat — loginless credential injection', () => {
  it('opencode + empty vault → 400 no_ai_credential, no inject, no spawn', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app, opencode, spawn } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'opencode' });
    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_ai_credential');
    expect(r.body.settingsTarget).toBe('ai-provider'); // the composer's bounce target
    expect(opencode.writeAiConfig).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('opencode + compatible cred → injects the current vendor recommendation then spawns', async () => {
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });
    const { app, opencode, spawn } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'opencode' });
    expect(r.status).toBe(201);
    expect(opencode.writeAiConfig).toHaveBeenCalledOnce();
    const cred = (opencode.writeAiConfig.mock.calls[0] as any[])[1];
    expect(cred.apiKey).toBe('sk-oa');
    expect(cred.wireShape).toBe('openai-chat');
    expect(cred.model).toBe('gpt-5.6'); // current vendor recommendation — no lastModel yet
    expect(cred.contextWindow).toBe(256_000);
    expect(cred.reasoning).toBe(true);
    // model remembered on the cred for next time
    expect(vi.mocked(setCredentialLastModel)).toHaveBeenCalledWith('openai-1', 'gpt-5.6');
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('opencode + existing usable workspace config → spawns without vault injection', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app, opencode, spawn } = build({
      opencodeConfig: {
        apiKey: 'sk-existing',
        model: 'deepseek-chat',
        wireShape: 'openai-chat',
      },
    });
    const r = await quickChat(app, { prompt: 'hi', agent: 'opencode' });

    expect(r.status).toBe(201);
    expect(opencode.writeAiConfig).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('honors an explicit credentialSlug pick', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'openai-1': openaiKey,
      'openai-2': { ...openaiKey, apiKey: 'sk-second', lastModel: 'gpt-5.5-mini' },
    });
    const { app, opencode } = build();
    await quickChat(app, { prompt: 'hi', agent: 'opencode', credentialSlug: 'openai-2' });
    const cred = (opencode.writeAiConfig.mock.calls[0] as any[])[1];
    expect(cred.apiKey).toBe('sk-second');
    expect(cred.model).toBe('gpt-5.5-mini'); // remembered lastModel wins over flagship
  });

  it('explicit credential pick overrides a globally-ready opencode config', async () => {
    vi.mocked(readCredentials).mockResolvedValue({
      'openai-2': { ...openaiKey, apiKey: 'sk-second', lastModel: 'gpt-5.5-mini' },
    });
    const { app, opencode, spawn } = build({ opencodeRuntimeSource: 'global-config' });

    const r = await quickChat(app, {
      prompt: 'hi',
      agent: 'opencode',
      credentialSlug: 'openai-2',
    });

    expect(r.status).toBe(201);
    expect(opencode.writeAiConfig).toHaveBeenCalledOnce();
    expect((opencode.writeAiConfig.mock.calls[0] as any[])[1]).toMatchObject({
      apiKey: 'sk-second',
      model: 'gpt-5.5-mini',
    });
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('claude is never injected (own CLI login) — vault is not even read', async () => {
    const { app, spawn } = build();
    const r = await quickChat(app, { prompt: 'hi', agent: 'claude' });
    expect(r.status).toBe(201);
    expect(vi.mocked(readCredentials)).not.toHaveBeenCalled();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('reuses the preferred recent Chat workspace across days', async () => {
    const recent = {
      id: 'ws-recent',
      dir: '/recent',
      agents: ['claude'],
      template: 'chat',
      tag: 'long-running-chat',
      createdAt: '2026-06-01T00:00:00.000Z',
    };
    const { app, creator, spawn } = build({
      workspaces: [recent],
      recentChatWorkspaceId: recent.id,
    });

    const r = await quickChat(app, { prompt: 'continue yesterday', agent: 'claude' });
    expect(r.status).toBe(201);
    expect(creator.create).not.toHaveBeenCalled();
    expect((spawn.mock.calls[0] as any[])[0]).toBe(recent.id);
  });

  it('falls back to the most recently active Chat workspace and remembers it', async () => {
    const older = {
      id: 'ws-older', dir: '/older', agents: ['claude'], template: 'chat', tag: 'older',
      createdAt: '2026-07-09T00:00:00.000Z',
    };
    const active = {
      id: 'ws-active', dir: '/active', agents: ['claude'], template: 'chat', tag: 'active',
      createdAt: '2026-07-01T00:00:00.000Z',
    };
    const { app, creator, spawn, rememberRecentChatWorkspace } = build({
      workspaces: [older, active],
      recentChatWorkspaceId: 'deleted-workspace',
      sessionsByWorkspace: {
        [older.id]: [{ lastActiveAt: '2026-07-09T01:00:00.000Z' }],
        [active.id]: [{ lastActiveAt: '2026-07-10T01:00:00.000Z' }],
      },
    });

    const r = await quickChat(app, { prompt: 'pick up the active desk', agent: 'claude' });
    expect(r.status).toBe(201);
    expect(creator.create).not.toHaveBeenCalled();
    expect((spawn.mock.calls[0] as any[])[0]).toBe(active.id);
    expect(rememberRecentChatWorkspace).toHaveBeenCalledWith(active.id);
  });

  it('creates one stable starter Chat workspace when none exists', async () => {
    const { app, creator, rememberRecentChatWorkspace } = build();
    const r = await quickChat(app, { prompt: 'first chat', agent: 'claude' });

    expect(r.status).toBe(201);
    expect(creator.create).toHaveBeenCalledWith('chat', 'chat');
    expect(rememberRecentChatWorkspace).toHaveBeenCalledWith('ws-1');
  });

  // targetWsId — the chat sidebar's per-workspace "+": spawn INTO the given
  // workspace, not today's (so no creator.create).
  it('targetWsId spawns into the given workspace, skipping find-or-create', async () => {
    const { app, spawn, creator } = build({
      workspaces: [{ id: 'ws-1', dir: '/w', agents: ['claude'], template: 'chat', tag: 'chat-x' }],
    });
    const r = await quickChat(app, { prompt: 'hi', agent: 'claude', targetWsId: 'ws-1' });
    expect(r.status).toBe(201);
    expect(creator.create).not.toHaveBeenCalled(); // reused, not created
    expect(spawn).toHaveBeenCalledOnce();
    expect((spawn.mock.calls[0] as any[])[0]).toBe('ws-1'); // spawned into the target
  });

  it('omitted agent ignores shell at agents[0] and uses the first agent runtime', async () => {
    const { app, spawn } = build({
      workspaces: [{ id: 'ws-1', dir: '/w', agents: ['shell', 'claude'], template: 'chat', tag: 'chat-x' }],
    });
    const r = await quickChat(app, { prompt: 'hi', targetWsId: 'ws-1' });
    expect(r.status).toBe(201);
    expect(spawn).toHaveBeenCalledOnce();
    expect((spawn.mock.calls[0] as any[])[1].agentId).toBe('claude');
  });

  it('omitted agent honors a configured default runtime when enabled', async () => {
    vi.mocked(readWorkspaceDefaultAgent).mockResolvedValue('opencode');
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });
    const { app, spawn } = build({
      workspaces: [{ id: 'ws-1', dir: '/w', agents: ['shell', 'claude', 'opencode'], template: 'chat', tag: 'chat-x' }],
    });
    const r = await quickChat(app, { prompt: 'hi', targetWsId: 'ws-1' });
    expect(r.status).toBe(201);
    expect((spawn.mock.calls[0] as any[])[1].agentId).toBe('opencode');
  });

  it('unknown targetWsId → 404 workspace_not_found, no spawn', async () => {
    const { app, spawn, creator } = build();
    const r = await quickChat(app, { prompt: 'hi', targetWsId: 'nope' });
    expect(r.status).toBe(404);
    expect(r.body.error).toBe('workspace_not_found');
    expect(creator.create).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('normal opencode spawn + empty vault/config → 400 no_ai_credential', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app, opencode, spawn } = build();

    const r = await spawnSession(app, { agent: 'opencode' });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe('no_ai_credential');
    expect(opencode.writeAiConfig).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('normal opencode spawn + compatible cred → injects and spawns', async () => {
    vi.mocked(readCredentials).mockResolvedValue({ 'openai-1': openaiKey });
    const { app, opencode, spawn } = build();

    const r = await spawnSession(app, { agent: 'opencode' });

    expect(r.status).toBe(201);
    expect(opencode.writeAiConfig).toHaveBeenCalledOnce();
    expect(spawn).toHaveBeenCalledOnce();
  });

  it('agent-readiness reports missing credential for loginless runtimes', async () => {
    vi.mocked(readCredentials).mockResolvedValue({});
    const { app } = build();

    const res = await app.request('/ws-1/agent-readiness/opencode');
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toMatchObject({
      agent: 'opencode',
      ready: false,
      requiresCredential: true,
      source: 'missing',
      settingsTarget: 'ai-provider',
    });
  });
});
