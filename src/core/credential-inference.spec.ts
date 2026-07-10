import { describe, it, expect } from 'vitest'
import {
  inferCredentialVendor,
  resolveAnthropicAuthMode,
} from './credential-inference.js'

describe('inferCredentialVendor', () => {
  it('a recognized baseUrl wins over the agent', () => {
    expect(inferCredentialVendor({ agent: 'codex', baseUrl: 'https://open.bigmodel.cn/api/anthropic' })).toBe('glm')
    expect(inferCredentialVendor({ agent: 'claude', baseUrl: 'https://api.z.ai/api/paas/v4' })).toBe('glm')
    expect(inferCredentialVendor({ baseUrl: 'https://api.minimax.io/anthropic' })).toBe('minimax')
    expect(inferCredentialVendor({ baseUrl: 'https://api.moonshot.cn/v1' })).toBe('kimi')
    expect(inferCredentialVendor({ baseUrl: 'https://api.deepseek.com' })).toBe('deepseek')
    expect(inferCredentialVendor({ baseUrl: 'https://api.longcat.chat/openai' })).toBe('longcat')
  })

  it('falls back to the agent when the baseUrl is unrecognized', () => {
    expect(inferCredentialVendor({ agent: 'claude', baseUrl: 'https://proxy.example.com' })).toBe('anthropic')
    expect(inferCredentialVendor({ agent: 'codex' })).toBe('openai')
  })

  it('opencode/pi against an arbitrary endpoint → custom (no first-party guess)', () => {
    expect(inferCredentialVendor({ agent: 'opencode', baseUrl: 'https://gw.example.com/v1' })).toBe('custom')
    expect(inferCredentialVendor({ agent: 'pi' })).toBe('custom')
    expect(inferCredentialVendor({})).toBe('custom')
  })
})

describe('resolveAnthropicAuthMode', () => {
  it('explicit authMode wins over everything', () => {
    expect(resolveAnthropicAuthMode({ authMode: 'bearer' })).toBe('bearer')
    expect(resolveAnthropicAuthMode({ authMode: 'x-api-key' })).toBe('x-api-key')
    // explicit x-api-key beats the .io baseUrl inference
    expect(resolveAnthropicAuthMode({ authMode: 'x-api-key', baseUrl: 'https://api.minimax.io/anthropic' }))
      .toBe('x-api-key')
  })

  it('infers bearer for MiniMax international (api.minimax.io)', () => {
    expect(resolveAnthropicAuthMode({ baseUrl: 'https://api.minimax.io/anthropic' })).toBe('bearer')
  })

  it('infers bearer for LongCat anthropic compatibility', () => {
    expect(resolveAnthropicAuthMode({ baseUrl: 'https://api.longcat.chat/anthropic' })).toBe('bearer')
  })

  it('does NOT infer bearer for MiniMax China (minimaxi.com tolerates x-api-key)', () => {
    expect(resolveAnthropicAuthMode({ baseUrl: 'https://api.minimaxi.com/anthropic' })).toBe('x-api-key')
  })

  it('defaults to x-api-key for first-party Anthropic and unconfirmed gateways', () => {
    expect(resolveAnthropicAuthMode({})).toBe('x-api-key')
    expect(resolveAnthropicAuthMode({ baseUrl: 'https://api.anthropic.com' })).toBe('x-api-key')
    expect(resolveAnthropicAuthMode({ baseUrl: 'https://api.z.ai/api/anthropic' })).toBe('x-api-key')
    expect(resolveAnthropicAuthMode({ baseUrl: 'https://api.deepseek.com/anthropic' })).toBe('x-api-key')
  })
})
