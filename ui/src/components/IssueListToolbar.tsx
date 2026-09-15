import { Filter, SlidersHorizontal, List, ChevronDown, Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Switch } from './ui/switch'
import { Button } from './ui/button'
import { Popover, PopoverTrigger, PopoverContent } from './ui/popover'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from './ui/dropdown-menu'
import { SelectionCheckIcon } from './ui/selection-check-icon'
import { ISSUE_COLUMNS, DEFAULT_ISSUE_VIEW, type IssueListView } from './issue-list-view'

function Choice({ label, value, choices, onChange }: { label: string; value: string; choices: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <div className="flex items-center justify-between gap-4">
    <span className="text-sm text-muted-foreground">{label}</span>
    <DropdownMenu>
      <DropdownMenuTrigger aria-label={label} className="flex h-8 max-w-48 items-center gap-2 rounded-md border border-border px-2.5 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="truncate">{choices.find((item) => item.value === value)?.label || value}</span><ChevronDown size={13} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>{choices.map((item) => <DropdownMenuItem key={item.value} onClick={() => onChange(item.value)}>
        <span className="flex-1">{item.label}</span>{value === item.value && <SelectionCheckIcon />}
      </DropdownMenuItem>)}</DropdownMenuContent>
    </DropdownMenu>
  </div>
}

export function IssueListToolbar({ view, onChange, workspaces, visible, total }: {
  view: IssueListView; onChange: (patch: Partial<IssueListView>) => void
  workspaces: { id: string; label: string }[]; visible: number; total: number
}) {
  const { t } = useTranslation()
  const label = (key: string) => t(`issues.view.${key}` as 'issues.view.all')
  const choices = (values: string[]) => values.map((value) => ({ value, label: label(value === 'all' ? 'anyValue' : value) }))
  const count = view.statuses.length + view.priorities.length + Number(Boolean(view.workspace)) + Number(view.assignee !== 'all') + Number(view.schedule !== 'all') + Number(Boolean(view.query))
  const clear = () => onChange({ query: '', statuses: [], priorities: [], workspace: '', assignee: 'all', schedule: 'all' })
  return <div className="sticky top-0 z-20 bg-background pb-2 pt-1">
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-2 px-2">
      <div role="group" aria-label={label('views')} className="flex gap-1.5">
        {(['active', 'backlog', 'all'] as const).map((tab) => <Button key={tab} variant="outline" size="sm" aria-pressed={view.tab === tab} onClick={() => onChange({ tab })} className={`rounded-full px-3 font-medium ${view.tab === tab ? 'bg-muted border-transparent' : 'bg-background'}`}>{label(tab)}</Button>)}
      </div>
      <div className="flex items-center gap-1.5">
        <Popover><PopoverTrigger aria-label={label('filter')} title={label('filter')} className={`flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${count ? 'bg-muted' : ''}`}><Filter size={15} /></PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto space-y-4 p-4">
            <div className="flex items-center justify-between"><h3 className="text-sm font-medium">{label('filter')}</h3>{count > 0 && <Button variant="ghost" size="sm" onClick={clear}>{label('clear')}</Button>}</div>
            <label className="flex h-9 items-center gap-2 rounded-md border border-input px-2"><Search size={14} className="text-muted-foreground" /><input aria-label={label('search')} placeholder={label('search')} value={view.query} onChange={(event) => onChange({ query: event.target.value })} className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
            {(['statuses', 'priorities'] as const).map((field) => <fieldset key={field}><legend className="mb-2 text-xs text-muted-foreground">{label(field)}</legend><div className="flex flex-wrap gap-1.5">
              {(field === 'statuses' ? ['backlog', 'todo', 'in_progress', 'done', 'canceled'] : ['none', 'urgent', 'high', 'medium', 'low']).map((value) => <Button key={value} variant="outline" size="sm" aria-pressed={view[field].includes(value)} className={`rounded-full text-xs ${view[field].includes(value) ? 'bg-muted border-foreground/30' : ''}`} onClick={() => onChange({ [field]: view[field].includes(value) ? view[field].filter((item) => item !== value) : [...view[field], value] })}>{field === 'priorities' && value === 'none' ? t('issues.priority.label', { priority: t('issues.priority.none') }) : t(`issues.${field === 'statuses' ? 'status' : 'priority'}.${value}` as 'issues.status.todo')}</Button>)}
            </div></fieldset>)}
            <Choice label={label('workspace')} value={view.workspace} choices={[{ value: '', label: label('any') }, ...workspaces.map((ws) => ({ value: ws.id, label: ws.label }))]} onChange={(workspace) => onChange({ workspace })} />
            <Choice label={label('assignee')} value={view.assignee} choices={choices(['all', 'session', 'human', 'unassigned', 'automatic'])} onChange={(assignee) => onChange({ assignee: assignee as IssueListView['assignee'] })} />
            <Choice label={label('schedule')} value={view.schedule} choices={choices(['all', 'scheduled', 'unscheduled'])} onChange={(schedule) => onChange({ schedule: schedule as IssueListView['schedule'] })} />
          </PopoverContent>
        </Popover>
        <Popover><PopoverTrigger aria-label={label('display')} title={label('display')} className="flex size-8 items-center justify-center rounded-full border border-border hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"><SlidersHorizontal size={15} /></PopoverTrigger>
          <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] max-h-[calc(100dvh-6rem)] overflow-y-auto p-0">
            <div className="space-y-4 p-4">
              <h3 className="flex items-center gap-2 text-sm font-medium"><List size={16} />{label('list')}</h3>
              <Choice label={label('grouping')} value={view.grouping} choices={choices(['status', 'priority', 'workspace', 'none'])} onChange={(grouping) => onChange({ grouping: grouping as IssueListView['grouping'] })} />
              <Choice label={label('ordering')} value={view.ordering} choices={choices(['importance', 'priority', 'title', 'due'])} onChange={(ordering) => onChange({ ordering: ordering as IssueListView['ordering'] })} />
              <label className="flex items-center justify-between gap-3 text-sm">{label('completed')}<Switch size="sm" aria-label={label('completed')} checked={view.completed} onCheckedChange={(completed) => onChange({ completed })} /></label>
            </div>
            <div className="border-t border-border p-4"><p className="mb-3 text-sm text-muted-foreground">{label('columns')}</p><div className="flex flex-wrap gap-1.5">{ISSUE_COLUMNS.map((column) => <Button key={column} variant="outline" size="sm" aria-pressed={view.columns.includes(column)} className={`rounded-full ${view.columns.includes(column) ? 'bg-muted border-transparent' : ''}`} onClick={() => onChange({ columns: view.columns.includes(column) ? view.columns.filter((item) => item !== column) : [...view.columns, column] })}>{label(column)}</Button>)}</div>
              <Button variant="ghost" size="sm" className="mt-3" onClick={() => onChange({ grouping: DEFAULT_ISSUE_VIEW.grouping, ordering: DEFAULT_ISSUE_VIEW.ordering, completed: true, columns: [...ISSUE_COLUMNS] })}>{label('reset')}</Button>
            </div>
          </PopoverContent>
        </Popover>
      </div>
    </div>
    {(count > 0 || visible !== total) && <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground"><span>{t('issues.view.results', { count: visible, total })}</span>{count > 0 && <Button variant="ghost" size="sm" onClick={clear} className="h-6 text-xs"><X size={12} />{label('clear')}</Button>}</div>}
  </div>
}
