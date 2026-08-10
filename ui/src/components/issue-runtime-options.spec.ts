import { describe, expect, it } from 'vitest'

import type { Preset } from '../api'
import type { SavedCredential } from './workspace/api'
import {
  issueEffortOptions,
  issueModelOptions,
  issueModelSemantics,
  resolveIssueAiSelection,
} from './issue-runtime-options'

const deepSeek: SavedCredential = {
  slug: 'deepseek-1',
  vendor: 'deepseek',
  authType: 'api-key',
  wires: { anthropic: 'https://example.test' },
  resolvedModel: 'deepseek-v4-flash',
}

const presets: Preset[] = [{
  id: 'deepseek',
  label: 'DeepSeek',
  description: '',
  category: 'third-party',
  defaultName: 'DeepSeek',
  schema: {},
  models: [
    {
      id: 'deepseek-v4-pro',
      label: 'DeepSeek V4 Pro',
      semantics: { reasoning: { mode: 'optional', efforts: ['high', 'max'], defaultEffort: 'high' } },
    },
    {
      id: 'deepseek-v4-flash',
      label: 'DeepSeek V4 Flash',
      semantics: { reasoning: { mode: 'optional', efforts: ['low', 'high', 'max'], defaultEffort: 'high' } },
    },
  ],
}]

describe('Issue runtime options', () => {
  const mode = {
    agents: {},
    recent: {
      agent: 'pi',
      agents: {
        pi: {
          accessMode: 'vault' as const,
          credentialSlug: 'deepseek-1',
          model: 'deepseek-v4-flash',
          reasoningEffort: 'high' as const,
        },
      },
    },
  }

  it('shows the same headless recent tuple that dispatch inherits', () => {
    expect(resolveIssueAiSelection({ mode, agent: 'pi', issue: {} })).toEqual(expect.objectContaining({
      accessMode: 'vault',
      credentialSlug: 'deepseek-1',
      model: 'deepseek-v4-flash',
      reasoningEffort: 'high',
      accessOrigin: 'workspace-recent',
    }))
  })

  it('does not inherit a vault model when native login is selected explicitly', () => {
    expect(resolveIssueAiSelection({ mode, agent: 'pi', issue: { credentialSource: 'native' } }))
      .toEqual(expect.objectContaining({ accessMode: 'native', accessOrigin: 'issue' }))
    expect(resolveIssueAiSelection({ mode, agent: 'pi', issue: { credentialSource: 'native' } }).model)
      .toBeUndefined()
  })
  it('narrows model suggestions to the selected credential provider', () => {
    expect(issueModelOptions({
      agent: 'pi',
      credential: deepSeek,
      defaultModel: 'deepseek-v4-flash',
      presets,
    }).map((model) => model.id)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('uses registered model effort tiers and does not invent tiers for known models', () => {
    const models = issueModelOptions({ agent: 'pi', credential: deepSeek, defaultModel: 'deepseek-v4-flash', presets })
    const semantics = issueModelSemantics('deepseek-v4-flash', models)
    expect(issueEffortOptions({ agent: 'pi', semantics, modelKnown: true }))
      .toEqual(['low', 'high', 'max'])
    expect(issueEffortOptions({ agent: 'pi', semantics: { reasoning: { mode: 'required' } }, modelKnown: true }))
      .toEqual([])
  })

  it('preserves runtime-native effort choices for a custom model id', () => {
    expect(issueEffortOptions({ agent: 'claude', semantics: null, modelKnown: false }))
      .toEqual(['low', 'medium', 'high', 'max'])
  })
})
