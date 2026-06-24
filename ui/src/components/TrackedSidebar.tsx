import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, Hash } from 'lucide-react'
import { entitiesLive } from '../live/entities'
import { useTrackedSelection } from '../live/tracked-selection'
import { SidebarRow } from './SidebarRow'
import { SidebarSectionHeader } from './SidebarSectionHeader'

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

  // Default-select the first entity once, on first non-empty load. Latch so
  // the user's later picks are never overridden.
  const everSelectedRef = useRef(false)
  useEffect(() => {
    if (everSelectedRef.current) return
    if (entities.length === 0) return
    if (!selected) select(entities[0]!.name)
    everSelectedRef.current = true
  }, [entities, selected, select])

  if (loading && entities.length === 0) {
    return <div className="px-3 py-3 text-[12px] text-text-muted">{t('common.loading')}</div>
  }

  if (entities.length === 0) {
    return (
      <div className="px-3 py-4 text-[12px] text-text-muted/70 leading-relaxed">
        {t('tracked.nothingTrackedYet')}
        <div className="mt-1 text-text-muted/50">
          Agents register assets &amp; topics with the{' '}
          <code className="text-[11px]">entity_upsert</code> tool, then link to them with{' '}
          <code className="text-[11px]">[[name]]</code> in their notes.
        </div>
      </div>
    )
  }

  const renderRow = (e: (typeof entities)[number]) => {
    const Icon = e.type === 'asset' ? TrendingUp : Hash
    return (
      <SidebarRow
        key={e.name}
        active={e.name === selected}
        onClick={() => select(e.name)}
        title={e.description}
        icon={<Icon size={13} strokeWidth={1.75} className="text-text-muted/70" aria-hidden />}
        label={<span className="font-mono text-[12px]">{e.name}</span>}
        trail={
          e.backlinkCount > 0 ? (
            <span
              className="text-[10px] text-text-muted/60 tabular-nums"
              title={t('tracked.backlinksTooltip', { count: e.backlinkCount })}
            >
              {e.backlinkCount}
            </span>
          ) : undefined
        }
      />
    )
  }

  // Partition into Assets / Topics so the watchlist reads as a grouped
  // navigator, not one undifferentiated run (newest-first within each).
  const assets = entities.filter((e) => e.type === 'asset')
  const topics = entities.filter((e) => e.type !== 'asset')

  return (
    <div className="flex flex-col h-full overflow-y-auto py-1">
      {assets.length > 0 && (
        <>
          <SidebarSectionHeader>{t('tracked.assets')}</SidebarSectionHeader>
          {assets.map(renderRow)}
        </>
      )}
      {topics.length > 0 && (
        <>
          <SidebarSectionHeader>{t('tracked.topics')}</SidebarSectionHeader>
          {topics.map(renderRow)}
        </>
      )}
    </div>
  )
}
