import { describe, expect, it } from 'vitest'

import { NAV_SECTIONS } from '../components/activity-navigation'
import {
  ACTIVITY_PAGE_IDS,
  addCustomGroup,
  createCustomGroupId,
  defaultUiLayout,
  deleteCustomGroup,
  moveGroup,
  movePage,
  normalizeUiLayout,
  PINNED_ACTIVITY_PAGE,
  setPageHidden,
} from './ui-layout'

describe('ui-layout document', () => {
  it('covers every catalog page and hides Dev by default', () => {
    const catalogPages = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.page))
    expect(new Set(catalogPages)).toEqual(new Set(ACTIVITY_PAGE_IDS))
    expect(defaultUiLayout().hidden).toEqual(['dev'])
    expect(defaultUiLayout().hidden).not.toContain(PINNED_ACTIVITY_PAGE)
  })

  it('keeps Settings visible and restores missing catalog pages', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'primary', items: ['chat'] }],
      hidden: ['settings', 'dev'],
    })
    expect(layout.hidden).toEqual(['dev'])
    expect(layout.groups.flatMap((group) => group.items)).toEqual(expect.arrayContaining([...ACTIVITY_PAGE_IDS]))
  })

  it('moves pages and groups, and returns custom-group items to primary on delete', () => {
    let layout = addCustomGroup(defaultUiLayout(), createCustomGroupId(), 'Research')
    const customId = layout.groups.find((group) => group.id.startsWith('custom:'))?.id
    expect(customId).toBeTruthy()
    layout = movePage(layout, 'chat', customId!, 0)
    expect(layout.groups.find((group) => group.id === customId)?.items).toContain('chat')
    layout = moveGroup(layout, customId!, 0)
    expect(layout.groups[0]?.id).toBe(customId)
    layout = deleteCustomGroup(layout, customId!)
    expect(layout.groups.some((group) => group.id === customId)).toBe(false)
    expect(layout.groups.find((group) => group.id === 'primary')?.items).toContain('chat')
  })

  it('cannot hide Settings', () => {
    const layout = setPageHidden(defaultUiLayout(), 'settings', true)
    expect(layout.hidden).not.toContain('settings')
  })

  it('drops a retired news rail entry from persisted layouts', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'primary', items: ['chat', 'market', 'news'] }],
      hidden: ['news', 'dev'],
    })
    expect(layout.groups.find((group) => group.id === 'primary')?.items).not.toContain('news')
    expect(layout.hidden).not.toContain('news')
    expect(layout.hidden).toEqual(['dev'])
  })

  it('drops a retired trading-as-git rail entry from persisted layouts', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'beta', items: ['office', 'trading-as-git', 'portfolio', 'connectors'] }],
      hidden: ['trading-as-git', 'dev'],
    })
    expect(layout.groups.find((group) => group.id === 'beta')?.items).toEqual([
      'office',
      'portfolio',
      'connectors',
      'prediction',
    ])
    expect(layout.hidden).not.toContain('trading-as-git')
    expect(layout.hidden).toEqual(['dev'])
  })
})
