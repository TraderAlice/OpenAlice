import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { TrendingUp, Hash, FileText, ListChecks, CircleAlert } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, Skeleton } from '../components/StateViews'
import { api } from '../api'
import { entitiesLive, refreshEntities } from '../live/entities'
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
  const listError = entitiesLive.useStore((s) => s.error)
  const refreshing = entitiesLive.useStore((s) => s.refreshing)
  const selectedName = useTrackedSelection((s) => s.selectedName)

  const [detail, setDetail] = useState<EntityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [detailRequest, setDetailRequest] = useState(0)
  useEffect(() => {
    if (!selectedName) {
      setDetail(null)
      setDetailLoading(false)
      setDetailError(false)
      return
    }
    let cancelled = false
    setDetail(null)
    setDetailLoading(true)
    setDetailError(false)
    api.entities
      .get(selectedName)
      .then((d) => {
        if (!cancelled) {
          setDetail(d)
          setDetailLoading(false)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setDetail(null)
          setDetailLoading(false)
          setDetailError(true)
        }
      })
    return () => {
      cancelled = true
    }
  }, [selectedName, detailRequest])

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('nav.item.tracked')}
        description={t('tracked.pageDescription', { count: entities.length })}
      />
      <div className="flex-1 overflow-y-auto min-h-0">
        {listError && entities.length > 0 && (
          <StaleCollectionNotice refreshing={refreshing} onRetry={refreshEntities} />
        )}
        {loading && entities.length === 0 ? (
          <TrackedListSkeleton />
        ) : listError && entities.length === 0 ? (
          <CollectionLoadError refreshing={refreshing} onRetry={refreshEntities} />
        ) : entities.length === 0 ? (
          <EmptyState />
        ) : !selectedName ? (
          <div className="px-6 py-8 text-muted-foreground text-sm">{t('tracked.selectFromSidebar')}</div>
        ) : detailLoading ? (
          <PageLoading />
        ) : detailError || !detail ? (
          <DetailLoadError
            name={selectedName}
            onRetry={() => setDetailRequest((request) => request + 1)}
          />
        ) : (
          <Detail detail={detail} />
        )}
      </div>
    </div>
  )
}

function CollectionLoadError({
  refreshing,
  onRetry,
}: {
  refreshing: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center"
    >
      <CircleAlert size={24} strokeWidth={1.75} className="text-destructive" aria-hidden />
      <h2 className="mt-3 text-[15px] font-medium text-foreground">
        {t('tracked.listLoadErrorTitle')}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {t('tracked.listLoadErrorDescription')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        disabled={refreshing}
        className="oa-pressable mt-4 rounded-md border border-border bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted disabled:cursor-wait disabled:opacity-60"
      >
        {refreshing ? t('common.loading') : t('common.retry')}
      </button>
    </div>
  )
}

function StaleCollectionNotice({
  refreshing,
  onRetry,
}: {
  refreshing: boolean
  onRetry: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      className="mx-4 mt-4 flex items-center gap-2 rounded-md border border-warning/25 bg-warning/[0.06] px-3 py-2 text-[12px] text-muted-foreground md:mx-8"
    >
      <CircleAlert size={14} className="shrink-0 text-warning" aria-hidden />
      <span className="min-w-0 flex-1">{t('tracked.listStale')}</span>
      <button
        type="button"
        onClick={onRetry}
        disabled={refreshing}
        className="oa-pressable shrink-0 rounded px-2 py-1 font-medium text-foreground hover:bg-warning/10 disabled:cursor-wait disabled:opacity-60"
      >
        {refreshing ? t('common.loading') : t('common.retry')}
      </button>
    </div>
  )
}

function DetailLoadError({ name, onRetry }: { name: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center"
    >
      <CircleAlert size={24} strokeWidth={1.75} className="text-destructive" aria-hidden />
      <h2 className="mt-3 text-[15px] font-medium text-foreground">
        {t('tracked.detailLoadErrorTitle', { name })}
      </h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">
        {t('tracked.detailLoadErrorDescription')}
      </p>
      <button
        type="button"
        onClick={onRetry}
        className="oa-pressable mt-4 rounded-md border border-border bg-secondary px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
      >
        {t('common.retry')}
      </button>
    </div>
  )
}

// First-load placeholder for the tracked-entity list (icon + name + count tag),
// mirroring the BacklinkRow chrome so the swap to real rows is seamless.
function TrackedListSkeleton() {
  const widths = ['w-24', 'w-32', 'w-28', 'w-36', 'w-20', 'w-28']
  return (
    <div className="flex flex-col gap-1 max-w-[820px] mx-auto py-6 px-4 md:px-8" aria-hidden="true">
      {widths.map((w, i) => (
        <div
          key={i}
          className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-border bg-muted/30"
        >
          <Skeleton className="h-3.5 w-3.5 rounded shrink-0" />
          <Skeleton className={`h-3.5 ${w} rounded`} />
          <div className="flex-1" />
          <Skeleton className="h-3 w-10 rounded shrink-0" />
        </div>
      ))}
    </div>
  )
}

function EmptyState() {
  const { t } = useTranslation()
  return (
    <div className="px-6 py-16 text-center max-w-[520px] mx-auto">
      <div className="text-[15px] text-foreground mb-2">{t('tracked.nothingTrackedYet')}</div>
      <p className="text-[13px] text-muted-foreground leading-relaxed">
        As an agent works, it registers the assets and topics worth following with the
        <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">entity_upsert</code>
        tool, and links to them from its notes with
        <code className="mx-1 px-1 py-0.5 rounded bg-muted text-[11px]">[[name]]</code>. They
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
      <div className="mb-2 flex items-start gap-2.5 sm:items-center">
        <Icon size={20} strokeWidth={1.75} className="shrink-0 text-muted-foreground" aria-hidden />
        <h2 className="min-w-0 break-words font-mono text-[18px] font-semibold leading-snug text-foreground sm:text-[20px]">
          {entity.name}
        </h2>
        <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] uppercase tracking-wide text-muted-foreground">
          {entity.type}
        </span>
      </div>
      <p className="text-[14px] text-muted-foreground leading-relaxed mb-6">{entity.description}</p>

      <div className="text-[11px] font-medium text-muted-foreground/60 uppercase tracking-wider mb-3">
        {t('tracked.referencedIn', { count: backlinks.length })}
      </div>
      {backlinks.length === 0 ? (
        <div className="text-[13px] text-muted-foreground/70 italic">
          No notes link <span className="font-mono">[[{entity.name}]]</span> yet.
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {backlinks.map((b, i) => (
            <BacklinkRow
              key={`${b.workspaceId}:${b.path}:${i}`}
              backlink={b}
              trackedName={entity.name}
            />
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

function BacklinkRow({
  backlink,
  trackedName,
}: {
  backlink: Backlink
  trackedName: string
}) {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  const issueId = issueIdFromPath(backlink.path)
  const open = () => {
    if (issueId) {
      // Issue note opened from Tracked stays in the Tracked container: same
      // detail component, but Back returns to the entity/backlink context.
      setSidebar('tracked')
      openOrFocus({
        kind: 'tracked-issue-detail',
        params: { wsId: backlink.workspaceId, id: issueId },
      })
      return
    }
    // Plain note stays owned by Tracked. Preserve the selected entity so both
    // the page Back action and a copied/deep-linked URL return to the same
    // entity/backlink context instead of falling into System → Workspaces.
    setSidebar('tracked')
    openOrFocus({
      kind: 'file-viewer',
      params: {
        wsId: backlink.workspaceId,
        path: backlink.path,
        source: 'tracked',
        returnTrackedName: trackedName,
      },
    })
  }
  const Icon = issueId ? ListChecks : FileText
  const label = issueId ?? backlink.path
  return (
    <button
      type="button"
      onClick={open}
      title={issueId ? `Open issue ${issueId}` : `Open ${backlink.path}`}
      className="group flex min-h-10 items-start gap-2.5 rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-muted sm:items-center sm:py-2"
    >
      <Icon
        size={14}
        strokeWidth={1.75}
        className="mt-0.5 shrink-0 text-muted-foreground/70 transition-colors group-hover:text-primary sm:mt-0"
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block break-all font-mono text-[12px] leading-5 text-foreground sm:truncate sm:leading-normal">
          {label}
        </span>
        <span className="mt-0.5 block break-all text-[11px] text-muted-foreground/60 sm:hidden">
          {backlink.workspaceTag}
        </span>
      </span>
      <span className="hidden max-w-[35%] shrink-0 truncate text-[11px] text-muted-foreground/60 sm:block">
        {backlink.workspaceTag}
      </span>
    </button>
  )
}
