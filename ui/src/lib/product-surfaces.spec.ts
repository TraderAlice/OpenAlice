import { describe, expect, it } from 'vitest'

import {
  isNanoHiddenActivityPage,
  isNanoHiddenSettingsCategory,
  isNanoHiddenViewSpec,
  isNanoProduct,
} from './product-surfaces'

describe('Nano product surfaces', () => {
  it('treats only an explicit nano stamp as NanoAlice', () => {
    expect(isNanoProduct('nano')).toBe(true)
    expect(isNanoProduct('trader')).toBe(false)
    expect(isNanoProduct(undefined)).toBe(false)
  })

  it('hides trading and market-data activity pages', () => {
    expect(isNanoHiddenActivityPage('trading-as-git')).toBe(true)
    expect(isNanoHiddenActivityPage('portfolio')).toBe(true)
    expect(isNanoHiddenActivityPage('market')).toBe(true)
    expect(isNanoHiddenActivityPage('news')).toBe(true)
    expect(isNanoHiddenActivityPage('chat')).toBe(false)
    expect(isNanoHiddenActivityPage('auto-quant')).toBe(false)
    expect(isNanoHiddenActivityPage('tracked')).toBe(false)
  })

  it('hides the matching Settings categories and view specs', () => {
    expect(isNanoHiddenSettingsCategory('trading')).toBe(true)
    expect(isNanoHiddenSettingsCategory('market-data')).toBe(true)
    expect(isNanoHiddenSettingsCategory('news-collector')).toBe(true)
    expect(isNanoHiddenSettingsCategory('ai-provider')).toBe(false)
    expect(isNanoHiddenViewSpec({ kind: 'portfolio', params: {} })).toBe(true)
    expect(isNanoHiddenViewSpec({ kind: 'settings', params: { category: 'trading' } })).toBe(true)
    expect(isNanoHiddenViewSpec({ kind: 'settings', params: { category: 'general' } })).toBe(false)
    expect(isNanoHiddenViewSpec({ kind: 'chat-landing', params: {} })).toBe(false)
  })
})
