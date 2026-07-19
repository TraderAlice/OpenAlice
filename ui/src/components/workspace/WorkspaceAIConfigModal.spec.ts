import { describe, expect, it } from 'vitest'

import { configToForm, connectionFieldsChanged, formToConfig } from './WorkspaceAIConfigModal'

describe('WorkspaceAIConfigModal Pi model capability mapping', () => {
  it.each([true, false])('round-trips reasoning=%s for Pi', (reasoning) => {
    const form = configToForm({
      baseUrl: 'https://provider.test/v1',
      apiKey: 'secret',
      model: 'reasoning-model',
      contextWindow: 512_000,
      wireShape: 'openai-chat',
      reasoning,
    }, 'pi')

    expect(form.reasoning).toBe(reasoning)
    expect(formToConfig(form, 'pi')).toMatchObject({
      model: 'reasoning-model',
      contextWindow: 512_000,
      reasoning,
    })
  })

  it('shares an explicit unknown-model capability with opencode', () => {
    const form = configToForm(null, 'opencode')
    form.reasoning = true
    expect(formToConfig(form, 'opencode').reasoning).toBe(true)
  })

  it('round-trips a Workspace reasoning effort for every runtime', () => {
    for (const agent of ['claude', 'codex', 'opencode', 'pi'] as const) {
      const form = configToForm({
        baseUrl: 'https://provider.test',
        apiKey: 'secret',
        model: 'reasoning-model',
        reasoningEffort: 'high',
      }, agent)
      expect(form.reasoningEffort).toBe('high')
      expect(formToConfig(form, agent)).toMatchObject({ reasoningEffort: 'high' })
    }
  })

  it('omits unknown-model reasoning when the runtime should decide', () => {
    const form = configToForm(null, 'pi')
    expect(form.reasoning).toBeNull()
    expect(formToConfig(form, 'pi').reasoning).toBeUndefined()
  })

  it('omits context when the model registry or native runtime should decide', () => {
    const form = configToForm(null, 'opencode')
    expect(form.contextWindow).toBeNull()
    expect(formToConfig(form, 'opencode').contextWindow).toBeUndefined()
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
    const form = configToForm(saved, 'pi')
    form.contextWindow = 512_000
    form.reasoning = true
    form.reasoningEffort = 'high'

    expect(connectionFieldsChanged(saved, form, 'pi')).toBe(false)
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
    const form = configToForm(saved, 'pi')
    Object.assign(form, { [field]: value })

    expect(connectionFieldsChanged(saved, form, 'pi')).toBe(true)
  })
})
