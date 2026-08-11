import { describe, expect, it } from 'vitest'

import {
  describeModelSemantics,
  isModelReasoningEffort,
  modelSupportsReasoning,
  resolveModelSemantics,
} from './model-semantics.js'
import { DEFAULT_MODEL_BY_VENDOR } from './preset-catalog.js'

describe('model semantics registry', () => {
  it('keeps exact known facts distinct from unknown models and aliases', () => {
    expect(resolveModelSemantics('openai', 'gpt-5.6-sol')).toMatchObject({
      contextWindow: 1_050_000,
      reasoning: { mode: 'optional', defaultEffort: 'medium' },
    })
    expect(resolveModelSemantics('anthropic', 'default')).toBeNull()
    expect(resolveModelSemantics('openai', 'gpt-5.6')).toEqual(
      resolveModelSemantics('openai', 'gpt-5.6-sol'),
    )
    expect(resolveModelSemantics('custom', 'gpt-5.6')).toBeNull()
    expect(resolveModelSemantics('openai', 'future-model')).toBeNull()
  })

  it('keeps Luna\'s smaller API context distinct from Sol and Terra', () => {
    expect(resolveModelSemantics('openai', 'gpt-5.6-luna')?.contextWindow).toBe(400_000)
    expect(resolveModelSemantics('openai', 'gpt-5.6-terra')?.contextWindow).toBe(1_050_000)
  })

  it('accepts Codex subscription ultra effort without adding it to API model semantics', () => {
    expect(isModelReasoningEffort('ultra')).toBe(true)
    expect(resolveModelSemantics('openai', 'gpt-5.6-sol')?.reasoning?.efforts)
      .not.toContain('ultra')
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

  it('records Kimi K3 as an always-thinking 1M model with its native effort tiers', () => {
    expect(resolveModelSemantics('kimi', 'kimi-k3')).toEqual({
      contextWindow: 1_048_576,
      reasoning: {
        mode: 'required',
        efforts: ['low', 'high', 'max'],
        defaultEffort: 'max',
        interleaved: true,
      },
    })
  })

  it('records current Anthropic and Gemini defaults with their native effort contracts', () => {
    expect(resolveModelSemantics('anthropic', 'claude-opus-5')).toMatchObject({
      contextWindow: 1_000_000,
      maxOutputTokens: 128_000,
      reasoning: {
        mode: 'adaptive',
        efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
        defaultEffort: 'high',
      },
    })
    expect(resolveModelSemantics('google', 'gemini-3.6-flash')).toMatchObject({
      contextWindow: 1_048_576,
      maxOutputTokens: 65_536,
      reasoning: {
        mode: 'adaptive',
        efforts: ['medium', 'high'],
        defaultEffort: 'medium',
      },
    })
  })

  it('describes registered runtime facts compactly', () => {
    expect(describeModelSemantics(resolveModelSemantics('deepseek', 'deepseek-v4-pro')))
      .toBe('Reasoning optional · default effort high · interleaved thinking · 1M context')
  })

  it('records the V4 Flash 0731 API contract under its stable model id', () => {
    expect(resolveModelSemantics('deepseek', 'deepseek-v4-flash')).toEqual({
      contextWindow: 1_000_000,
      maxOutputTokens: 384_000,
      reasoning: {
        mode: 'optional',
        efforts: ['low', 'high', 'max'],
        defaultEffort: 'high',
        interleaved: true,
      },
    })
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

  it('records MiniMax M3 as adaptive 1M reasoning without inventing effort tiers', () => {
    expect(resolveModelSemantics('minimax', 'MiniMax-M3')).toEqual({
      contextWindow: 1_000_000,
      reasoning: { mode: 'adaptive', interleaved: true },
    })
  })

  it('registers every built-in vendor injection default', () => {
    for (const [vendor, model] of Object.entries(DEFAULT_MODEL_BY_VENDOR)) {
      expect(resolveModelSemantics(vendor, model), `${vendor}/${model}`).not.toBeNull()
    }
  })
})
