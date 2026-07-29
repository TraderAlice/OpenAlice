import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { setupServer } from 'msw/node'

import { configKeysHandlers, demoCredentialPresets } from './configKeys'

const server = setupServer(...configKeysHandlers)
const baseUrl = window.location.origin

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }))
afterEach(() => server.resetHandlers())
afterAll(() => server.close())

function modelIds(presetId: string): string[] {
  const preset = demoCredentialPresets.find((candidate) => candidate.id === presetId)
  const model = preset?.schema.properties.model as {
    default?: string
    oneOf?: Array<{ const: string }>
  } | undefined
  return model?.oneOf?.map((option) => option.const) ?? []
}

describe('demo credential catalog', () => {
  it('covers the current OpenAI and Anthropic forms instead of falling back to Custom', () => {
    expect(modelIds('codex-api')).toEqual([
      'gpt-5.6',
      'gpt-5.6-terra',
      'gpt-5.6-luna',
      'gpt-5.5',
      'gpt-5.4',
    ])
    expect(modelIds('claude-api')).toEqual([
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-sonnet-5',
      'claude-haiku-4-5',
      'claude-sonnet-4-6',
    ])
  })
})

describe('demo snapshot config', () => {
  it('mirrors production duration validation and normalization', async () => {
    const invalid = await fetch(`${baseUrl}/api/config/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, every: 'nonsense' }),
    })

    expect(invalid.status).toBe(400)
    expect(await invalid.json()).toEqual({ error: 'Validation failed' })

    const valid = await fetch(`${baseUrl}/api/config/snapshot`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false, every: ' 2h15m ' }),
    })

    expect(valid.status).toBe(200)
    expect(await valid.json()).toEqual({ enabled: false, every: '2h15m' })
  })
})
