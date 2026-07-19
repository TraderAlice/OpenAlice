import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, Hash } from 'lucide-react'
import { entitiesLive } from '../live/entities'
import { useTrackedSelection } from '../live/tracked-selection'
import { useWorkspace } from '../tabs/store'
import { SidebarSectionHeader } from './SidebarSectionHeader'
import { SidebarRowsSkeleton } from './StateViews'
import type { EntityListItem } from '../api/entities'

/**
 * Tracked sidebar — the watchlist. A flat list of entities (assets + topics),
 * newest-first, each row showing a type glyph, the kebab name, and how many
 * notes link to it. Selection lives in `useTrackedSelection` so it survives
 * remounts and is read by TrackedPage in the editor area.
 */
export function TrackedSidebar() {
  const { t } = useTranslation()
  const entities = entitiesLive.useStore((s) => s.entities)
  const loading = entitiesLive.useStore((s) => s.loading)
  const selected = useTrackedSelection((s) => s.selectedName)
  const select = useTrackedSelection((s) => s.select)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)

  // Default-select the first entity once, on first non-empty load. Latch so
  // the user's later picks are never overridden.
  const everSelectedRef = useRef(false)
  useEffect(() => {
    if (everSelectedRef.current) return
    if (entities.length === 0) return
    if (!selected) select(entities[0]!.name)
    everSelectedRef.current = true
  }, [entities, selected, select])

  useEffect(() => {
    if (!selected) return
    const selectedRow = [...document.querySelectorAll<HTMLElement>('[data-tracked-entity]')]
      .find((el) => el.dataset.trackedEntity === selected)
    selectedRow?.scrollIntoView({ block: 'center' })
  }, [selected, entities])

  if (loading && entities.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-y-auto py-1">
        <SidebarRowsSkeleton rows={6} icon />
      </div>
    )
  }

  if (entities.length === 0) {
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
        openOrFocus({ kind: 'tracked', params: {} })
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
      data-tracked-entity={entity.name}
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

function displayName(entity: EntityListItem): { prefix: string | null; rest: string } {
  if (entity.type !== 'asset') return { prefix: null, rest: entity.name }
  const dash = entity.name.indexOf('-')
  if (dash <= 0 || dash === entity.name.length - 1) return { prefix: null, rest: entity.name }
  return {
    prefix: entity.name.slice(0, dash),
    rest: entity.name.slice(dash + 1),
  }
}
