import { describe, expect, it } from 'vitest'

import {
  describeModelSemantics,
  modelSupportsReasoning,
  resolveModelSemantics,
} from './model-semantics.js'
import { DEFAULT_MODEL_BY_VENDOR } from './preset-catalog.js'

describe('model semantics registry', () => {
  it('keeps exact known facts distinct from unknown models and aliases', () => {
    expect(resolveModelSemantics('openai', 'gpt-5.6')).toMatchObject({
      contextWindow: 1_050_000,
      reasoning: { mode: 'optional', defaultEffort: 'medium' },
    })
    expect(resolveModelSemantics('anthropic', 'default')).toBeNull()
    expect(resolveModelSemantics('custom', 'gpt-5.6')).toBeNull()
    expect(resolveModelSemantics('openai', 'future-model')).toBeNull()
  })

  it('records required versus optional reasoning without collapsing either to unknown', () => {
    const required = resolveModelSemantics('kimi', 'kimi-k2.7-code')
    const optional = resolveModelSemantics('kimi', 'kimi-k2.6')
    expect(required?.reasoning?.mode).toBe('required')
    expect(optional?.reasoning?.mode).toBe('optional')
    expect(modelSupportsReasoning(required)).toBe(true)
    expect(modelSupportsReasoning(optional)).toBe(true)
    expect(modelSupportsReasoning(null)).toBeNull()
  })

  it('describes registered runtime facts compactly', () => {
    expect(describeModelSemantics(resolveModelSemantics('deepseek', 'deepseek-v4-pro')))
      .toBe('Reasoning optional · default effort high · interleaved thinking · 1M context')
  })

  it('keeps LongCat\'s documented thinking default separate from effort tiers', () => {
    const semantics = resolveModelSemantics('longcat', 'LongCat-2.0')
    expect(semantics?.reasoning).toEqual({ mode: 'optional', defaultEnabled: true })
    expect(describeModelSemantics(semantics)).toBe('Reasoning optional · thinking default on')
  })

  it('keeps supported legacy MiniMax M2.5 workspaces reasoning-aware', () => {
    expect(resolveModelSemantics('minimax', 'MiniMax-M2.5')).toEqual({
      contextWindow: 204_800,
      reasoning: { mode: 'adaptive', interleaved: true },
    })
    expect(resolveModelSemantics('minimax', 'MiniMax-M2.5-highspeed'))
      .toEqual(resolveModelSemantics('minimax', 'MiniMax-M2.5'))
  })

  it('registers every built-in vendor injection default', () => {
    for (const [vendor, model] of Object.entries(DEFAULT_MODEL_BY_VENDOR)) {
      expect(resolveModelSemantics(vendor, model), `${vendor}/${model}`).not.toBeNull()
    }
  })
})
