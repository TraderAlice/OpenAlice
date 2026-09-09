import { describe, expect, it } from 'vitest'

import { defaultUiLayout, type UiLayout } from '../live/ui-layout'
import { editorGroupsFromLayout, filterNavSections, joinNavLayout, NAV_SECTIONS, navSectionsForProduct } from './activity-navigation'

describe('ActivityBar navigation hierarchy', () => {
  it('keeps the primary workflow ordered with Quant below Issues', () => {
    const primary = NAV_SECTIONS.find((section) => section.sectionLabel === '')
    expect(NAV_SECTIONS.some((section) => section.id === 'beta')).toBe(false)
    const system = NAV_SECTIONS.find((section) => section.sectionLabel === 'System')

    expect(primary?.items.map((item) => item.page)).toEqual([
      'chat',
      'inbox',
      'issue',
      'auto-quant',
      'tracked',
      'market',
      'prediction',
      'office',
      'portfolio',
    ])
    expect(primary?.items.find((item) => item.page === 'portfolio')?.labelKey).toBe('nav.item.trading')
    expect(system?.items).toEqual([])
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
    ])
    expect(pages).not.toContain('market')
    expect(pages).not.toContain('portfolio')
  })

  it('does not resurrect retired entries or Connectors from saved layouts or the editor', () => {
    const layout = defaultUiLayout()
    const pages = joinNavLayout(NAV_SECTIONS, layout, { office: true }).flatMap(s => s.items.map(i => i.page))
    const editable = editorGroupsFromLayout(NAV_SECTIONS, layout).flatMap(g => g.items.map(i => i.page))
    expect(pages).not.toContain('workspaces')
    expect(editable).not.toContain('workspaces')
    expect(pages).not.toContain('automation')
    expect(editable).not.toContain('automation')
    expect(pages).not.toContain('connectors')
    expect(editable).not.toContain('connectors')
  })

  it('keeps Settings and Dev out of the default joined rail', () => {
    const pages = joinNavLayout(NAV_SECTIONS, defaultUiLayout(), { office: false })
      .flatMap((section) => section.items.map((item) => item.page))
    expect(pages).not.toContain('dev')
    expect(pages).not.toContain('settings')
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
    const hiddenPrimary = hidden.find((section) => section.id === 'primary')
    const shownPrimary = shown.find((section) => section.id === 'primary')

    expect(hiddenPrimary?.items.map((item) => item.page)).not.toContain('office')
    expect(hiddenPrimary?.items.length).toBeGreaterThan(0)
    expect(shownPrimary?.items.map((item) => item.page)).toContain('office')
    expect(shownPrimary?.items[0]?.page).toBe('chat')
  })

  it('flattens saved Beta entries consistently in the rail and editor', () => {
    const layout: UiLayout = {
      version: 1,
      groups: [
        { id: 'primary', items: ['chat', 'inbox', 'issue', 'auto-quant', 'tracked', 'market'] },
        { id: 'beta', items: ['connectors', 'portfolio', 'prediction', 'office'] },
      ],
      hidden: ['portfolio'],
    }
    const rail = joinNavLayout(NAV_SECTIONS, layout, { office: false })
    expect(rail.map(group => group.id)).toEqual(['primary'])
    expect(rail[0].items.map(item => item.page).slice(-2)).toEqual(['market', 'prediction'])
    const editor = editorGroupsFromLayout(NAV_SECTIONS, layout)
    expect(editor.some(group => group.id === 'beta')).toBe(false)
    expect(editor[0].items.find(item => item.page === 'portfolio')?.hidden).toBe(true)
  })
})
