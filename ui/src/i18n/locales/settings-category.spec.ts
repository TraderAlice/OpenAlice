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
})
