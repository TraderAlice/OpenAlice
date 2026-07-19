import { describe, expect, it } from 'vitest'

import { NAV_SECTIONS } from './activity-navigation'

describe('ActivityBar navigation hierarchy', () => {
  it('keeps Workspaces out of primary navigation and under System', () => {
    const primary = NAV_SECTIONS.find((section) => section.sectionLabel === '')
    const system = NAV_SECTIONS.find((section) => section.sectionLabel === 'System')

    expect(primary?.items.map((item) => item.page)).not.toContain('workspaces')
    expect(system?.items.map((item) => item.page)).toContain('workspaces')
  })
})
