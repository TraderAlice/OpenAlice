import { describe, expect, it } from 'vitest'

import { en } from './en'
import { ja } from './ja'
import { zhHant } from './zh-Hant'
import { zh } from './zh'

const locales = {
  en,
  ja,
  zh,
  'zh-Hant': zhHant,
}

describe.each(Object.entries(locales))('%s locale', (_locale, resources) => {
  it('uses the same Issues term in navigation and Settings', () => {
    expect(resources.settings.category.issues).toBe(resources.nav.item.issue)
  })

  it('exposes Appearance and Tools as first-class Settings categories', () => {
    expect(resources.settings.category.appearance).toBeTruthy()
    expect(resources.settings.category.tools).toBeTruthy()
  })

  it('exposes Activity bar as a Settings category', () => {
    expect(resources.settings.category.activityBar).toBeTruthy()
    expect(resources.settings.activityBar.title).toBeTruthy()
  })

  it('exposes Beta as a Settings category that can gate Office', () => {
    expect(resources.settings.category.beta).toBeTruthy()
    expect(resources.settings.beta.office).toBeTruthy()
  })

  it('exposes Harness as a Settings category for Ask Alice and Auto Quant', () => {
    expect(resources.settings.category.harness).toBe('Harness')
    expect(resources.settings.harness.showHeadlessBorn).toBeTruthy()
  })

  it('exposes Agent runtimes as a Settings category', () => {
    expect(resources.settings.category.agentRuntimes).toBeTruthy()
    expect(resources.settings.agentRuntimes.quickAccess).toBeTruthy()
    expect(resources.chatLanding.otherRuntimes).toBeTruthy()
  })
})
