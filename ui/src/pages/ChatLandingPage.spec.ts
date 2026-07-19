import { describe, expect, it } from 'vitest'

import {
  formatContextWindow,
  resolveAgentCredential,
  resolveExplicitLoginBackedCredential,
  resolveAgentLaunchAiDetails,
  resolveAgentLaunchCredentialSlug,
} from '../hooks/useAgentLaunchConfig'
import { resolveAgentRuntime } from '../lib/agentRuntime'
import { resolveChatWorkspaceTarget } from './ChatLandingPage'
import type { AgentRuntimeReadinessSnapshot, Workspace } from '../components/workspace/api'

const agents = [
  { id: 'claude', installed: true },
  { id: 'codex', installed: true },
  { id: 'pi', installed: false },
]

function readiness(readyAgent: string): AgentRuntimeReadinessSnapshot {
  return {
    agents: {
      [readyAgent]: {
        agent: readyAgent,
        displayName: readyAgent,
        installed: true,
        binPath: null,
        status: 'ready',
        ready: true,
        source: 'global-login',
        checkedAt: '2026-07-10T00:00:00.000Z',
        durationMs: 1,
        message: 'ready',
      },
    },
    overallReady: true,
    checkedAt: '2026-07-10T00:00:00.000Z',
  }
}

function workspace(
  id: string,
  createdAt: string,
  lastActiveAt?: string,
  template = 'chat',
): Workspace {
  return {
    id,
    tag: id,
    dir: `/tmp/${id}`,
    createdAt,
    template,
    agents: ['pi'],
    sessions: lastActiveAt
      ? [{
          id: `${id}-session`,
          resumeId: `${id}-resume`,
          wsId: id,
          agent: 'pi',
          name: 'p1',
          createdAt,
          lastActiveAt,
          state: 'paused',
          pid: null,
          startedAt: null,
          title: null,
        }]
      : [],
  }
}

describe('resolveChatWorkspaceTarget', () => {
  const older = workspace('older', '2026-07-01T00:00:00Z', '2026-07-09T00:00:00Z')
  const active = workspace('active', '2026-07-02T00:00:00Z', '2026-07-10T00:00:00Z')
  const autoQuant = workspace('auto-quant', '2026-07-11T00:00:00Z', undefined, 'auto-quant')

  it('uses an explicit Chat workspace ahead of the remembered target', () => {
    expect(resolveChatWorkspaceTarget([older, active], older.id, active.id)?.id).toBe(older.id)
  })

  it('uses the remembered Chat workspace when it is still valid', () => {
    expect(resolveChatWorkspaceTarget([older, active], null, older.id)?.id).toBe(older.id)
  })

  it('falls back to the most recently active Chat workspace and ignores other templates', () => {
    expect(resolveChatWorkspaceTarget([older, active, autoQuant], null, 'deleted')?.id).toBe(active.id)
  })

  it('returns null when the first Quick Chat must create a starter workspace', () => {
    expect(resolveChatWorkspaceTarget([autoQuant], null, null)).toBeNull()
  })
})

describe('resolveChatAgent', () => {
  it('keeps an explicit valid choice ahead of saved and detected defaults', () => {
    expect(resolveAgentRuntime(agents, 'codex', 'claude', readiness('claude'))).toBe('codex')
  })

  it('uses the saved default when there is no explicit choice', () => {
    expect(resolveAgentRuntime(agents, null, 'claude', readiness('codex'))).toBe('claude')
  })

  it('uses a verified runtime when no preference exists', () => {
    expect(resolveAgentRuntime(agents, null, null, readiness('codex'))).toBe('codex')
  })

  it('uses the only installed runtime while readiness is still stale', () => {
    const freshInstall = [
      { id: 'claude', installed: false },
      { id: 'codex', installed: false },
      { id: 'pi', installed: true },
    ]
    expect(resolveAgentRuntime(freshInstall, null, null, null)).toBe('pi')
  })

  it('does not guess when several runtimes are installed and none is ready', () => {
    expect(resolveAgentRuntime(agents, null, null, null)).toBeNull()
  })

  it('ignores choices that are unavailable in the target workspace', () => {
    expect(resolveAgentRuntime([{ id: 'pi', installed: true }], 'codex', 'claude', null)).toBe('pi')
  })
})

describe('resolveAgentCredential', () => {
  const credentials = [{ slug: 'saved-a' }, { slug: 'saved-b' }]

  it('keeps an explicit provider choice', () => {
    expect(resolveAgentCredential(credentials, 'saved-b', 'saved-a', true)).toBe('saved-b')
  })

  it('shows the detected provider even when workspace config is already ready', () => {
    expect(resolveAgentCredential(credentials, null, 'saved-a', true)).toBe('saved-a')
  })

  it('falls back to the first credential only when workspace config needs one', () => {
    expect(resolveAgentCredential(credentials, null, null, false)).toBe('saved-a')
    expect(resolveAgentCredential(credentials, null, null, true)).toBeNull()
  })

  it('uses a configured workspace default before the remembered quick-chat choice', () => {
    expect(resolveAgentCredential(
      credentials,
      null,
      null,
      false,
      'saved-b',
      'saved-a',
    )).toBe('saved-b')
  })

  it('uses the remembered quick-chat choice before the first credential', () => {
    expect(resolveAgentCredential(
      credentials,
      null,
      null,
      false,
      null,
      'saved-b',
    )).toBe('saved-b')
  })

  it('keeps the workspace credential ahead of global defaults and history', () => {
    expect(resolveAgentCredential(
      credentials,
      null,
      'saved-b',
      true,
      'saved-a',
      'saved-a',
    )).toBe('saved-b')
  })

  it('does not expose a global fallback while workspace detection is pending', () => {
    expect(resolveAgentCredential(
      credentials,
      null,
      null,
      false,
      'saved-a',
      'saved-b',
      false,
    )).toBeNull()
  })

  it('does not expose the first vault credential while remembered preferences are pending', () => {
    expect(resolveAgentCredential(
      credentials,
      null,
      null,
      false,
      null,
      null,
      true,
      false,
    )).toBeNull()
  })

  it('does not claim a deleted credential is available', () => {
    expect(resolveAgentCredential(credentials, null, 'missing', true)).toBeNull()
    expect(resolveAgentCredential(credentials, 'missing', null, false, null, 'saved-b')).toBe('saved-b')
  })
})

describe('resolveAgentLaunchCredentialSlug', () => {
  it('passes a resolved OpenCode/Pi credential even when runtime readiness came from global config', () => {
    expect(resolveAgentLaunchCredentialSlug(true, 'meituan-longcat')).toBe('meituan-longcat')
  })

  it('does not send credentials to login-backed runtimes', () => {
    expect(resolveAgentLaunchCredentialSlug(false, 'meituan-longcat')).toBeUndefined()
  })
})

describe('resolveExplicitLoginBackedCredential', () => {
  const credentials = [{ slug: 'anthropic-1' }, { slug: 'openai-1' }]

  it('keeps Claude/Codex on native global state when no Workspace override is explicit', () => {
    expect(resolveExplicitLoginBackedCredential(credentials, null)).toBeNull()
  })

  it('resolves an explicit Workspace override without falling back to another vault entry', () => {
    expect(resolveExplicitLoginBackedCredential(credentials, 'openai-1')).toBe('openai-1')
    expect(resolveExplicitLoginBackedCredential(credentials, 'deleted-entry')).toBeNull()
  })
})

describe('resolveAgentLaunchAiDetails', () => {
  const credential = {
    slug: 'google-1',
    resolvedModel: 'gemini-3.5-flash',
    resolvedContextWindow: 1_048_576,
  }

  it('shows the effective model and context already written in the target workspace', () => {
    expect(resolveAgentLaunchAiDetails(
      true,
      'google-1',
      credential,
      {
        configured: true,
        slug: 'google-1',
        model: 'gemini-3.1-flash-lite',
        contextWindow: 256_000,
        wireShape: 'google-generative-ai',
      },
      { credentialSlug: 'google-1', model: 'gemini-3.1-pro-preview' },
      true,
    )).toEqual({
      model: 'gemini-3.1-flash-lite',
      contextWindow: 256_000,
      source: 'workspace',
    })
  })

  it('shows the selected model registry context for a replacement injection', () => {
    expect(resolveAgentLaunchAiDetails(
      true,
      'google-1',
      credential,
      {
        configured: true,
        slug: 'openai-1',
        model: 'gpt-5.5',
        contextWindow: 1_000_000,
        wireShape: 'openai-chat',
      },
      undefined,
      true,
    )).toEqual({
      model: 'gemini-3.5-flash',
      contextWindow: 1_048_576,
      source: 'new-injection',
    })
  })

  it('shows the registered reasoning preview that a replacement injection will write', () => {
    expect(resolveAgentLaunchAiDetails(
      true,
      'google-1',
      {
        ...credential,
        resolvedReasoning: true,
        resolvedReasoningEffort: 'minimal',
        resolvedReasoningMode: 'adaptive',
      },
      {
        configured: true,
        slug: 'openai-1',
        model: 'gpt-5.5',
        contextWindow: 1_000_000,
        wireShape: 'openai-chat',
      },
      undefined,
      true,
    )).toEqual({
      model: 'gemini-3.5-flash',
      contextWindow: 1_048_576,
      reasoning: true,
      reasoningEffort: 'minimal',
      reasoningMode: 'adaptive',
      source: 'new-injection',
    })
  })

  it('keeps the Workspace reasoning policy next to its persisted effort', () => {
    expect(resolveAgentLaunchAiDetails(
      true,
      'google-1',
      credential,
      {
        configured: true,
        slug: 'google-1',
        model: 'gemini-3.5-flash',
        contextWindow: 256_000,
        wireShape: 'google-generative-ai',
        reasoning: true,
        reasoningEffort: 'medium',
        reasoningMode: 'adaptive',
      },
      undefined,
      true,
    )).toEqual({
      model: 'gemini-3.5-flash',
      contextWindow: 256_000,
      reasoning: true,
      reasoningEffort: 'medium',
      reasoningMode: 'adaptive',
      source: 'workspace',
    })
  })

  it('shows the configured creation model before the first workspace exists', () => {
    expect(resolveAgentLaunchAiDetails(
      true,
      'google-1',
      credential,
      null,
      { credentialSlug: 'google-1', model: 'gemini-3.1-pro-preview', contextWindow: 512_000 },
      false,
    )).toEqual({
      model: 'gemini-3.1-pro-preview',
      contextWindow: 512_000,
      source: 'new-injection',
    })
  })

  it('shows a usable hand-edited workspace config without a vault credential', () => {
    expect(resolveAgentLaunchAiDetails(
      true,
      null,
      null,
      {
        configured: true,
        slug: null,
        model: 'local-manual-model',
        contextWindow: 128_000,
        wireShape: 'openai-chat',
      },
      undefined,
      true,
    )).toEqual({
      model: 'local-manual-model',
      contextWindow: 128_000,
      source: 'workspace',
    })
  })

  it('shows a login-backed Workspace override without fabricating a context limit', () => {
    expect(resolveAgentLaunchAiDetails(
      false,
      'minimax-1',
      { slug: 'minimax-1', resolvedModel: 'MiniMax-M2.5' },
      {
        configured: true,
        slug: 'minimax-1',
        model: 'MiniMax-M2.5',
        contextWindow: null,
        wireShape: 'anthropic',
      },
      { credentialSlug: 'minimax-1', model: 'MiniMax-M2.5' },
      true,
    )).toEqual({
      model: 'MiniMax-M2.5',
      contextWindow: null,
      source: 'workspace',
    })
  })

  it('keeps native login fallback visible when no login-backed Workspace override exists', () => {
    expect(resolveAgentLaunchAiDetails(
      false,
      'minimax-1',
      { slug: 'minimax-1', resolvedModel: 'MiniMax-M2.5' },
      {
        configured: false,
        slug: null,
        model: null,
        contextWindow: null,
        wireShape: null,
      },
      undefined,
      true,
    )).toBeNull()
  })

  it('previews a login-backed creation default without claiming a runtime context limit', () => {
    expect(resolveAgentLaunchAiDetails(
      false,
      'minimax-1',
      { slug: 'minimax-1', resolvedModel: 'MiniMax-M2.5' },
      null,
      { credentialSlug: 'minimax-1', model: 'MiniMax-M2.5' },
      false,
    )).toEqual({
      model: 'MiniMax-M2.5',
      contextWindow: null,
      source: 'new-injection',
    })
  })

  it('formats the supported context tiers compactly', () => {
    expect(formatContextWindow(128_000)).toBe('128K')
    expect(formatContextWindow(256_000)).toBe('256K')
    expect(formatContextWindow(1_000_000)).toBe('1M')
  })
})
