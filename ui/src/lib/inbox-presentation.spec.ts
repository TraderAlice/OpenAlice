import { describe, expect, it } from 'vitest'

import {
  INBOX_EXCERPT_LIMIT,
  INBOX_SUBJECT_LIMIT,
  inboxRowLabel,
  inboxScan,
  presentInboxEntry,
} from './inbox-presentation'

const copy = {
  untitled: 'Update without a summary',
  unreadLabel: 'Unread',
  moreAttachments: (count: number) => `+${count} more`,
}

const row = {
  source: 'Research desk',
  unread: true,
  time: '5m ago',
}

describe('presentInboxEntry', () => {
  it('uses the first sentence as the scan subject and keeps later prose as a bounded excerpt', () => {
    const comments = [
      'Morning scan is in.',
      '',
      'VST led on datacenter-power flow, and the rest of the tape was quiet enough to ignore.',
    ].join('\n')

    expect(presentInboxEntry({ comments }, { ...copy, ...row })).toEqual({
      subject: 'Morning scan is in',
      documentTitle: 'Morning scan is in',
      excerpt: 'VST led on datacenter-power flow, and the rest of the tape was quiet enough to ignore.',
      repeatsLeadingHeading: false,
      rowLabel: 'Unread · Morning scan is in · Research desk · 5m ago',
    })
  })

  it('marks an exact leading Markdown heading so a reading surface can avoid duplicating it', () => {
    expect(presentInboxEntry({ comments: '# Close report\n\nThe book is flat.' }, { ...copy, ...row }))
      .toMatchObject({ subject: 'Close report', documentTitle: 'Close report', repeatsLeadingHeading: true })
    expect(presentInboxEntry({ comments: 'Close report\n\nThe book is flat.' }, { ...copy, ...row }))
      .toMatchObject({ subject: 'Close report', documentTitle: 'Close report', repeatsLeadingHeading: false })
  })

  it('keeps a long Markdown heading complete in the reading pane while bounding the scan subject', () => {
    const heading = 'A deliberately long close report heading that should remain complete in the document reading pane'
    const presented = presentInboxEntry({ comments: `# ${heading}\n\nThe book is flat.` }, { ...copy, ...row })

    expect(presented.subject.endsWith('…')).toBe(true)
    expect(presented.documentTitle).toBe(heading)
    expect(presented.repeatsLeadingHeading).toBe(true)
  })

  it('truncates long single-line prose at a word boundary without inventing words', () => {
    const tail = 'TAIL_MARKER_THAT_MUST_NOT_BECOME_THE_SUBJECT'
    const comments = `Services revenue growth has decelerated three quarters in a row and the headline EPS beat is masking the real story ${tail}`

    const presented = presentInboxEntry({ comments }, { ...copy, ...row, unread: false })

    expect(presented.subject.endsWith('…')).toBe(true)
    expect(presented.subject.includes('Services revenue growth')).toBe(true)
    expect(presented.subject.includes(tail)).toBe(false)
    expect(presented.subject.split(' ').every((word) => comments.includes(word.replace(/…$/, '')))).toBe(true)
    expect([...presented.subject].length).toBeLessThanOrEqual(INBOX_SUBJECT_LIMIT + 1)
    expect(presented.excerpt?.includes(tail)).toBe(true)
    expect(presented.rowLabel.includes(tail)).toBe(false)
    expect(presented.rowLabel.startsWith('Services')).toBe(true)
    expect(presented.rowLabel).not.toContain('Unread')
  })

  it('strips Markdown headings, lists, quotes, and emphasis instead of using markers as the title', () => {
    const comments = [
      '# **Close report**',
      '',
      '> - first finding still holds after the revise',
    ].join('\n')

    expect(inboxScan({ comments }, copy)).toEqual({
      subject: 'Close report',
      excerpt: 'first finding still holds after the revise',
    })
  })

  it('ignores surrounding whitespace and empty Markdown-only lines', () => {
    const comments = '\n\n   \n##   Watchlist\n\n---\n\n| Ticker | Gap |\n| --- | --- |\n\nThe book is flat after the trim.\n'

    expect(inboxScan({ comments }, copy).subject).toBe('Watchlist')
    expect(inboxScan({ comments }, copy).excerpt).toBe('The book is flat after the trim.')
  })

  it('treats CJK punctuation as a sentence boundary and truncates long CJK without spaces', () => {
    const presented = presentInboxEntry({
      comments: '今日市场扫描完成。利率与半导体均有变化，需要在收盘前再看一遍成交。',
    }, { ...copy, ...row })

    expect(presented.subject).toBe('今日市场扫描完成')
    expect(presented.excerpt?.startsWith('利率与半导体均有变化')).toBe(true)

    const uniqueTail = '尾部标记不得成为标题'
    const long = `${'这是一条没有标点的超长中文推送用于确认不会在字素中间切开'.repeat(3)}${uniqueTail}`
    const truncated = inboxScan({ comments: long }, copy).subject
    expect(truncated.endsWith('…')).toBe(true)
    expect(long.startsWith(truncated.replace(/…$/, ''))).toBe(true)
    expect(truncated.includes(uniqueTail)).toBe(false)
  })

  it('does not treat decimal numbers as sentence endings', () => {
    expect(inboxScan({
      comments: 'VST printed +7.4% on 3.1x relative volume and still touches the book.',
    }, copy).subject).toBe('VST printed +7.4% on 3.1x relative volume and still touches the book')
  })

  it('names attachment-only pushes from the file name and notes extra documents', () => {
    expect(inboxScan({
      comments: '   ',
      docs: [{ path: 'reports/movers-2026-06-27.md' }, { path: 'notes/context.txt' }],
    }, copy)).toEqual({
      subject: 'movers-2026-06-27.md · +1 more',
    })
  })

  it('uses the untitled fallback for empty pushes and never invents a body', () => {
    expect(inboxScan({ comments: '', docs: [] }, copy)).toEqual({
      subject: 'Update without a summary',
    })
    expect(inboxScan({}, copy).subject).toBe('Update without a summary')
  })

  it('omits an excerpt when the remainder does not add scan value', () => {
    expect(inboxScan({ comments: 'Book is flat.' }, copy).excerpt).toBeUndefined()
    expect(inboxScan({ comments: 'Done.\n\nok' }, copy).excerpt).toBeUndefined()
  })

  it('prefers the next sentence as the excerpt when the first sentence is truncated', () => {
    const presented = inboxScan({
      comments: 'Weekly macro digest is up — rates steepened, dollar soft, core PCE inline. Next week\'s calendar is at the bottom of the note.',
    }, copy)

    expect(presented.subject.startsWith('Weekly macro digest is up')).toBe(true)
    expect(presented.subject.endsWith('…')).toBe(true)
    expect(presented.subject.includes('inline')).toBe(false)
    expect(presented.excerpt).toBe('Next week\'s calendar is at the bottom of the note.')
  })

  it('builds a short row label and never uses the full report as the accessible name', () => {
    const omitted = 'OMITTED_REPORT_PARAGRAPH'
    const comments = `Close is ready.\n\n${'More supporting detail. '.repeat(20)}${omitted}`
    const label = presentInboxEntry({ comments }, { ...copy, ...row }).rowLabel

    expect(label).toBe('Unread · Close is ready · Research desk · 5m ago')
    expect(label.includes(omitted)).toBe(false)
    expect(label.length).toBeLessThan(120)
    expect(inboxRowLabel({
      subject: 'Close is ready',
      source: 'Research desk',
      unread: false,
      time: '5m ago',
      unreadLabel: 'Unread',
    })).toBe('Close is ready · Research desk · 5m ago')
  })

  it('keeps excerpts visually bounded', () => {
    const excerpt = inboxScan({
      comments: `Lead sentence.\n\n${'Additional context about the tape and the book. '.repeat(8)}`,
    }, copy).excerpt

    expect(excerpt?.endsWith('…')).toBe(true)
    expect([...excerpt ?? ''].length).toBeLessThanOrEqual(INBOX_EXCERPT_LIMIT + 1)
  })
})
