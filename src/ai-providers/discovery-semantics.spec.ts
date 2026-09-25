import { expect, it } from 'vitest'
import { discoverModelSemantics } from './discovery-semantics.js'
import { mergeModelSemantics, modelSupportsReasoning } from './model-semantics.js'

it('normalizes Anthropic capability objects without inventing switching behavior', () => {
  expect(discoverModelSemantics({ max_input_tokens: 1000, max_tokens: 200, capabilities: {
    thinking: { supported: true, types: { adaptive: { supported: true } } },
    effort: { supported: true, low: { supported: true }, high: { supported: false }, max: { supported: true } },
  } }, 'anthropic')).toEqual({ contextWindow: 1000, maxOutputTokens: 200,
    reasoning: { supported: true, efforts: ['low', 'max'] } })
})
it('distinguishes absent, explicit unsupported and supported-with-unknown-levels', () => {
  expect(discoverModelSemantics({}, 'anthropic')).toBeUndefined()
  expect(discoverModelSemantics({ supported_parameters: ['reasoning'] }, 'openai')).toEqual({ reasoning: { supported: true } })
  expect(discoverModelSemantics({ supported_parameters: ['tools'] }, 'openai')).toBeUndefined()
  expect(discoverModelSemantics({ thinking: false }, 'google')).toEqual({ reasoning: { supported: false, mode: 'none' } })
  expect(modelSupportsReasoning({ reasoning: { supported: true } })).toBe(true)
})
it('retains gateway limits, explicit effort lists and defaults without raw response fields', () => {
  expect(discoverModelSemantics({ context_length: 1000, top_provider: { max_completion_tokens: 200 },
    supported_efforts: ['low', 'high'], default_parameters: { reasoning_effort: 'high' }, secret: 'discard' }, 'openai'))
    .toEqual({ contextWindow: 1000, maxOutputTokens: 200, reasoning: { efforts: ['low', 'high'], defaultEffort: 'high' } })
  expect(discoverModelSemantics({ context_length: -1, supported_efforts: ['future-level'] }, 'openai')).toBeUndefined()
})
it('merges by field while honoring false, empty lists and incompatible old defaults', () => {
  const fallback = { contextWindow: 1000, reasoning: { mode: 'required' as const, efforts: ['low', 'high'] as ('low' | 'high')[], defaultEffort: 'high' as const, interleaved: true } }
  expect(mergeModelSemantics(fallback, { reasoning: { efforts: ['low'], interleaved: false } }))
    .toEqual({ contextWindow: 1000, reasoning: { mode: 'required', efforts: ['low'], interleaved: false } })
  expect(mergeModelSemantics(fallback, { reasoning: { supported: false } })?.reasoning)
    .toEqual({ supported: false, mode: 'none', efforts: [] })
  expect(mergeModelSemantics(fallback, { reasoning: { efforts: [] } })?.reasoning?.defaultEffort).toBeUndefined()
  expect(mergeModelSemantics({ reasoning: { mode: 'none' } }, { reasoning: { supported: true } })?.reasoning)
    .toEqual({ supported: true })
})
