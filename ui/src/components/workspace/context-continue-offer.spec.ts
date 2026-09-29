// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { shouldOfferContextContinue } from './context-continue-offer'
import type { ConversationItem } from '../conversation/types'

describe('context-continue offer rules', () => {
  const items = (n: number): ConversationItem[] => Array.from({ length: n }, (_, index) => ({
    kind: 'user' as const,
    key: `u${index}`,
    content: [{ kind: 'markdown' as const, text: `turn ${index}` }],
  }))

  const toolHeavy = (steps: number): ConversationItem[] => [{
    kind: 'assistant-turn',
    key: 'a',
    progress: [],
    final: '',
    activity: {
      thinking: [],
      unknownParts: [],
      steps: Array.from({ length: steps }, (_, id) => ({
        id: `t${id}`,
        name: 'run',
        summary: 'ok',
        input: '{}',
        thinking: [],
        status: 'succeeded' as const,
      })),
    },
  }]

  it('offers only for AutoQuant idle threads past the soft threshold', () => {
    expect(shouldOfferContextContinue({
      source: 'chat', phase: 'idle', items: items(20),
    })).toBe(false)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'working', items: items(20),
    })).toBe(false)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'idle', items: items(11),
    })).toBe(false)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'idle', items: items(12),
    })).toBe(true)
    expect(shouldOfferContextContinue({
      source: 'auto-quant', phase: 'idle', items: toolHeavy(20),
    })).toBe(true)
  })
})
