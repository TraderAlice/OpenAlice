// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'

import type { OfficeDrawerItem } from '../api/office'
import { i18n } from '../i18n'
import { officeDrawerTitle, officeDrawerTitles } from './drawer-presentation'

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

  it('turns machine slugs into authored record names while preserving natural labels', async () => {
    await i18n.changeLanguage('en')
    const item = (kind: 'issue' | 'report', label: string): OfficeDrawerItem => ({
      id: label,
      kind,
      action: 'sent',
      at: 1,
      label,
      ...(kind === 'issue' ? { issueId: label } : { path: label }),
    })

    expect(officeDrawerTitle(item('issue', 'office-live-state-qa-20260831'), i18n.t))
      .toBe('Office Live State QA · 2026-08-31')
    expect(officeDrawerTitle(item('issue', 'office-live-working-qa-20260830-1836'), i18n.t))
      .toBe('Office Live Working QA · 2026-08-30 · 18:36')
    expect(officeDrawerTitle(item('report', 'office-navigation-playtest.md'), i18n.t))
      .toBe('Office Navigation Playtest')
    expect(officeDrawerTitle(item('issue', 'Office Visual-State QA Sleep Command'), i18n.t))
      .toBe('Office Visual-State QA Sleep Command')
    expect(officeDrawerTitle(item('report', 'report.md'), i18n.t)).toBe('report.md')
  })
})
