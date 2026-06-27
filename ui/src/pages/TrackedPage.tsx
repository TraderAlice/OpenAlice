import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, Hash, FileText, ListChecks } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageLoading } from '../components/StateViews'
import { api } from '../api'
import { entitiesLive } from '../live/entities'
import { useTrackedSelection } from '../live/tracked-selection'
import { useWorkspace } from '../tabs/store'
import type { EntityDetail, Backlink } from '../api/entities'

/**
 * Tracked detail pane. Shows the selected entity's description (the
 * disambiguation) plus its backlinks — the notes that reference it via
 * `[[name]]`. That backlink list IS the "this thing across all my files"
 * view the user wanted; clicking a note opens its workspace.
 *
 * Selection is owned by `useTrackedSelection` (the sidebar drives it). The
 * list + counts come from the polling store; per-entity backlinks are
 * fetched on selection.
 */
export function TrackedPage() {
  const { t } = useTranslation()
  const entities = entitiesLive.useStore((s) => s.entities)
  const loading = entitiesLive.useStore((s) => s.loading)
  const selectedName = useTrackedSelection((s) => s.selectedName)

  const [detail, setDetail] = useState<EntityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  useEffect(() => {
    if (!selectedName) {
      setDetail(null)
      setDetailLoading(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailLoading(true)
    api.entities
      .get(selectedName)
      .then((d) => {
        if (!cancelled) { setDetail(d); setDetailLoading(false) }
      })
      .catch(() => {
        if (!cancelled) { setDetail(null); setDetailLoading(false) }
      })
    return () => {
      cancelled = true
    }
  }, [selectedName])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('nav.item.tracked')}
        description={t('tracked.pageDescription', { count: entities.length })}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        {loading && entities.length === 0 ? (
          <PageLoading />
        ) : entities.length === 0 ? (
          <EmptyState />
        ) : !selectedName ? (
          <div className="px-6 py-8 text-text-muted text-sm">{t('tracked.selectFromSidebar')}</div>
        ) : detailLoading || !detail ? (
          <PageLoading />
        ) : (
          <Detail detail={detail} />
        )}
      </div>
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-16 text-center max-w-[520px] mx-auto">
      <div className="text-[15px] text-text mb-2">{t('tracked.nothingTrackedYet')}</div>
      <p className="text-[13px] text-text-muted leading-relaxed">
        As an agent works, it registers the assets and topics worth following with the
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-tertiary text-[11px]">entity_upsert</code>
        tool, and links to them from its notes with
        <code className="mx-1 px-1 py-0.5 rounded bg-bg-tertiary text-[11px]">[[name]]</code>. They
        show up here as a running watchlist — each with the notes that reference it.
      </p>
    </div>
  )
}

function Detail({ detail }: { detail: EntityDetail }) {
  const { t } = useTranslation()
  const { entity, backlinks } = detail
  const Icon = entity.type === 'asset' ? TrendingUp : Hash
  return (
    <div className="max-w-[820px] mx-auto py-6 px-4 md:px-8">
      <div className="flex items-center gap-2.5 mb-2">
        <Icon size={20} strokeWidth={1.75} className="shrink-0 text-text-muted" aria-hidden />
        <h2 className="text-[20px] font-semibold font-mono text-text">{entity.name}</h2>
        <span className="text-[11px] px-1.5 py-0.5 rounded bg-bg-tertiary text-text-muted uppercase tracking-wide">
          {entity.type}
        </span>
      </div>
      <p className="text-[14px] text-text-muted leading-relaxed mb-6">{entity.description}</p>

      <div className="text-[11px] font-medium text-text-muted/60 uppercase tracking-wider mb-3">
        {t('tracked.referencedIn', { count: backlinks.length })}
      </div>
      {backlinks.length === 0 ? (
        <div className="text-[13px] text-text-muted/70 italic">
          No notes link <span className="font-mono">[[{entity.name}]]</span> yet.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {backlinks.map((b, i) => (
            <BacklinkRow key={`${b.workspaceId}:${b.path}:${i}`} backlink={b} />
          ))}
        </div>
      )}
    </div>
  )
}

// Issue notes live at `.alice/issues/<id>.md` (the only dot-dir the backlink
// scanner descends into). Such a backlink should open the issue's board detail,
// not a raw file — detect by this prefix and pull the `<id>` out of the path.
const ISSUE_NOTE_PREFIX = '.alice/issues/'

/** If `path` is an issue note (`.alice/issues/<id>.md`), return its issue id;
 *  otherwise null. Tolerates Windows back-slashes from a relative() path. */
function issueIdFromPath(path: string): string | null {
  const norm = path.replace(/\\/g, '/')
  if (!norm.startsWith(ISSUE_NOTE_PREFIX) || !norm.endsWith('.md')) return null
  const id = norm.slice(ISSUE_NOTE_PREFIX.length, -'.md'.length)
  // Guard against a nested path under issues/ (ids are flat slugs).
  return id && !id.includes('/') ? id : null
}

function BacklinkRow({ backlink }: { backlink: Backlink }) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const issueId = issueIdFromPath(backlink.path)
  const open = () => {
    if (issueId) {
      // Issue note → its wsId-precise board detail, not a raw file.
      openOrFocus({
        kind: 'issue-detail',
        params: { wsId: backlink.workspaceId, id: issueId },
      })
      return
    }
    // Plain note → the dedicated file viewer (VS Code-style), at its exact path.
    openOrFocus({
      kind: 'file-viewer',
      params: { wsId: backlink.workspaceId, path: backlink.path },
    })
  }
  const Icon = issueId ? ListChecks : FileText
  const label = issueId ?? backlink.path
  return (
    <button
      type="button"
      onClick={open}
      title={issueId ? `Open issue ${issueId}` : `Open ${backlink.path}`}
      className="group flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-bg-tertiary/30 hover:bg-bg-tertiary hover:border-accent/40 transition-colors text-left"
    >
      <Icon
        size={14}
        strokeWidth={1.75}
        className="shrink-0 text-text-muted/70 group-hover:text-accent transition-colors"
        aria-hidden
      />
      <span className="flex-1 min-w-0 truncate font-mono text-[12px] text-text">{label}</span>
      <span className="shrink-0 text-[11px] text-text-muted/60">{backlink.workspaceTag}</span>
    </button>
  )
}
