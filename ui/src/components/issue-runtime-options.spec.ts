import { describe, expect, it } from 'vitest'

import type { Preset } from '../api'
import type { SavedCredential } from './workspace/api'
import { AGY_FIRST_PARTY_MODEL_IDS } from '../lib/agy-models'
import { CURSOR_FIRST_PARTY_MODEL_IDS } from '../lib/cursor-models'
import { GROK_FIRST_PARTY_MODEL_IDS } from '../lib/grok-models'
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
    expect(issueEffortOptions({ agent: 'cursor', semantics: null, modelKnown: false }))
      .toEqual([])
    expect(issueEffortOptions({ agent: 'agy', semantics: null, modelKnown: false }))
      .toEqual(['low', 'medium', 'high'])
    expect(issueEffortOptions({ agent: 'agy', semantics: null, modelKnown: true }))
      .toEqual([])
    expect(issueEffortOptions({
      agent: 'cursor',
      semantics: { reasoning: { mode: 'optional', efforts: ['low', 'high'] } },
      modelKnown: true,
    })).toEqual([])
    expect(issueEffortOptions({ agent: 'grok', semantics: null, modelKnown: false }))
      .toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(issueEffortOptions({
      agent: 'grok',
      semantics: null,
      modelKnown: false,
      model: 'custom-gateway-model',
    })).toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
    expect(issueEffortOptions({ agent: 'omp', semantics: null, modelKnown: false }))
      .toEqual(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  })

  it('suggests Grok Build CLI ids on native login and keeps vault catalogs intact', () => {
    expect(issueModelOptions({
      agent: 'grok',
      credential: null,
      defaultModel: null,
      presets,
    }).map((model) => model.id)).toEqual([...GROK_FIRST_PARTY_MODEL_IDS])
    const native = issueModelOptions({
      agent: 'grok',
      credential: null,
      defaultModel: null,
      presets,
    })
    expect(issueEffortOptions({
      agent: 'grok',
      semantics: issueModelSemantics('grok-4.6', native),
      modelKnown: true,
      model: 'grok-4.6',
    })).toEqual(['low', 'medium', 'high', 'xhigh'])
    expect(issueEffortOptions({
      agent: 'grok',
      semantics: issueModelSemantics('grok-4.5', native),
      modelKnown: true,
      model: 'grok-4.5',
    })).toEqual(['low', 'medium', 'high'])
    expect(issueModelOptions({
      agent: 'grok',
      credential: deepSeek,
      defaultModel: 'deepseek-v4-flash',
      presets,
    }).map((model) => model.id)).toEqual(['deepseek-v4-pro', 'deepseek-v4-flash'])
  })

  it('suggests Antigravity first-party Gemini slugs even when a vault catalog is bound', () => {
    expect(issueModelOptions({
      agent: 'agy',
      credential: null,
      defaultModel: null,
      presets,
    }).map((model) => model.id)).toEqual([...AGY_FIRST_PARTY_MODEL_IDS])
    expect(issueModelOptions({
      agent: 'agy',
      credential: deepSeek,
      defaultModel: 'gemini-3.5-flash',
      presets,
    }).map((model) => model.id)).toEqual([...AGY_FIRST_PARTY_MODEL_IDS])
  })

  it('suggests Cursor first-party CLI ids even when a vault catalog is bound', () => {
    expect(issueModelOptions({
      agent: 'cursor',
      credential: null,
      defaultModel: null,
      presets,
    }).map((model) => model.id)).toEqual([...CURSOR_FIRST_PARTY_MODEL_IDS])
    expect(issueModelOptions({
      agent: 'cursor',
      credential: deepSeek,
      defaultModel: 'gpt-5.2-high',
      presets,
    }).map((model) => model.id)).toEqual(['gpt-5.2-high', ...CURSOR_FIRST_PARTY_MODEL_IDS])
  })

  it('suggests xAI catalog models for a grok vault credential', () => {
    const xai: SavedCredential = {
      slug: 'xai-1',
      vendor: 'xai',
      authType: 'api-key',
      wires: { 'openai-chat': 'https://api.x.ai/v1' },
      resolvedModel: 'grok-4.6',
    }
    const xaiPresets: Preset[] = [{
      id: 'xai-api',
      label: 'xAI',
      description: '',
      category: 'official',
      defaultName: 'xAI',
      schema: {},
      models: [
        { id: 'grok-4.6', label: 'Grok 4.6' },
        { id: 'grok-4.5', label: 'Grok 4.5' },
      ],
    }]
    expect(issueModelOptions({
      agent: 'grok',
      credential: xai,
      defaultModel: 'grok-4.6',
      presets: xaiPresets,
    }).map((model) => model.id)).toEqual(['grok-4.6', 'grok-4.5'])
  })
})
