import { describe, expect, it } from 'vitest'

import { configToForm, connectionFieldsChanged, formToConfig } from './WorkspaceAIConfigModal'
import type { AgentProviderCapabilities } from './api'

const nativeCapabilities: AgentProviderCapabilities = {
  credentialSource: 'runtime-or-workspace',
  wirePreference: ['anthropic'],
}

const registeredModelCapabilities: AgentProviderCapabilities = {
  credentialSource: 'workspace-required',
  wirePreference: ['google-generative-ai', 'openai-chat', 'anthropic'],
  defaultWire: 'openai-chat',
  modelRegistration: {
    contextWindow: true,
    reasoning: true,
  },
}

describe('WorkspaceAIConfigModal Pi model capability mapping', () => {
  it.each([true, false])('round-trips reasoning=%s for Pi', (reasoning) => {
    const form = configToForm({
      baseUrl: 'https://provider.test/v1',
      apiKey: 'secret',
      model: 'reasoning-model',
      contextWindow: 512_000,
      wireShape: 'openai-chat',
      reasoning,
    }, registeredModelCapabilities)

    expect(form.reasoning).toBe(reasoning)
    expect(formToConfig(form, 'pi', registeredModelCapabilities)).toMatchObject({
      model: 'reasoning-model',
      contextWindow: 512_000,
      reasoning,
    })
  })

  it('shares an explicit unknown-model capability with opencode', () => {
    const form = configToForm(null, registeredModelCapabilities)
    expect(form.wireShape).toBe('openai-chat')
    form.reasoning = true
    expect(formToConfig(form, 'opencode', registeredModelCapabilities).reasoning).toBe(true)
  })

  it('round-trips a Workspace reasoning effort for every runtime', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'pi'] as const) {
      const form = configToForm({
        baseUrl: 'https://provider.test',
        apiKey: 'secret',
        model: 'reasoning-model',
        reasoningEffort: 'high',
      }, agent === 'claude' || agent === 'codex'
        ? nativeCapabilities
        : registeredModelCapabilities)
      expect(form.reasoningEffort).toBe('high')
      expect(formToConfig(
        form,
        agent,
        agent === 'claude' || agent === 'codex'
          ? nativeCapabilities
          : registeredModelCapabilities,
      )).toMatchObject({ reasoningEffort: 'high' })
    }
  })

  it('omits unknown-model reasoning when the runtime should decide', () => {
    const form = configToForm(null, registeredModelCapabilities)
    expect(form.reasoning).toBeNull()
    expect(formToConfig(form, 'pi', registeredModelCapabilities).reasoning).toBeUndefined()
  })

  it('omits context when the model registry or native runtime should decide', () => {
    const form = configToForm(null, registeredModelCapabilities)
    expect(form.contextWindow).toBeNull()
    expect(formToConfig(form, 'opencode', registeredModelCapabilities).contextWindow).toBeUndefined()
  })

  it('does not invalidate a connection test for local context or reasoning metadata', () => {
    const saved = {
      baseUrl: 'https://provider.test/v1',
      apiKey: 'secret',
      model: 'unknown-model',
      contextWindow: 256_000,
      wireShape: 'openai-chat' as const,
      reasoning: null,
    }
    const form = configToForm(saved, registeredModelCapabilities)
    form.contextWindow = 512_000
    form.reasoning = true
    form.reasoningEffort = 'high'

    expect(connectionFieldsChanged(saved, form, registeredModelCapabilities)).toBe(false)
  })

  it.each([
    ['baseUrl', 'https://other.test/v1'],
    ['apiKey', 'other-secret'],
    ['model', 'other-model'],
    ['wireShape', 'anthropic'],
  ] as const)('requires a new connection test when %s changes', (field, value) => {
    const saved = {
      baseUrl: 'https://provider.test/v1',
      apiKey: 'secret',
      model: 'model-a',
      contextWindow: 256_000,
      wireShape: 'openai-chat' as const,
    }
    const form = configToForm(saved, registeredModelCapabilities)
    Object.assign(form, { [field]: value })

    expect(connectionFieldsChanged(saved, form, registeredModelCapabilities)).toBe(true)
  })

  it.each(['codex', 'claude'] as const)(
    'lets %s native-login model and effort changes save without an HTTP probe',
    (agent) => {
      const form = configToForm(null, nativeCapabilities)
      form.model = agent === 'codex' ? 'gpt-5.6' : 'claude-opus-4-8'
      form.reasoningEffort = 'high'

      expect(connectionFieldsChanged(null, form, nativeCapabilities)).toBe(false)
    },
  )
})
