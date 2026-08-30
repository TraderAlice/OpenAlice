// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { OfficeDrawerItem } from '../api/office'
import { i18n } from '../i18n'
import { officeDrawerTitles } from './drawer-presentation'

describe('Office drawer presentation', () => {
  it('numbers otherwise indistinguishable records without exposing internal IDs', async () => {
    await i18n.changeLanguage('en')
    const items: OfficeDrawerItem[] = [
      { id: 'inbox-uuid-a', kind: 'inbox', action: 'sent', at: 3, label: 'uuid-a', inboxEntryId: 'uuid-a' },
      { id: 'report-a', kind: 'report', action: 'sent', at: 2, label: 'report.md', path: 'report.md' },
      { id: 'inbox-uuid-b', kind: 'inbox', action: 'sent', at: 1, label: 'uuid-b', inboxEntryId: 'uuid-b' },
    ]

    expect([...officeDrawerTitles(items, i18n.t).entries()]).toEqual([
      ['inbox-uuid-a', 'Inbox delivery · 1/2'],
      ['report-a', 'report.md'],
      ['inbox-uuid-b', 'Inbox delivery · 2/2'],
    ])
  })
})
