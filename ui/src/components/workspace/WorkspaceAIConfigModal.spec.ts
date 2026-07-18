import { describe, expect, it } from 'vitest'

import { configToForm, formToConfig } from './WorkspaceAIConfigModal'

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

  it('does not leak the Pi-only capability into opencode config', () => {
    const form = configToForm(null, 'opencode')
    form.reasoning = true
    expect(formToConfig(form, 'opencode').reasoning).toBeUndefined()
  })
})
