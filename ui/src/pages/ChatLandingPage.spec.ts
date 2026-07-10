import { describe, expect, it } from 'vitest'

import { resolveChatAgent, resolveChatCredential } from './ChatLandingPage'
import type { AgentRuntimeReadinessSnapshot } from '../components/workspace/api'

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

describe('resolveChatAgent', () => {
  it('keeps an explicit valid choice ahead of saved and detected defaults', () => {
    expect(resolveChatAgent(agents, 'codex', 'claude', readiness('claude'))).toBe('codex')
  })

  it('uses the saved default when there is no explicit choice', () => {
    expect(resolveChatAgent(agents, null, 'claude', readiness('codex'))).toBe('claude')
  })

  it('uses a verified runtime when no preference exists', () => {
    expect(resolveChatAgent(agents, null, null, readiness('codex'))).toBe('codex')
  })

  it('uses the only installed runtime while readiness is still stale', () => {
    const freshInstall = [
      { id: 'claude', installed: false },
      { id: 'codex', installed: false },
      { id: 'pi', installed: true },
    ]
    expect(resolveChatAgent(freshInstall, null, null, null)).toBe('pi')
  })

  it('does not guess when several runtimes are installed and none is ready', () => {
    expect(resolveChatAgent(agents, null, null, null)).toBeNull()
  })

  it('ignores choices that are unavailable in the target workspace', () => {
    expect(resolveChatAgent([{ id: 'pi', installed: true }], 'codex', 'claude', null)).toBe('pi')
  })
})

describe('resolveChatCredential', () => {
  const credentials = [{ slug: 'saved-a' }, { slug: 'saved-b' }]

  it('keeps an explicit provider choice', () => {
    expect(resolveChatCredential(credentials, 'saved-b', 'saved-a', true)).toBe('saved-b')
  })

  it('shows the detected provider even when workspace config is already ready', () => {
    expect(resolveChatCredential(credentials, null, 'saved-a', true)).toBe('saved-a')
  })

  it('falls back to the first credential only when workspace config needs one', () => {
    expect(resolveChatCredential(credentials, null, null, false)).toBe('saved-a')
    expect(resolveChatCredential(credentials, null, null, true)).toBeNull()
  })

  it('uses a configured workspace default before the remembered quick-chat choice', () => {
    expect(resolveChatCredential(
      credentials,
      null,
      null,
      false,
      'saved-b',
      'saved-a',
    )).toBe('saved-b')
  })

  it('uses the remembered quick-chat choice before the first credential', () => {
    expect(resolveChatCredential(
      credentials,
      null,
      null,
      false,
      null,
      'saved-b',
    )).toBe('saved-b')
  })

  it('keeps the workspace credential ahead of global defaults and history', () => {
    expect(resolveChatCredential(
      credentials,
      null,
      'saved-b',
      true,
      'saved-a',
      'saved-a',
    )).toBe('saved-b')
  })

  it('does not expose a global fallback while workspace detection is pending', () => {
    expect(resolveChatCredential(
      credentials,
      null,
      null,
      false,
      'saved-a',
      'saved-b',
      false,
    )).toBeNull()
  })

  it('does not claim a deleted credential is available', () => {
    expect(resolveChatCredential(credentials, null, 'missing', true)).toBeNull()
    expect(resolveChatCredential(credentials, 'missing', null, false, null, 'saved-b')).toBe('saved-b')
  })
})
