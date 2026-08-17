import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, Hash, CircleAlert, ListChecks } from 'lucide-react'
import { entitiesLive } from '../live/entities'
import { useTrackedSelection } from '../live/tracked-selection'
import { useWorkspace } from '../tabs/store'
import { useIssues } from '../hooks/useIssues'
import { trackedIssueAnchors, type TrackedIssueAnchor } from '../lib/tracked-issues'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { SidebarRowsSkeleton } from './StateViews'
import type { EntityListItem } from '../api/entities'
import type { ViewSpec } from '../tabs/types'

/**
 * Tracked sidebar — the watchlist. Global assets/topics and Workspace-owned
 * Issues share one grouped navigator without duplicating Issues into the
 * EntityStore. Selection lives in `useTrackedSelection` so it survives
 * remounts and is read by TrackedPage in the editor area.
 */
export function TrackedSidebar({
  routeSelection = {},
  onNavigate,
}: {
  routeSelection?: Extract<ViewSpec, { kind: 'tracked' }>['params']
  onNavigate?: () => void
}) {
  const { t } = useTranslation()
  const entities = entitiesLive.useStore((s) => s.entities)
  const loading = entitiesLive.useStore((s) => s.loading)
  const listError = entitiesLive.useStore((s) => s.error)
  const { data: issueSnapshot, error: issueError, loading: issuesLoading } = useIssues()
  const issues = trackedIssueAnchors(issueSnapshot)
  const selected = useTrackedSelection((s) => s.selectedName)
  const selectedIssue = useTrackedSelection((s) => s.selectedIssue)
  const select = useTrackedSelection((s) => s.select)
  const selectIssue = useTrackedSelection((s) => s.selectIssue)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)

  // Default-select the first entity once, on first non-empty load. Latch so
  // the user's later picks are never overridden.
  const everSelectedRef = useRef(false)
  useEffect(() => {
    if (routeSelection.entity) {
      if (selected !== routeSelection.entity) select(routeSelection.entity)
      everSelectedRef.current = true
      return
    }
    if (routeSelection.workspace && routeSelection.issue) {
      if (
        selectedIssue?.workspaceId !== routeSelection.workspace
        || selectedIssue.issueId !== routeSelection.issue
      ) {
        selectIssue({ workspaceId: routeSelection.workspace, issueId: routeSelection.issue })
      }
      everSelectedRef.current = true
      return
    }
    if (everSelectedRef.current) return
    if (selected || selectedIssue) {
      everSelectedRef.current = true
      return
    }
    if (entities[0]) {
      select(entities[0].name)
      openOrFocus({ kind: 'tracked', params: { entity: entities[0].name } })
    } else if (issues[0]) {
      selectIssue({ workspaceId: issues[0].workspaceId, issueId: issues[0].issue.id })
      openOrFocus({
        kind: 'tracked',
        params: { workspace: issues[0].workspaceId, issue: issues[0].issue.id },
      })
    }
    else return
    everSelectedRef.current = true
  }, [entities, issues, openOrFocus, routeSelection, selected, selectedIssue, select, selectIssue])

  useEffect(() => {
    const selectedKey = selected
      ? `entity:${selected}`
      : selectedIssue ? `issue:${selectedIssue.workspaceId}:${selectedIssue.issueId}` : null
    if (!selectedKey) return
    const selectedRow = [...document.querySelectorAll<HTMLElement>('[data-tracked-entity]')]
      .find((el) => el.dataset.trackedEntity === selectedKey)
    selectedRow?.scrollIntoView({ block: 'center' })
  }, [selected, selectedIssue, entities, issues])

  const hasRows = entities.length > 0 || issues.length > 0

  if (!hasRows && (loading || issuesLoading)) {
    return (
      <div className="flex flex-col h-full overflow-y-auto py-1">
        <SidebarRowsSkeleton rows={6} icon />
      </div>
    )
  }

  if (!hasRows && (listError || issueError)) {
    return (
      <div className="flex items-start gap-2 px-3 py-4 text-[12px] leading-relaxed text-muted-foreground">
        <CircleAlert size={14} className="mt-0.5 shrink-0 text-destructive" aria-hidden />
        <span>{t('tracked.listLoadErrorTitle')}</span>
      </div>
    )
  }

  if (!hasRows) {
    return (
      <div className="px-3 py-4 text-[12px] text-muted-foreground/70 leading-relaxed">
        {t('tracked.nothingTrackedYet')}
        <div className="mt-1 text-muted-foreground/50">
          Agents register assets &amp; topics with the{' '}
          <code className="text-[11px]">entity_upsert</code> tool, then link to them with{' '}
          <code className="text-[11px]">[[name]]</code> in their notes.
        </div>
      </div>
    )
  }

  const renderRow = (entity: EntityListItem) => (
    <TrackedEntityRow
      key={entity.name}
      entity={entity}
      active={entity.name === selected}
      onClick={() => {
        select(entity.name)
        setSidebar('tracked')
        openOrFocus({ kind: 'tracked', params: { entity: entity.name } })
        onNavigate?.()
      }}
    />
  )

  const renderIssueRow = (anchor: TrackedIssueAnchor) => (
    <TrackedIssueRow
      key={`${anchor.workspaceId}:${anchor.issue.id}`}
      anchor={anchor}
      active={selectedIssue?.workspaceId === anchor.workspaceId && selectedIssue.issueId === anchor.issue.id}
      onClick={() => {
        selectIssue({ workspaceId: anchor.workspaceId, issueId: anchor.issue.id })
        setSidebar('tracked')
        openOrFocus({
          kind: 'tracked',
          params: { workspace: anchor.workspaceId, issue: anchor.issue.id },
        })
        onNavigate?.()
      }}
    />
  )

  // Partition into Assets / Topics so the watchlist reads as a grouped
  // navigator, not one undifferentiated run (newest-first within each).
  const assets = entities.filter((e) => e.type === 'asset')
  const topics = entities.filter((e) => e.type !== 'asset')

  return (
    <div className="flex flex-col h-full overflow-y-auto py-2">
      {assets.length > 0 && (
        <div className="mb-2">
          <SidebarSectionHeader trailing={<SectionCount count={assets.length} />}>
            {t('tracked.assets')}
          </SidebarSectionHeader>
          <div className="px-2">
            {assets.map(renderRow)}
          </div>
        </div>
      )}
      {topics.length > 0 && (
        <div className="mb-2">
          <SidebarSectionHeader trailing={<SectionCount count={topics.length} />}>
            {t('tracked.topics')}
          </SidebarSectionHeader>
          <div className="px-2">
            {topics.map(renderRow)}
          </div>
        </div>
      )}
      {issues.length > 0 && (
        <div className="mb-2">
          <SidebarSectionHeader trailing={<SectionCount count={issues.length} />}>
            {t('tracked.issues')}
          </SidebarSectionHeader>
          <div className="px-2">
            {issues.map(renderIssueRow)}
          </div>
        </div>
      )}
    </div>
  )
}

function SectionCount({ count }: { count: number }) {
  return (
    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-muted-foreground/65">
      {count}
    </span>
  )
}

function TrackedEntityRow({
  entity,
  active,
  onClick,
}: {
  entity: EntityListItem
  active: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  const Icon = entity.type === 'asset' ? TrendingUp : Hash
  const display = displayName(entity)
  return (
    <div
      role="button"
      tabIndex={0}
      data-tracked-entity={`entity:${entity.name}`}
      onClick={onClick}
      title={entity.description}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onClick()
        }
      }}
      className={`group relative mb-0.5 grid min-h-[38px] grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-1.5 outline-none transition-colors ${
        active
          ? 'bg-primary-muted text-foreground shadow-[inset_2px_0_0_var(--primary)]'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent'
      }`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
          active ? 'bg-background/60 text-primary' : 'bg-muted/55 text-muted-foreground/70 group-hover:text-muted-foreground'
        }`}
        aria-hidden
      >
        <Icon size={13} strokeWidth={1.8} />
      </span>

      <span className="min-w-0">
        {display.prefix ? (
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/55">
              {display.prefix}
            </span>
            <span className={`truncate text-[12.5px] ${active ? 'font-semibold text-foreground' : 'font-medium'}`}>
              {display.rest}
            </span>
          </span>
        ) : (
          <span className={`block truncate text-[12.5px] ${active ? 'font-semibold text-foreground' : 'font-medium'}`}>
            {display.rest}
          </span>
        )}
      </span>

      {entity.backlinkCount > 0 && (
        <span
          className={`min-w-[20px] rounded-full px-1.5 py-0.5 text-center text-[10px] font-medium tabular-nums ${
            active ? 'bg-background/75 text-muted-foreground' : 'bg-muted/70 text-muted-foreground/65'
          }`}
          title={t('tracked.backlinksTooltip', { count: entity.backlinkCount })}
        >
          {entity.backlinkCount}
        </span>
      )}
    </div>
  )
}

function TrackedIssueRow({
  anchor,
  active,
  onClick,
}: {
  anchor: TrackedIssueAnchor
  active: boolean
  onClick: () => void
}) {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      data-tracked-entity={`issue:${anchor.workspaceId}:${anchor.issue.id}`}
      onClick={onClick}
      title={`${anchor.issue.title} · ${anchor.workspaceTag}`}
      className={`group relative mb-0.5 grid min-h-[38px] w-full grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-2.5 py-1.5 text-left outline-none transition-colors ${
        active
          ? 'bg-primary-muted text-foreground shadow-[inset_2px_0_0_var(--primary)]'
          : 'text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:bg-accent'
      }`}
    >
      <span
        className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
          active ? 'bg-background/60 text-primary' : 'bg-muted/55 text-muted-foreground/70 group-hover:text-muted-foreground'
        }`}
        aria-hidden
      >
        <ListChecks size={13} strokeWidth={1.8} />
      </span>
      <span className="flex min-w-0 items-baseline gap-1.5">
        <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/55">
          {anchor.workspaceTag}
        </span>
        <span className={`truncate text-[12.5px] ${active ? 'font-semibold text-foreground' : 'font-medium'}`}>
          {anchor.issue.title}
        </span>
      </span>
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-current opacity-45" title={t(`issues.status.${anchor.issue.status}`)} />
    </button>
  )
}

function displayName(entity: EntityListItem): { prefix: string | null; rest: string } {
  if (entity.type !== 'asset') return { prefix: null, rest: entity.name }
  const dash = entity.name.indexOf('-')
  if (dash <= 0 || dash === entity.name.length - 1) return { prefix: null, rest: entity.name }
  return {
    prefix: entity.name.slice(0, dash),
    rest: entity.name.slice(dash + 1),
  }
}
