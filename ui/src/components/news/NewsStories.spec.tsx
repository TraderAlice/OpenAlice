import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NewsStoryDetail } from '../../api/types'
import { i18n } from '../../i18n'
import { NewsStories } from './NewsStories'

const mocks = vi.hoisted(() => ({ getStory: vi.fn(), setReader: vi.fn(), getRelatedStories: vi.fn() }))
vi.mock('../../api', () => ({ api: { news: mocks } }))
vi.mock('../../api/market', () => ({ barsApi: { bars: vi.fn(async () => ({ results: [], meta: null })) } }))
const story = (): NewsStoryDetail => ({
  version: 1, id: 'port-closure', revision: 1, title: 'Port closure', summary: 'The authority announced a closure.',
  reason: 'Shipping disruption is possible; price effects remain unknown.', topics: ['shipping'], symbols: [], selected: false,
  status: 'watching', updatedAt: '2026-10-24T11:00:00Z', preparedBy: 'Test fixture', overviewReportIds: [2], missingReportIds: [],
  developments: [{ id: 'closure', time: '2026-10-24T09:00:00Z', title: 'Closure announced', summary: 'Reopening time is unknown.', reportIds: [1, 2] }],
  reports: [
    { id: 1, title: 'Official closure notice', content: 'The port is closed.', source: 'Port authority', role: 'official', time: '2026-10-24T09:00:00Z', link: 'https://example.test/official', categories: null, image: null },
    { id: 2, title: 'Independent closure report', content: 'The closure was reported.', source: 'News desk', role: 'reporting', time: '2026-10-24T09:05:00Z', link: 'https://example.test/report', categories: null, image: null },
  ],
})
beforeEach(async () => { await i18n.changeLanguage('en'); mocks.getStory.mockReset().mockResolvedValue(story()); mocks.setReader.mockReset().mockImplementation(async (_id, patch) => patch.readRevision === undefined ? patch : { readProgress: patch.readRevision === null ? null : { revision: patch.readRevision, developmentIds: story().developments.map(value => value.id) } }); mocks.getRelatedStories.mockReset().mockResolvedValue([]) })
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('event reader usability', () => {
  it('labels a feed summary without calling it a complete publisher article', async () => {
    const detail = story()
    detail.reports[0].contentBasis = 'feed-summary'
    mocks.getStory.mockResolvedValue(detail)
    render(<NewsStories stories={[detail]} locale="en" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Port closure' }))
    expect(await screen.findByText('Feed summary')).toBeTruthy()
  })
  it('refreshes an opened relationship correction without requiring a new event revision', async () => {
    const view: NonNullable<NewsStoryDetail['associations']> = { status: 'current', current: { version: 1, storyId: 'port-closure', revision: 1, storyRevision: 1, preparedAt: '2026-10-24T11:00:00Z', preparedBy: 'Fixture', protected: true, authority: 'operator', unresolved: [], relations: [{ id: 'country', country: 'CA', kind: 'mentioned', status: 'active', explanation: 'A sourced mention.', evidence: [{ reportId: 1, field: 'content', sha256: '0'.repeat(64), excerpt: 'The port' }] }] } }
    const first = { ...story(), associations: view }
    mocks.getStory.mockResolvedValue(first)
    const rendered = render(<NewsStories stories={[first]} locale="en" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Port closure' }))
    expect(await screen.findByText(/Relationship revision 1/)).toBeTruthy()
    const next: NewsStoryDetail = { ...first, associations: { status: 'current', current: { ...view.current!, revision: 2, relations: view.current!.relations.map(relation => ({ ...relation, status: 'withdrawn' })) } } }
    mocks.getStory.mockResolvedValue(next)
    rendered.rerender(<NewsStories stories={[next]} locale="en" />)
    expect(await screen.findByText(/Relationship revision 2/)).toBeTruthy()
    expect(screen.getByText(/Withdrawn/)).toBeTruthy()
  })
  it('follows an event independently of its bookmark and importance flags', async () => {
    render(<NewsStories stories={[story()]} locale="en" />)
    await userEvent.setup().click(screen.getByRole('button', { name: 'Follow event: Port closure' }))
    expect(mocks.setReader).toHaveBeenCalledWith('port-closure', { following: true })
    expect(await screen.findByRole('button', { name: 'Unfollow event: Port closure' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bookmark: Port closure' }).getAttribute('aria-pressed')).toBe('false')
  })
  it('keeps an opened filtered event readable when polling removes it and restores list focus on closing', async () => {
    const user = userEvent.setup()
    const view = render(<NewsStories stories={[story()]} locale="en" preserveOpened rankOffset={50} />)
    expect(screen.getByLabelText('Coverage rank 51')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    await screen.findByText(story().reason)
    await waitFor(() => expect(mocks.setReader).toHaveBeenCalledWith('port-closure', { readRevision: 1 }))
    view.rerender(<NewsStories stories={[]} locale="en" preserveOpened rankOffset={50} />)
    expect(screen.getByText(story().reason)).toBeTruthy()
    expect(screen.queryByLabelText(/Coverage rank/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(screen.queryByText(story().reason)).toBeNull()
    expect(screen.queryByRole('button', { name: 'Port closure' })).toBeNull()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Events' })))
  })

  it('keeps every explicit asset code readable after opening while chart cards remain bounded', async () => {
    const user = userEvent.setup()
    const detail = { ...story(), symbols: ['EQUITY:AAA', 'EQUITY:BBB', 'EQUITY:CCC', 'EQUITY:DDD'] }
    mocks.getStory.mockResolvedValue(detail)
    render(<NewsStories stories={[detail]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(await screen.findByText(/EQUITY:DDD/)).toBeTruthy()
    expect(screen.getAllByRole('button', { name: /^View [A-Z]+ chart$/ })).toHaveLength(3)
  })

  it('retains previous reading progress when an initially requested event arrives after the list loads', async () => {
    const detail = { ...story(), revision: 2, reading: { heat: 0, participants: 0, trend: 'unknown' as const, isNew: false, hasUpdate: true, bookmarked: false, locked: false, readProgress: { revision: 1, developmentIds: ['closure'] } }, developments: [...story().developments, { id: 'reopening', time: '2026-10-24T10:00:00Z', title: 'Port reopened', summary: 'Access resumed.', reportIds: [3] }] }
    mocks.getStory.mockResolvedValue(detail)
    const { rerender } = render(<NewsStories stories={[]} locale="en" initiallyOpenedId="port-closure" />)
    rerender(<NewsStories stories={[detail]} locale="en" initiallyOpenedId="port-closure" />)
    const changes = await screen.findByRole('region', { name: 'Since last read' })
    expect(within(changes).getByText('Port reopened')).toBeTruthy()
  })

  it('keeps revision-only edits separate from new facts and does not mark a newer detail revision read', async () => {
    const user = userEvent.setup()
    const detail = { ...story(), revision: 2, reading: { heat: 0, participants: 0, trend: 'unknown' as const, isNew: false, hasUpdate: true, bookmarked: false, locked: false, readProgress: { revision: 1, developmentIds: ['closure'] } } }
    mocks.getStory.mockResolvedValue({ ...detail, revision: 3 })
    render(<NewsStories stories={[detail]} locale="en" />)
    expect(screen.getByText('Content updated')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(await screen.findByText('This event changed. Refresh the list before marking this revision read.')).toBeTruthy()
    expect(screen.getByText('Content changed; no new development was added.')).toBeTruthy()
    expect(mocks.setReader).not.toHaveBeenCalled()
  })

  it('retries a related-event failure without disturbing the opened original event', async () => {
    const user = userEvent.setup()
    const related = { ...story(), id: 'recovery', title: 'Recovery' }
    mocks.getRelatedStories.mockRejectedValueOnce(new Error('offline')).mockResolvedValue([related])
    render(<NewsStories stories={[story()]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    const region = await screen.findByRole('region', { name: 'Related events' })
    expect(await within(region).findByText('Related events are unavailable.')).toBeTruthy()
    await user.click(within(region).getByRole('button', { name: 'Retry' }))
    expect(await within(region).findByRole('button', { name: 'Open related event: Recovery' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Port closure', level: 3 })).toBeTruthy()
  })

  it('ignores related results from an event that was closed before its request completed', async () => {
    const user = userEvent.setup()
    let finish!: (value: NewsStoryDetail[]) => void
    const next = { ...story(), id: 'recovery', title: 'Recovery' }
    const unrelated = { ...story(), id: 'late-result', title: 'Late result' }
    mocks.getStory.mockImplementation(async id => id === next.id ? next : story())
    mocks.getRelatedStories.mockImplementationOnce(() => new Promise(resolve => { finish = resolve })).mockResolvedValue([])
    render(<NewsStories stories={[story(), next]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    await waitFor(() => expect(finish).toBeTypeOf('function'))
    await user.click(screen.getByRole('button', { name: 'Recovery' }))
    const region = await screen.findByRole('region', { name: 'Related events' })
    expect(await within(region).findByText('No events share these stored topics or codes.')).toBeTruthy()
    await act(async () => { finish([unrelated]); await Promise.resolve() })
    expect(within(region).queryByRole('button', { name: 'Open related event: Late result' })).toBeNull()
  })

  it('keeps timeline and long analysis out of the collapsed scanning row', () => {
    const detail = { ...story(), transmission: { steps: ['Reported closure', 'Shipping'], condition: 'Only if verified.', reportIds: [2] } }
    render(<NewsStories stories={[detail]} locale="en" />)
    expect(screen.getByText('Reopening time is unknown.')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Event timeline' })).toBeNull()
    expect(screen.queryByRole('region', { name: 'Possible transmission · analysis' })).toBeNull()
    expect(screen.getByText('Unread')).toBeTruthy()
    expect(mocks.getStory).not.toHaveBeenCalled()
    expect(mocks.setReader).not.toHaveBeenCalled()
    expect(mocks.getRelatedStories).not.toHaveBeenCalled()
  })

  it('marks only a successfully loaded current revision read and keeps the pre-open new-development snapshot', async () => {
    const user = userEvent.setup()
    const detail = { ...story(), revision: 2, reading: { heat: 0, participants: 0, trend: 'unknown' as const, isNew: false, hasUpdate: true, bookmarked: false, locked: false, readProgress: { revision: 1, developmentIds: ['closure'] } }, developments: [...story().developments, { id: 'reopening', time: '2026-10-24T10:00:00Z', title: 'Port reopened', summary: 'Access resumed.', reportIds: [3] }] }
    mocks.getStory.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(detail)
    render(<NewsStories stories={[detail]} locale="en" />)
    expect(screen.getByText('1 new development')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(await screen.findByText(i18n.t('news.storyLoadError'))).toBeTruthy()
    expect(mocks.setReader).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    await waitFor(() => expect(mocks.setReader).toHaveBeenCalledWith('port-closure', { readRevision: 2 }))
    const changes = screen.getByRole('region', { name: 'Since last read' })
    expect(within(changes).getByText('Port reopened')).toBeTruthy()
    expect(within(changes).queryByText('Closure announced')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Mark unread' }))
    await waitFor(() => expect(mocks.setReader).toHaveBeenLastCalledWith('port-closure', { readRevision: null }))
    expect(screen.getByText('Unread')).toBeTruthy()
  })

  it('opens related events outside the current important filter inline and returns to the original list', async () => {
    const user = userEvent.setup()
    const initial = { ...story(), reading: { heat: 0, participants: 0, trend: 'unknown' as const, isNew: false, hasUpdate: false, bookmarked: false, locked: false, important: true } }
    const related = { ...story(), id: 'port-recovery', title: 'Port recovery', reason: 'A separate event with the same stored topic.' }
    mocks.getStory.mockImplementation(async id => id === related.id ? related : initial)
    mocks.getRelatedStories.mockResolvedValue([related])
    render(<NewsStories stories={[initial]} locale="en" importantOnly rankOffset={50} />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    const candidates = await screen.findByRole('region', { name: 'Related events' })
    expect(within(candidates).getByText('Shared topics · shipping')).toBeTruthy()
    await user.click(within(candidates).getByRole('button', { name: 'Open related event: Port recovery' }))
    expect(await screen.findByRole('heading', { name: 'Port recovery', level: 3 })).toBeTruthy()
    expect(screen.queryByLabelText('Coverage rank 51')).toBeNull()
    expect(screen.getByRole('list', { name: 'Related reading' })).toBeTruthy()
    expect(await screen.findByText(related.reason)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Back to list' }))
    expect(await screen.findByRole('heading', { name: 'Port closure', level: 3 })).toBeTruthy()
  })

  it('keeps the latest change concise and opens conditional analysis and evidence inside details', async () => {
    const detail = { ...story(), transmission: { steps: ['Reported closure', 'Shipping', 'Delivery costs'], condition: 'If the closure persists; no cost change is confirmed.', reportIds: [2] },
      reading: { heat: 0.3, participants: 0, publishers: 1, trend: 'unknown' as const, isNew: false, hasUpdate: false, bookmarked: false, locked: false } }
    mocks.getStory.mockResolvedValue(detail)
    render(<NewsStories stories={[detail]} locale="en" />)
    const row = screen.getByRole('heading', { name: detail.title, level: 3 }).closest('article')!
    expect(within(row).getByText('Reopening time is unknown.')).toBeTruthy()
    expect(within(row).queryByRole('region', { name: 'Possible transmission · analysis' })).toBeNull()
    expect(within(row).queryByText(/coverage heat/i)).toBeNull()
    const user = userEvent.setup()
    await user.click(within(row).getByRole('button', { name: 'Port closure' }))
    const path = await within(row).findByRole('region', { name: 'Possible transmission · analysis' })
    expect(within(path).getByRole('list')).toBeTruthy()
    expect(within(path).getByText(detail.transmission.condition)).toBeTruthy()
    expect(within(row).getByText('Identified publishers · 1')).toBeTruthy()
    expect(within(row).getByText('Contains an official source')).toBeTruthy()
    await user.click(within(path).getByRole('button', { name: 'Evidence · 1' }))
    expect(await screen.findByRole('link', { name: 'Independent closure report' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Official closure notice' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Original reports'))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not turn missing publisher identity or official provenance into confirmation', async () => {
    const detail = { ...story(), transmission: null, reports: story().reports.map(report => ({ ...report, role: undefined })) }
    mocks.getStory.mockResolvedValue(detail)
    render(<NewsStories stories={[detail]} locale="en" />)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(screen.getByText('No official source identified')).toBeTruthy()
    expect(screen.getByText('No supported transmission identified')).toBeTruthy()
    expect(screen.queryByText(/identified publisher/)).toBeNull()
    expect(screen.queryByRole('region', { name: 'Possible transmission · analysis' })).toBeNull()
  })

  it('shows the automatic assessment as analysis and opens only its supporting originals', async () => {
    const user = userEvent.setup()
    const detail = story()
    detail.importance = { level: 'important', reason: 'A closure can disrupt shipping; its scale is not established.', reportIds: [2] }
    mocks.getStory.mockResolvedValue(detail)
    render(<NewsStories stories={[detail]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    const assessment = await screen.findByRole('region', { name: 'Automatic importance assessment' })
    expect(within(assessment).getByText(detail.importance.reason, { exact: false })).toBeTruthy()
    await user.click(within(assessment).getByRole('button', { name: 'Evidence · 1' }))
    expect(screen.getByRole('link', { name: 'Independent closure report' })).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Official closure notice' })).toBeNull()
    await waitFor(() => expect(document.activeElement?.textContent).toBe('Original reports'))
  })
  it('marks importance independently of bookmarks and keeps focus when clearing the last important event', async () => {
    const user = userEvent.setup()
    mocks.setReader.mockImplementation(async (_id, patch) => patch)
    const changed = vi.fn()
    const event = story()
    const { rerender } = render(<NewsStories stories={[event]} locale="en" onImportantChange={changed} />)
    await user.click(screen.getByRole('button', { name: 'Mark important: Port closure' }))
    await waitFor(() => expect(changed).toHaveBeenCalledTimes(1))
    expect(mocks.setReader).toHaveBeenCalledWith('port-closure', { important: true })
    expect(screen.getByText('Important event')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Bookmark: Port closure' }).getAttribute('aria-pressed')).toBe('false')
    rerender(<NewsStories stories={[event]} locale="en" importantOnly onImportantChange={changed} />)
    await user.click(screen.getByRole('button', { name: 'Clear important: Port closure' }))
    await waitFor(() => expect(screen.queryByRole('listitem')).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Events' })))
  })
  it('shows real hot ranks, named sources and actionable topics without changing the event summary', async () => {
    const user = userEvent.setup()
    const onTopic = vi.fn()
    const event = story()
    event.reports.push({ ...event.reports[0], id: 3, source: null }, { ...event.reports[0], id: 4, source: ' PORT AUTHORITY ' })
    render(<NewsStories stories={[event]} locale="en" rankOffset={50} sourceNames={{ 'port authority': 'Port Authority' }} onTopic={onTopic} />)
    expect(screen.getByLabelText('Coverage rank 51')).toHaveProperty('textContent', '51')
    expect(screen.queryByRole('group', { name: 'Reporting sources' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    const sources = screen.getByRole('group', { name: 'Reporting sources' })
    expect(within(sources).getByText('Port Authority')).toBeTruthy()
    expect(within(sources).getByText('News desk')).toBeTruthy()
    expect(sources.childElementCount).toBe(2)
    expect(screen.getByText(story().summary)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Show topic: shipping' }))
    expect(onTopic).toHaveBeenCalledWith('shipping')
  })

  it('opens event details within its news row without a dialog', async () => {
    const user = userEvent.setup()
    render(<NewsStories stories={[story()]} locale="en" />)
    const row = screen.getByRole('heading', { name: 'Port closure', level: 3 }).closest('article')!
    await user.click(within(row).getByRole('button', { name: 'Port closure' }))
    await screen.findByText(story().reason)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(within(row).getByText(story().reason)).toBeTruthy()
    expect(within(row).getByRole('button', { name: 'Collapse details' })).toHaveProperty('ariaExpanded', 'true')
  })
  it('keeps useful focus when removing the last saved event', async () => {
    const user = userEvent.setup()
    mocks.setReader.mockResolvedValue({ bookmarked: false })
    render(<NewsStories stories={[{ ...story(), reading: { heat: 0, participants: 0, trend: 'unknown', isNew: false, hasUpdate: false, bookmarked: true, locked: false } }]} locale="en" bookmarkedOnly />)
    await user.click(screen.getByRole('button', { name: 'Remove bookmark: Port closure' }))
    expect(await screen.findByText('No bookmarks yet')).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('list', { name: 'Bookmarks' })))
  })
  it('saves a bookmark only after persistence succeeds and protects a reviewed event', async () => {
    const user = userEvent.setup()
    mocks.setReader.mockImplementation(async (_id, patch) => patch)
    render(<NewsStories stories={[{ ...story(), reading: { heat: 1, participants: 1, trend: 'unknown', isNew: true, hasUpdate: false, bookmarked: false, locked: false } }]} locale="en" />)
    expect(screen.getByText('New event')).toBeTruthy()
    expect(screen.queryByText(/Insufficient trend history/)).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Bookmark: Port closure' }))
    expect(mocks.setReader).toHaveBeenCalledWith('port-closure', { bookmarked: true })
    expect(await screen.findByRole('button', { name: 'Remove bookmark: Port closure' })).toHaveProperty('ariaPressed', 'true')
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(screen.getByText(/Insufficient trend history/)).toBeTruthy()
    const protect = await screen.findByRole('button', { name: 'Protect event from automatic changes' })
    await user.click(protect)
    expect(mocks.setReader).toHaveBeenCalledWith('port-closure', { locked: true })
    expect(await screen.findByRole('button', { name: 'Protected; allow automatic updates' })).toBeTruthy()
  })
  it('leads with an event heading and latest factual change for both initial and continuing events', () => {
    const continuing = { ...story(), id: 'port-reopening', title: 'Port recovery', developments: [
      { ...story().developments[0], reportIds: [1] },
      { id: 'reopening', time: '2026-10-24T10:00:00Z', title: 'Port reopened', summary: 'A separate later fact.', reportIds: [2] },
    ] }
    render(<NewsStories stories={[story(), continuing]} locale="en" />)
    const rows = within(screen.getByRole('list', { name: 'Events' })).getAllByRole('listitem').filter(row => !row.parentElement?.closest('[role="listitem"]'))
    expect(within(rows[0]).getByRole('heading', { name: 'Port closure', level: 3 })).toBeTruthy()
    expect(within(rows[0]).getByText('Latest development')).toBeTruthy()
    expect(within(rows[0]).getByText('Reopening time is unknown.')).toBeTruthy()
    expect(within(rows[1]).getByText('Latest development')).toBeTruthy()
    expect(within(within(rows[1]).getByRole('region', { name: 'Latest development' })).getByText('Port reopened')).toBeTruthy()
  })

  it('opens cited originals inline despite an earlier source filter', async () => {
    const user = userEvent.setup()
    render(<NewsStories stories={[story()]} locale="en" />)
    const opener = screen.getByRole('button', { name: 'Port closure' })
    await user.click(opener)
    const panel = await screen.findByRole('region', { name: 'Port closure' })
    await within(panel).findByText(story().reason)
    const originals = within(panel).getByText('Original reports · 2', { selector: 'summary' })
    await user.click(originals)
    await user.click(within(panel).getByRole('checkbox', { name: i18n.t('news.officialEvidence') }))
    expect(within(panel).queryByRole('link', { name: 'Independent closure report' })).toBeNull()
    await user.click(within(panel).getByRole('button', { name: 'Evidence · 1' }))
    expect(originals.closest('details')?.open).toBe(true)
    expect(within(panel).getByRole('link', { name: 'Independent closure report' })).toBeTruthy()
    expect((within(panel).getByRole('checkbox', { name: i18n.t('news.officialEvidence') }) as HTMLInputElement).checked).toBe(false)
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Original reports' })))
    await user.click(within(panel).getByRole('button', { name: 'All reports' }))
    expect(within(panel).getByRole('link', { name: 'Official closure notice' })).toBeTruthy()
    await waitFor(() => expect(document.activeElement).toBe(within(panel).getByRole('heading', { name: 'Original reports' })))
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('collapses details without removing the news row or losing control focus', async () => {
    const user = userEvent.setup()
    render(<NewsStories stories={[story()]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    const panel = await screen.findByRole('region', { name: 'Port closure' })
    await within(panel).findByText(story().reason)
    await user.click(screen.getByRole('button', { name: 'Collapse details' }))
    expect(screen.queryByRole('region', { name: 'Port closure' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'Port closure', level: 3 })).toBeTruthy()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Read event' }))
    expect(screen.getByRole('button', { name: 'Read event' })).toHaveProperty('ariaExpanded', 'false')
  })

  it('keeps a late detail response from replacing the event selected afterwards', async () => {
    let finishFirst!: (value: NewsStoryDetail) => void
    const next = { ...story(), id: 'port-reopening', title: 'Port recovery', reason: 'A reopening still needs separate evidence.' }
    mocks.getStory.mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve })).mockResolvedValueOnce(next)
    const user = userEvent.setup()
    render(<NewsStories stories={[story(), next]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    await user.click(screen.getByRole('button', { name: 'Port recovery' }))
    const panel = await screen.findByRole('region', { name: 'Port recovery' })
    expect(await within(panel).findByText(next.reason)).toBeTruthy()
    await act(async () => finishFirst(story()))
    expect(within(panel).getByText(next.reason)).toBeTruthy()
    expect(screen.queryByText(story().reason)).toBeNull()
  })

  it('refreshes an expanded event after its preview revision changes', async () => {
    const user = userEvent.setup()
    const { rerender } = render(<NewsStories stories={[story()]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    await screen.findByText(story().reason)
    const updated = { ...story(), revision: 2, reason: 'A new notice reports a partial reopening.' }
    mocks.getStory.mockResolvedValue(updated)
    rerender(<NewsStories stories={[updated]} locale="en" />)
    expect(await screen.findByText(updated.reason)).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Collapse details' })).toHaveProperty('ariaExpanded', 'true')
  })

  it('keeps a failed detail read in place and retries without opening a dialog', async () => {
    mocks.getStory.mockRejectedValueOnce(new Error('Read unavailable')).mockResolvedValueOnce(story())
    const user = userEvent.setup()
    render(<NewsStories stories={[story()]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    expect(await screen.findByText(i18n.t('news.storyLoadError'))).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Retry' }))
    expect(await screen.findByText(story().reason)).toBeTruthy()
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('shows when an original has no stored body', async () => {
    const value = story()
    value.reports[0].content = ''
    mocks.getStory.mockResolvedValue(value)
    const user = userEvent.setup()
    render(<NewsStories stories={[value]} locale="en" />)
    await user.click(screen.getByRole('button', { name: 'Port closure' }))
    await screen.findByText(value.reason)
    await user.click(screen.getByText('Original reports · 2', { selector: 'summary' }))
    expect(screen.getByText('The source did not provide a body.')).toBeTruthy()
  })
})
