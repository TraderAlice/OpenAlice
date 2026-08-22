import { describe, expect, it } from 'vitest'

import { defaultUiLayout, type UiLayout } from '../live/ui-layout'
import { filterNavSections, joinNavLayout, NAV_SECTIONS, navSectionsForProduct } from './activity-navigation'

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
    ])
    expect(beta?.items.map((item) => item.page)).toEqual([
      'prediction',
      'office',
      'portfolio',
      'connectors',
    ])
    expect(beta?.items.find((item) => item.page === 'portfolio')?.labelKey).toBe('nav.item.trading')
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
      'prediction',
      'office',
      'connectors',
      'workspaces',
      'automation',
      'settings',
      'dev',
    ])
    expect(pages).not.toContain('market')
    expect(pages).not.toContain('portfolio')
  })

  it('hides Dev on the default joined rail and keeps Settings', () => {
    const pages = joinNavLayout(NAV_SECTIONS, defaultUiLayout(), { office: false })
      .flatMap((section) => section.items.map((item) => item.page))
    expect(pages).not.toContain('dev')
    expect(pages).toContain('settings')
    expect(pages).not.toContain('office')
  })

  it('joins a custom group and still applies Nano and Office gates', () => {
    const layout: UiLayout = {
      ...defaultUiLayout(),
      groups: [
        { id: 'custom:desk', label: 'Desk', items: ['chat', 'office', 'market'] },
        ...defaultUiLayout().groups.map((group) => ({
          ...group,
          items: group.items.filter((page) => page !== 'chat' && page !== 'office' && page !== 'market'),
        })),
      ],
    }
    const nano = joinNavLayout(NAV_SECTIONS, layout, { product: 'nano', office: true })
    expect(nano[0]).toMatchObject({ id: 'custom:desk', sectionLabel: 'Desk' })
    expect(nano[0]?.items.map((item) => item.page)).toEqual(['chat', 'office'])
    expect(nano.flatMap((section) => section.items.map((item) => item.page))).not.toContain('market')
  })

  it('hides Office unless the beta flag is on', () => {
    const hidden = filterNavSections(NAV_SECTIONS, { office: false })
    const shown = filterNavSections(NAV_SECTIONS, { office: true })
    const hiddenBeta = hidden.find((section) => section.sectionLabel === 'Beta')
    const shownBeta = shown.find((section) => section.sectionLabel === 'Beta')

    expect(hiddenBeta?.items.map((item) => item.page)).not.toContain('office')
    expect(hiddenBeta?.items.length).toBeGreaterThan(0)
    expect(shownBeta?.items.map((item) => item.page)).toContain('office')
    expect(shownBeta?.items[0]?.page).toBe('prediction')
  })
})
