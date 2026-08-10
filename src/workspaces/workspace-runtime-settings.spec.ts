import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ResolvedSessionRuntimeBinding } from './cli-adapter.js'
import {
  emptyWorkspaceRuntimeSettings,
  readWorkspaceRuntimeSettings,
  rememberWorkspaceRuntimeBinding,
  replaceWorkspaceRuntimeDefaults,
  resolveWorkspaceRuntimeAgent,
  resolveWorkspaceRuntimeSelection,
  WORKSPACE_RUNTIME_SETTINGS_REL,
  writeWorkspaceRuntimeSettings,
} from './workspace-runtime-settings.js'

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'workspace-runtime-settings-'))
}

describe('Workspace runtime settings', () => {
  it('round-trips secret-free fixed defaults and recent fallbacks by scenario', async () => {
    const dir = await fixture()
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.askAlice = {
      defaultAgent: 'pi',
      agents: {
        pi: {
          accessMode: 'vault',
          credentialSlug: 'deepseek-1',
          wireShape: 'openai-chat',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
        },
      },
      recent: {
        agent: 'codex',
        agents: { codex: { accessMode: 'native', model: 'gpt-5.6-terra' } },
      },
    }
    await writeWorkspaceRuntimeSettings(dir, settings)
    expect(await readWorkspaceRuntimeSettings(dir)).toEqual({ ok: true, settings })
    expect(await readFile(join(dir, WORKSPACE_RUNTIME_SETTINGS_REL), 'utf8')).not.toContain('apiKey')
  })

  it('rejects secret-shaped and contradictory native fields', async () => {
    const dir = await fixture()
    await mkdir(join(dir, '.alice'), { recursive: true })
    await writeFile(join(dir, WORKSPACE_RUNTIME_SETTINGS_REL), JSON.stringify({
      version: 2,
      runtime: {
        askAlice: {
          agents: {
            pi: { accessMode: 'native', credentialSlug: 'secret-1', apiKey: 'nope' },
          },
        },
        issues: { agents: {} },
      },
    }))
    const result = await readWorkspaceRuntimeSettings(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid')
  })

  it('merges explicit fields over fixed defaults, which beat recent fallbacks', () => {
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.askAlice.agents.pi = {
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'fixed-model',
      reasoningEffort: 'high',
    }
    settings.runtime.askAlice.recent.agents.pi = {
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'recent-model',
      reasoningEffort: 'medium',
    }
    expect(resolveWorkspaceRuntimeSelection(settings, 'askAlice', 'pi', {
      reasoningEffort: 'low',
    })).toEqual({
      credentialSlug: 'deepseek-1',
      model: 'fixed-model',
      reasoningEffort: 'low',
    })
  })

  it('does not carry model or effort across an explicit credential switch', () => {
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.askAlice.agents.pi = {
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    }
    expect(resolveWorkspaceRuntimeSelection(settings, 'askAlice', 'pi', {
      credentialSlug: 'openai-1',
    })).toEqual({ credentialSlug: 'openai-1' })
    expect(resolveWorkspaceRuntimeSelection(settings, 'askAlice', 'pi', {
      credentialSource: 'native',
    })).toEqual({ credentialSource: 'native' })
  })

  it('resolves fixed scenario runtime before the recent runtime', () => {
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.issues.defaultAgent = 'codex'
    settings.runtime.issues.recent.agent = 'pi'
    expect(resolveWorkspaceRuntimeAgent(settings, 'issues')).toBe('codex')
    delete settings.runtime.issues.defaultAgent
    expect(resolveWorkspaceRuntimeAgent(settings, 'issues')).toBe('pi')
  })

  it('replaces fixed defaults without disturbing recent history or the other scenario', async () => {
    const dir = await fixture()
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.askAlice.recent = {
      agent: 'pi',
      agents: { pi: { accessMode: 'native', model: 'recent-model' } },
    }
    settings.runtime.issues.defaultAgent = 'codex'
    await writeWorkspaceRuntimeSettings(dir, settings)

    const updated = await replaceWorkspaceRuntimeDefaults({
      wsDir: dir,
      scenario: 'askAlice',
      defaultAgent: 'opencode',
      agents: { opencode: { accessMode: 'native', model: 'fixed-model' } },
    })
    expect(updated.runtime.askAlice).toMatchObject({
      defaultAgent: 'opencode',
      agents: { opencode: { model: 'fixed-model' } },
      recent: { agent: 'pi', agents: { pi: { model: 'recent-model' } } },
    })
    expect(updated.runtime.issues.defaultAgent).toBe('codex')
  })

  it('records fresh bindings as recent while preserving fixed defaults', async () => {
    const dir = await fixture()
    await replaceWorkspaceRuntimeDefaults({
      wsDir: dir,
      scenario: 'askAlice',
      defaultAgent: 'opencode',
      agents: { opencode: { accessMode: 'native', model: 'fixed-model' } },
    })
    const interactive: ResolvedSessionRuntimeBinding = {
      binding: {
        version: 1,
        credential: { source: 'vault', credentialSlug: 'deepseek-1', wireShape: 'openai-chat' },
        model: 'deepseek-chat',
        reasoningEffort: 'high',
      },
      ai: null,
    }
    const headless: ResolvedSessionRuntimeBinding = {
      binding: { version: 1, credential: { source: 'native' }, model: 'gpt-5.6-terra' },
      ai: null,
    }
    await rememberWorkspaceRuntimeBinding({ wsDir: dir, scenario: 'askAlice', agent: 'pi', runtime: interactive })
    await rememberWorkspaceRuntimeBinding({ wsDir: dir, scenario: 'issues', agent: 'codex', runtime: headless })
    const read = await readWorkspaceRuntimeSettings(dir)
    expect(read).toMatchObject({
      ok: true,
      settings: {
        runtime: {
          askAlice: {
            defaultAgent: 'opencode',
            agents: { opencode: { model: 'fixed-model' } },
            recent: { agent: 'pi', agents: { pi: { credentialSlug: 'deepseek-1' } } },
          },
          issues: {
            agents: {},
            recent: { agent: 'codex', agents: { codex: { accessMode: 'native', model: 'gpt-5.6-terra' } } },
          },
        },
      },
    })
  })
})
