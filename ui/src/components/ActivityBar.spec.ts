import { describe, expect, it } from 'vitest'

import { filterNavSections, NAV_SECTIONS, navSectionsForProduct } from './activity-navigation'

describe('ActivityBar navigation hierarchy', () => {
  it('keeps the primary workflow ordered with Quant below Issues', () => {
    const primary = NAV_SECTIONS.find((section) => section.sectionLabel === '')
    const beta = NAV_SECTIONS.find((section) => section.sectionLabel === 'Beta')
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
    expect(beta?.items.map((item) => item.page)).toContain('office')
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
      'office',
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

  it('hides Office unless the beta flag is on', () => {
    const hidden = filterNavSections(NAV_SECTIONS, { office: false })
    const shown = filterNavSections(NAV_SECTIONS, { office: true })
    const hiddenBeta = hidden.find((section) => section.sectionLabel === 'Beta')
    const shownBeta = shown.find((section) => section.sectionLabel === 'Beta')

    expect(hiddenBeta?.items.map((item) => item.page)).not.toContain('office')
    expect(hiddenBeta?.items.length).toBeGreaterThan(0)
    expect(shownBeta?.items.map((item) => item.page)).toContain('office')
    expect(shownBeta?.items[0]?.page).toBe('office')
  })
})
