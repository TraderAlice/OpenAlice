import type { IssueListItem } from '../api/issues'

export const ISSUE_COLUMNS = ['id', 'status', 'priority', 'workspace', 'schedule', 'assignee'] as const
export type IssueColumn = typeof ISSUE_COLUMNS[number]
export interface IssueListView {
  tab: 'active' | 'backlog' | 'all'
  query: string
  statuses: string[]
  priorities: string[]
  workspace: string
  assignee: 'all' | 'session' | 'human' | 'unassigned' | 'automatic'
  schedule: 'all' | 'scheduled' | 'unscheduled'
  grouping: 'status' | 'priority' | 'workspace' | 'none'
  ordering: 'importance' | 'priority' | 'title' | 'due'
  completed: boolean
  columns: IssueColumn[]
}
export const DEFAULT_ISSUE_VIEW: IssueListView = {
  tab: 'all', query: '', statuses: [], priorities: [], workspace: '', assignee: 'all', schedule: 'all',
  grouping: 'status', ordering: 'importance', completed: true, columns: [...ISSUE_COLUMNS],
}
export function matchesIssueView(issue: IssueListItem, wsId: string, view: IssueListView): boolean {
  if (view.tab === 'active' && !['todo', 'in_progress'].includes(issue.status)) return false
  if (view.tab === 'backlog' && issue.status !== 'backlog') return false
  if (!view.completed && ['done', 'canceled'].includes(issue.status)) return false
  if (view.query && !`${issue.id} ${issue.title}`.toLocaleLowerCase().includes(view.query.trim().toLocaleLowerCase())) return false
  if (view.statuses.length && !view.statuses.includes(issue.status)) return false
  if (view.priorities.length && !view.priorities.includes(issue.priority)) return false
  if (view.workspace && view.workspace !== wsId) return false
  if (view.schedule === 'scheduled' && !issue.when || view.schedule === 'unscheduled' && issue.when) return false
  if (view.assignee === 'session' && !issue.assignee.startsWith('@resume-')) return false
  if (view.assignee === 'human' && issue.assignee !== '@human') return false
  if (view.assignee === 'unassigned' && issue.assignee !== '@unassigned') return false
  if (view.assignee === 'automatic' && !['@new-each-run', '@new-then-resume'].includes(issue.assignee)) return false
  return true
}

/** Saved display preferences are local UI state, never an Issue mutation. */
export function readIssueView(): IssueListView {
  try {
    const saved = JSON.parse(localStorage.getItem('openalice-issue-list-view') || '{}')
    const next = { ...DEFAULT_ISSUE_VIEW }
    for (const [key, values] of Object.entries({ tab: ['active', 'backlog', 'all'], grouping: ['status', 'priority', 'workspace', 'none'], ordering: ['importance', 'priority', 'title', 'due'] })) {
      if (values.includes(saved[key])) Object.assign(next, { [key]: saved[key] })
    }
    if (typeof saved.completed === 'boolean') next.completed = saved.completed
    if (Array.isArray(saved.columns)) next.columns = ISSUE_COLUMNS.filter((column) => saved.columns.includes(column))
    return next
  } catch { return { ...DEFAULT_ISSUE_VIEW } }
}
