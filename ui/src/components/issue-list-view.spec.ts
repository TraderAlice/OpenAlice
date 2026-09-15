// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import type { IssueListItem } from '../api/issues'
import { DEFAULT_ISSUE_VIEW, matchesIssueView, readIssueView } from './issue-list-view'

const issue: IssueListItem = { id: 'daily', title: 'Daily scan', status: 'todo', priority: 'high', assignee: '@resume-session', when: { kind: 'cron', cron: '0 9 * * *' } }
afterEach(() => localStorage.removeItem('openalice-issue-list-view'))
describe('issue view selection', () => {
  it('intersects filters while allowing multiple status and priority values', () => {
    const view = { ...DEFAULT_ISSUE_VIEW, statuses: ['todo', 'done'], priorities: ['high', 'urgent'], workspace: 'desk', assignee: 'session' as const, schedule: 'scheduled' as const }
    expect(matchesIssueView(issue, 'desk', view)).toBe(true)
    expect(matchesIssueView(issue, 'other', view)).toBe(false)
    expect(matchesIssueView({ ...issue, assignee: '@human' }, 'desk', view)).toBe(false)
    expect(matchesIssueView({ ...issue, when: undefined }, 'desk', view)).toBe(false)
    expect(matchesIssueView({ ...issue, priority: 'low' }, 'desk', view)).toBe(false)
  })
  it('keeps automatic policies separate from unassigned and human work', () => {
    for (const assignee of ['@new-each-run', '@new-then-resume']) {
      expect(matchesIssueView({ ...issue, assignee }, 'desk', { ...DEFAULT_ISSUE_VIEW, assignee: 'automatic' })).toBe(true)
      expect(matchesIssueView({ ...issue, assignee }, 'desk', { ...DEFAULT_ISSUE_VIEW, assignee: 'unassigned' })).toBe(false)
    }
  })
  it('recovers malformed preferences and ignores invalid enum values', () => {
    localStorage.setItem('openalice-issue-list-view', '{broken')
    expect(readIssueView()).toEqual(DEFAULT_ISSUE_VIEW)
    localStorage.setItem('openalice-issue-list-view', JSON.stringify({ grouping: 'invalid', ordering: 'due', columns: ['id', 'unknown'], query: 'stale filter' }))
    expect(readIssueView()).toMatchObject({ grouping: 'status', ordering: 'due', columns: ['id'], query: '' })
  })
})
