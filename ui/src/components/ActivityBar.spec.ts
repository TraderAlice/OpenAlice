import { describe, expect, it } from 'vitest'

import { NAV_SECTIONS } from './activity-navigation'

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
})
