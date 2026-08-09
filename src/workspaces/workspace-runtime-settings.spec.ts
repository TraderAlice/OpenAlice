import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ResolvedSessionRuntimeBinding } from './cli-adapter.js'
import {
  emptyWorkspaceRuntimeSettings,
  readWorkspaceRuntimeSettings,
  rememberWorkspaceRuntimeBinding,
  resolveWorkspaceRuntimeSelection,
  WORKSPACE_RUNTIME_SETTINGS_REL,
  writeWorkspaceRuntimeSettings,
} from './workspace-runtime-settings.js'

async function fixture(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'workspace-runtime-settings-'))
}

describe('Workspace runtime settings', () => {
  it('round-trips a bounded secret-free interactive/headless document', async () => {
    const dir = await fixture()
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.interactive = {
      recentAgent: 'pi',
      agents: {
        pi: {
          accessMode: 'vault',
          credentialSlug: 'deepseek-1',
          wireShape: 'openai-chat',
          model: 'deepseek-chat',
          reasoningEffort: 'high',
        },
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
      version: 1,
      runtime: {
        interactive: {
          agents: {
            pi: { accessMode: 'native', credentialSlug: 'secret-1', apiKey: 'nope' },
          },
        },
        headless: { agents: {} },
      },
    }))
    const result = await readWorkspaceRuntimeSettings(dir)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid')
  })

  it('merges explicit model fields over one matching Workspace preference', () => {
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.interactive.agents.pi = {
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      wireShape: 'openai-chat',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    }
    expect(resolveWorkspaceRuntimeSelection(settings, 'interactive', 'pi', {
      reasoningEffort: 'low',
    })).toEqual({
      credentialSlug: 'deepseek-1',
      model: 'deepseek-chat',
      reasoningEffort: 'low',
    })
  })

  it('does not carry model or effort across an explicit credential switch', () => {
    const settings = emptyWorkspaceRuntimeSettings()
    settings.runtime.interactive.agents.pi = {
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-chat',
      reasoningEffort: 'high',
    }
    expect(resolveWorkspaceRuntimeSelection(settings, 'interactive', 'pi', {
      credentialSlug: 'openai-1',
    })).toEqual({ credentialSlug: 'openai-1' })
    expect(resolveWorkspaceRuntimeSelection(settings, 'interactive', 'pi', {
      credentialSource: 'native',
    })).toEqual({ credentialSource: 'native' })
  })

  it('records a fresh binding per surface and preserves the other surface', async () => {
    const dir = await fixture()
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
    await rememberWorkspaceRuntimeBinding({ wsDir: dir, surface: 'interactive', agent: 'pi', runtime: interactive })
    await rememberWorkspaceRuntimeBinding({ wsDir: dir, surface: 'headless', agent: 'codex', runtime: headless })
    const read = await readWorkspaceRuntimeSettings(dir)
    expect(read).toMatchObject({
      ok: true,
      settings: {
        runtime: {
          interactive: {
            recentAgent: 'pi',
            agents: { pi: { accessMode: 'vault', credentialSlug: 'deepseek-1' } },
          },
          headless: {
            recentAgent: 'codex',
            agents: { codex: { accessMode: 'native', model: 'gpt-5.6-terra' } },
          },
        },
      },
    })
  })
})
