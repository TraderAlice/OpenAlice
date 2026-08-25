import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  normalizeAgentRuntimeQuickAccessIds,
  readAgentRuntimesPreferences,
  readAutoQuantPreferences,
  readAutoPredictionPreferences,
  readHarnessPreferences,
  readPreferences,
  readQuickChatPreferences,
  rememberAutoQuantDefaultWorkspace,
  rememberAutoPredictionDefaultWorkspace,
  rememberAgentRuntimeUse,
  rememberQuickChatCredential,
  rememberQuickChatLaunch,
  rememberRecentChatWorkspace,
  saveAgentRuntimesPreferences,
  saveHarnessPreferences,
} from './preferences.js'

const roots: string[] = []

async function preferenceFile(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'openalice-preferences-'))
  roots.push(root)
  return join(root, 'preferences.json')
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('preferences', () => {
  it('treats a missing or malformed file as empty preferences', async () => {
    const path = await preferenceFile()
    expect(await readPreferences(path)).toEqual({
      version: 1,
      quickChat: { lastCredentialByAgent: {}, recentChatWorkspaceId: null, recentLaunch: null },
      autoQuant: { defaultWorkspaceId: null },
      autoPrediction: { defaultWorkspaceId: null },
      harness: {
        showHeadlessBornSessions: false,
        showIssueAttachedSessions: false,
        showUnverifiedHarnessReleases: false,
      },
      agentRuntimes: { quickAccessIds: [], recentAgentIds: [] },
    })

    await writeFile(path, '{not-json', 'utf-8')
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: null,
    })
  })

  it('remembers independent credentials per agent without secret material', async () => {
    const path = await preferenceFile()
    await rememberQuickChatCredential('pi', 'minimax-1', path)
    await rememberQuickChatCredential('opencode', 'glm-1', path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'minimax-1', opencode: 'glm-1' },
      recentChatWorkspaceId: null,
    })
    const raw = await readFile(path, 'utf-8')
    expect(raw).not.toContain('apiKey')
    expect(raw).not.toContain('baseUrl')
  })

  it('clears one agent without disturbing the others', async () => {
    const path = await preferenceFile()
    await Promise.all([
      rememberQuickChatCredential('pi', 'minimax-1', path),
      rememberQuickChatCredential('opencode', 'glm-1', path),
    ])
    await rememberQuickChatCredential('pi', null, path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { opencode: 'glm-1' },
      recentChatWorkspaceId: null,
    })
  })

  it('remembers the complete secret-free Session launch tuple', async () => {
    const path = await preferenceFile()
    await rememberQuickChatLaunch({
      agent: 'pi',
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
    }, path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'deepseek-1' },
      recentChatWorkspaceId: null,
      recentLaunch: {
        agent: 'pi',
        accessMode: 'vault',
        credentialSlug: 'deepseek-1',
        model: 'deepseek-v4-flash',
        reasoningEffort: 'high',
      },
    })
    expect(await readFile(path, 'utf-8')).not.toContain('apiKey')
  })

  it('reads a pre-access-mode saved credential as a vault choice', async () => {
    const path = await preferenceFile()
    await writeFile(path, JSON.stringify({
      version: 1,
      quickChat: {
        lastCredentialByAgent: { pi: 'deepseek-1' },
        recentChatWorkspaceId: null,
        recentLaunch: {
          agent: 'pi',
          credentialSlug: 'deepseek-1',
          model: null,
          reasoningEffort: null,
        },
      },
    }), 'utf-8')

    expect((await readQuickChatPreferences(path)).recentLaunch?.accessMode).toBe('vault')
  })

  it('remembers a recent chat workspace without disturbing runtime credentials', async () => {
    const path = await preferenceFile()
    await rememberQuickChatCredential('pi', 'meituan-1', path)
    await rememberRecentChatWorkspace('chat-calm-river', path)

    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'meituan-1' },
      recentChatWorkspaceId: 'chat-calm-river',
    })

    await rememberRecentChatWorkspace(null, path)
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'meituan-1' },
      recentChatWorkspaceId: null,
    })
  })

  it('stores the AutoQuant default independently from Chat preferences', async () => {
    const path = await preferenceFile()
    await rememberRecentChatWorkspace('chat-calm-river', path)
    await rememberAutoQuantDefaultWorkspace('aq-main', path)

    expect(await readAutoQuantPreferences(path)).toEqual({
      defaultWorkspaceId: 'aq-main',
    })
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: 'chat-calm-river',
    })
  })

  it('stores the Auto Prediction default independently from other Harness preferences', async () => {
    const path = await preferenceFile()
    await rememberRecentChatWorkspace('chat-calm-river', path)
    await rememberAutoQuantDefaultWorkspace('aq-main', path)
    await rememberAutoPredictionDefaultWorkspace('prediction-main', path)

    expect(await readAutoPredictionPreferences(path)).toEqual({
      defaultWorkspaceId: 'prediction-main',
    })
    expect(await readAutoQuantPreferences(path)).toEqual({
      defaultWorkspaceId: 'aq-main',
    })
    expect(await readQuickChatPreferences(path)).toMatchObject({
      recentChatWorkspaceId: 'chat-calm-river',
    })
  })

  it('defaults harness roster visibility off and persists an explicit opt-in', async () => {
    const path = await preferenceFile()
    expect(await readHarnessPreferences(path)).toEqual({
      showHeadlessBornSessions: false,
      showIssueAttachedSessions: false,
      showUnverifiedHarnessReleases: false,
    })

    await saveHarnessPreferences({
      showHeadlessBornSessions: true,
      showIssueAttachedSessions: true,
      showUnverifiedHarnessReleases: false,
    }, path)
    expect(await readHarnessPreferences(path)).toEqual({
      showHeadlessBornSessions: true,
      showIssueAttachedSessions: true,
      showUnverifiedHarnessReleases: false,
    })
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: {},
      recentChatWorkspaceId: null,
    })
  })

  it('stores an ordered secret-free runtime quick-access list of at most four ids', async () => {
    const path = await preferenceFile()
    expect(normalizeAgentRuntimeQuickAccessIds(['pi', 'pi', '', 'codex', '  grok  ', 'omp', 'claude'])).toEqual([
      'pi', 'codex', 'grok', 'omp',
    ])
    expect(await readAgentRuntimesPreferences(path)).toEqual({
      quickAccessIds: [],
      recentAgentIds: [],
    })

    const saved = await saveAgentRuntimesPreferences({
      quickAccessIds: ['pi', 'codex', 'pi', 'grok', 'omp', 'claude'],
    }, path)
    expect(saved).toEqual({
      quickAccessIds: ['pi', 'codex', 'grok', 'omp'],
      recentAgentIds: [],
    })
    expect(await readAgentRuntimesPreferences(path)).toEqual({
      quickAccessIds: ['pi', 'codex', 'grok', 'omp'],
      recentAgentIds: [],
    })
    expect(await readFile(path, 'utf-8')).not.toContain('installed')
    expect(await readFile(path, 'utf-8')).not.toContain('binPath')

    await rememberQuickChatCredential('pi', 'minimax-1', path)
    expect(await readAgentRuntimesPreferences(path)).toEqual({
      quickAccessIds: ['pi', 'codex', 'grok', 'omp'],
      recentAgentIds: [],
    })
    expect(await readQuickChatPreferences(path)).toEqual({
      lastCredentialByAgent: { pi: 'minimax-1' },
      recentChatWorkspaceId: null,
    })
  })

  it('stores successful runtime use as a bounded MRU without changing the fallback baseline', async () => {
    const path = await preferenceFile()
    await saveAgentRuntimesPreferences({ quickAccessIds: ['pi', 'codex'] }, path)
    await rememberAgentRuntimeUse('claude', path)
    await rememberAgentRuntimeUse('grok', path)
    await rememberAgentRuntimeUse('claude', path)
    await rememberAgentRuntimeUse('opencode', path)
    await rememberAgentRuntimeUse('cursor', path)
    const saved = await rememberAgentRuntimeUse('omp', path)

    expect(saved).toEqual({
      quickAccessIds: ['pi', 'codex'],
      recentAgentIds: ['omp', 'cursor', 'opencode', 'claude'],
    })
  })
})
