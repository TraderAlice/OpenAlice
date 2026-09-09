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
  it('covers every active catalog page while accepting retired layout ids', () => {
    const catalogPages = NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.page))
    // Persisted layout validation stays compatible; the navigation catalog
    // decides which accepted ids can actually appear or be configured.
    expect(new Set(catalogPages)).toEqual(new Set(ACTIVITY_PAGE_IDS.filter(page => page !== 'workspaces' && page !== 'automation' && page !== 'connectors')))
    expect(defaultUiLayout().hidden).toEqual([])
    expect(defaultUiLayout().hidden).not.toContain(PINNED_ACTIVITY_PAGE)
  })

  it('keeps Chat visible, drops retired Settings and Dev state, and restores missing catalog pages', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'primary', items: ['chat'] }],
      hidden: ['settings', 'dev'],
    })
    expect(layout.hidden).toEqual([])
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

  it('cannot hide Chat', () => {
    const layout = setPageHidden(defaultUiLayout(), 'chat', true)
    expect(layout.hidden).not.toContain('chat')
  })

  it('drops a retired news rail entry from persisted layouts', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'primary', items: ['chat', 'market', 'news'] }],
      hidden: ['news', 'dev'],
    })
    expect(layout.groups.find((group) => group.id === 'primary')?.items).not.toContain('news')
    expect(layout.hidden).not.toContain('news')
    expect(layout.hidden).toEqual([])
  })

  it('drops a retired trading-as-git rail entry from persisted layouts', () => {
    const layout = normalizeUiLayout({
      version: 1,
      groups: [{ id: 'beta', items: ['office', 'trading-as-git', 'portfolio', 'connectors'] }],
      hidden: ['trading-as-git', 'dev'],
    })
    expect(layout.groups.some((group) => group.id === 'beta')).toBe(false)
    expect(layout.groups.find((group) => group.id === 'primary')?.items.slice(0, 3)).toEqual([
      'office',
      'portfolio',
      'connectors',
    ])
    expect(layout.hidden).not.toContain('trading-as-git')
    expect(layout.hidden).toEqual([])
  })

  it('projects old Beta layouts without losing custom groups, ordering or visibility', () => {
    const saved = {
      version: 1,
      groups: [
        { id: 'beta', items: ['connectors', 'prediction'] },
        { id: 'custom:desk', label: 'Desk', items: ['office', 'portfolio'] },
        { id: 'primary', items: ['market', 'chat', 'inbox', 'issue', 'auto-quant', 'tracked'] },
      ],
      hidden: ['prediction'],
    }
    const original = structuredClone(saved)
    const layout = normalizeUiLayout(saved)
    expect(saved).toEqual(original)
    expect(layout.groups.map(group => group.id)).toEqual(['custom:desk', 'primary', 'system'])
    expect(layout.groups[0]).toEqual(saved.groups[1])
    expect(layout.groups[1].items).toEqual([...saved.groups[2].items, 'connectors', 'prediction'])
    expect(layout.hidden).toEqual(['prediction'])
    expect(normalizeUiLayout(layout)).toEqual(layout)
    expect(normalizeUiLayout(defaultUiLayout())).toEqual(defaultUiLayout())
    const reordered = movePage(layout, 'prediction', 'primary', 1)
    expect(reordered.groups[1].items.slice(0, 3)).toEqual(['market', 'prediction', 'chat'])
  })
})
