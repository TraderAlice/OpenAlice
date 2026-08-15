import { describe, expect, it } from 'vitest'

import { NAV_SECTIONS, navSectionsForProduct } from './activity-navigation'

describe('ActivityBar navigation hierarchy', () => {
  it('keeps the primary workflow ordered with Quant below Issues', () => {
    const primary = NAV_SECTIONS.find((section) => section.sectionLabel === '')
    const system = NAV_SECTIONS.find((section) => section.sectionLabel === 'System')

    expect(primary?.items.map((item) => item.page)).toEqual([
      'chat',
      'inbox',
      'issue',
      'auto-quant',
      'tracked',
      'market',
      'news',
    ])
    expect(system?.items.map((item) => item.page)).toContain('workspaces')
  })

  it('hides trading and market-data pages on NanoAlice', () => {
    const pages = navSectionsForProduct('nano').flatMap((section) => section.items.map((item) => item.page))
    expect(pages).toEqual([
      'chat',
      'inbox',
      'issue',
      'auto-quant',
      'tracked',
      'connectors',
      'workspaces',
      'automation',
      'settings',
      'dev',
    ])
    expect(pages).not.toContain('market')
    expect(pages).not.toContain('news')
    expect(pages).not.toContain('trading-as-git')
    expect(pages).not.toContain('portfolio')
  })
})
