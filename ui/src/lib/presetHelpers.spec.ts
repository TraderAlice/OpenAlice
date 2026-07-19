import { describe, expect, it } from 'vitest'

import {
  agentWireShapes,
  anthropicAuthModeForBaseUrl,
  baseUrlToVendor,
  describeModelSemantics,
  pickAgentWire,
  presetModel,
  savedCredentialModel,
} from './presetHelpers'
import type { Preset } from '../api'

const multiWire = {
  anthropic: 'https://provider.example/anthropic',
  'openai-chat': 'https://provider.example/v1',
} as const

const modelPreset: Preset = {
  id: 'test',
  label: 'Test',
  description: 'Test models',
  category: 'custom',
  defaultName: 'Test',
  schema: {
    type: 'object',
    properties: {
      model: {
        type: 'string',
        default: 'stable-default',
        oneOf: [
          { const: 'newest-first', title: 'Newest' },
          { const: 'stable-default', title: 'Stable default' },
        ],
      },
    },
  },
  models: [
    { id: 'newest-first', label: 'Newest' },
    {
      id: 'stable-default',
      label: 'Stable default',
      semantics: {
        contextWindow: 1_000_000,
        reasoning: { mode: 'adaptive', defaultEffort: 'high', interleaved: true },
      },
    },
  ],
}

describe('agent wire selection', () => {
  it('lists every compatible Pi/opencode protocol in runtime preference order', () => {
    expect(agentWireShapes(multiWire, 'pi')).toEqual(['openai-chat', 'anthropic'])
    expect(agentWireShapes(multiWire, 'opencode')).toEqual(['openai-chat', 'anthropic'])
  })

  it('only exposes MiniMax Anthropic to coding CLIs without changing generic providers', () => {
    expect(agentWireShapes(multiWire, 'pi', 'minimax')).toEqual(['anthropic'])
    expect(agentWireShapes(multiWire, 'opencode', 'minimax')).toEqual(['anthropic'])
    expect(pickAgentWire(multiWire, 'opencode', undefined, 'minimax')?.shape).toBe('anthropic')
  })

  it('derives the native endpoint for an old official MiniMax OpenAI-only credential', () => {
    const oldCredential = { 'openai-chat': 'https://api.minimaxi.com/v1' } as const
    expect(agentWireShapes(oldCredential, 'pi', 'minimax')).toEqual(['anthropic'])
    expect(pickAgentWire(oldCredential, 'pi', 'openai-chat', 'minimax')).toEqual({
      shape: 'anthropic',
      baseUrl: 'https://api.minimaxi.com/anthropic',
    })
  })

  it('repairs an old MiniMax OpenAI default and rejects other incompatible protocols', () => {
    expect(pickAgentWire(multiWire, 'pi', 'anthropic')).toEqual({
      shape: 'anthropic',
      baseUrl: 'https://provider.example/anthropic',
    })
    expect(pickAgentWire(multiWire, 'pi', 'openai-chat', 'minimax')).toEqual({
      shape: 'anthropic',
      baseUrl: 'https://provider.example/anthropic',
    })
    expect(pickAgentWire(multiWire, 'codex', 'anthropic')).toBeNull()
  })
})

describe('provider inference', () => {
  it('recognizes the native Gemini endpoint', () => {
    expect(baseUrlToVendor('https://generativelanguage.googleapis.com/v1beta')).toBe('google')
  })

  it('keeps UI Anthropic auth inference aligned with the backend', () => {
    expect(anthropicAuthModeForBaseUrl('https://api.minimaxi.com/anthropic')).toBe('bearer')
    expect(anthropicAuthModeForBaseUrl('https://api.minimax.io/anthropic')).toBe('bearer')
    expect(anthropicAuthModeForBaseUrl('https://api.longcat.chat/anthropic')).toBe('bearer')
    expect(anthropicAuthModeForBaseUrl('https://api.anthropic.com')).toBe('x-api-key')
  })
})

describe('saved credential model selection', () => {
  it('keeps the credential last model ahead of catalog ordering', () => {
    expect(savedCredentialModel({ lastModel: 'user-model' }, modelPreset)).toBe('user-model')
  })

  it('uses the explicit catalog default instead of the first suggestion', () => {
    expect(savedCredentialModel({}, modelPreset)).toBe('stable-default')
  })

  it('resolves and describes exact rich model semantics', () => {
    const semantics = presetModel(modelPreset, 'stable-default')?.semantics
    expect(describeModelSemantics(semantics))
      .toBe('Adaptive reasoning · default effort: high · interleaved thinking · 1M context')
    expect(presetModel(modelPreset, 'free-typed-model')).toBeNull()
  })
})
