import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, Hash, FileText, ListChecks, CircleAlert, List, Network, ArrowUpRight } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageLoading, Skeleton } from '../components/StateViews'
import { SegmentedControl } from '../components/SegmentedControl'
import { TrackedGraphView } from '../components/TrackedGraphView'
import { MarkdownContent } from '../components/MarkdownContent'
import { api } from '../api'
import { entitiesLive, refreshEntities } from '../live/entities'
import { useTrackedSelection } from '../live/tracked-selection'
import { useWorkspace } from '../tabs/store'
import { useIssues } from '../hooks/useIssues'
import { graphWithTrackedIssues, trackedIssueAnchors } from '../lib/tracked-issues'
import type { EntityDetail, Backlink, EntityGraph, EntityGraphArtifactNode } from '../api/entities'
import type { IssueDetail as IssueDetailData } from '../api/issues'

type TrackedViewMode = 'detail' | 'graph'

const TRACKED_VIEW_MODE_KEY = 'openalice.tracked.view-mode.v1'

function readTrackedViewMode(): TrackedViewMode {
  try {
    return window.localStorage.getItem(TRACKED_VIEW_MODE_KEY) === 'graph' ? 'graph' : 'detail'
  } catch {
    return 'detail'
  }
}

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
  const { data: issueSnapshot, error: issueListError, loading: issuesLoading } = useIssues()
  const issueAnchors = useMemo(() => trackedIssueAnchors(issueSnapshot), [issueSnapshot])
  const selectedName = useTrackedSelection((s) => s.selectedName)
  const selectedIssue = useTrackedSelection((s) => s.selectedIssue)
  const selectTracked = useTrackedSelection((s) => s.select)
  const selectTrackedIssue = useTrackedSelection((s) => s.selectIssue)
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const navigate = useNavigate()
  const [viewMode, setViewModeState] = useState<TrackedViewMode>(readTrackedViewMode)
  const [graph, setGraph] = useState<EntityGraph | null>(null)
  const [graphLoading, setGraphLoading] = useState(false)
  const [graphRequest, setGraphRequest] = useState(0)

  const selectEntity = useCallback((name: string) => {
    selectTracked(name)
    openOrFocus({ kind: 'tracked', params: { entity: name } })
  }, [openOrFocus, selectTracked])

  const selectIssue = useCallback((issue: { workspaceId: string; issueId: string }) => {
    selectTrackedIssue(issue)
    openOrFocus({
      kind: 'tracked',
      params: { workspace: issue.workspaceId, issue: issue.issueId },
    })
  }, [openOrFocus, selectTrackedIssue])

  const setViewMode = useCallback((mode: TrackedViewMode) => {
    setViewModeState(mode)
    try {
      window.localStorage.setItem(TRACKED_VIEW_MODE_KEY, mode)
    } catch {
      // View preference persistence is best-effort.
    }
  }, [])

  const [detail, setDetail] = useState<EntityDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState(false)
  const [detailRequest, setDetailRequest] = useState(0)
  useEffect(() => {
    if (viewMode !== 'detail' || !selectedName) {
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
  }, [selectedName, detailRequest, viewMode])

  const [issueDetail, setIssueDetail] = useState<IssueDetailData | null>(null)
  const [issueDetailLoading, setIssueDetailLoading] = useState(false)
  const [issueDetailError, setIssueDetailError] = useState(false)
  const [issueDetailRequest, setIssueDetailRequest] = useState(0)
  useEffect(() => {
    if (viewMode !== 'detail' || !selectedIssue) {
      setIssueDetail(null)
      setIssueDetailLoading(false)
      setIssueDetailError(false)
      return
    }
    let cancelled = false
    setIssueDetail(null)
    setIssueDetailLoading(true)
    setIssueDetailError(false)
    api.issues
      .getDetail(selectedIssue.workspaceId, selectedIssue.issueId)
      .then((next) => {
        if (cancelled) return
        setIssueDetail(next)
        setIssueDetailLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setIssueDetail(null)
        setIssueDetailLoading(false)
        setIssueDetailError(true)
      })
    return () => { cancelled = true }
  }, [issueDetailRequest, selectedIssue, viewMode])

  useEffect(() => {
    if (viewMode !== 'graph') return
    let cancelled = false
    setGraphLoading(true)
    api.entities
      .graph()
      .then((next) => {
        if (cancelled) return
        setGraph(next)
        setGraphLoading(false)
      })
      .catch(() => {
        if (cancelled) return
        setGraphLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [graphRequest, viewMode])

  const openArtifact = useOpenTrackedArtifact()
  const selectedIssueAnchor = selectedIssue
    ? issueAnchors.find((anchor) => anchor.workspaceId === selectedIssue.workspaceId && anchor.issue.id === selectedIssue.issueId)
    : null
  const graphWithIssues = useMemo(
    () => graph ? graphWithTrackedIssues(graph, issueAnchors) : null,
    [graph, issueAnchors],
  )
  const hasAnchors = entities.length > 0 || issueAnchors.length > 0

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <PageHeader
        title={t('nav.item.tracked')}
        description={t('tracked.pageDescription', { count: entities.length + issueAnchors.length })}
        right={(
          <SegmentedControl
            value={viewMode}
            onChange={setViewMode}
            ariaLabel={t('tracked.viewModeLabel')}
            compact
            options={[
              { value: 'detail', label: <span className="inline-flex items-center gap-1"><List size={11} />{t('tracked.detailView')}</span> },
              { value: 'graph', label: <span className="inline-flex items-center gap-1"><Network size={11} />{t('tracked.graphView')}</span> },
            ]}
          />
        )}
      />
      <div className={`flex-1 min-h-0 ${viewMode === 'graph' ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        {listError && entities.length > 0 && (
          <StaleCollectionNotice refreshing={refreshing} onRetry={refreshEntities} />
        )}
        {!hasAnchors && (loading || issuesLoading) ? (
          <TrackedListSkeleton />
        ) : !hasAnchors && (listError || issueListError) ? (
          <CollectionLoadError refreshing={refreshing} onRetry={refreshEntities} />
        ) : !hasAnchors ? (
          <EmptyState />
        ) : viewMode === 'graph' ? (
          graphLoading && !graphWithIssues ? (
            <PageLoading />
          ) : !graphWithIssues ? (
            <GraphLoadError onRetry={() => setGraphRequest((request) => request + 1)} />
          ) : (
            <TrackedGraphView
              graph={graphWithIssues}
              selectedName={selectedName}
              selectedIssue={selectedIssue}
              onSelectEntity={selectEntity}
              onSelectIssue={selectIssue}
              onOpenEntity={(name) => {
                selectEntity(name)
                setViewMode('detail')
              }}
              onOpenIssue={(issue) => {
                navigate(
                  `/issues/${encodeURIComponent(issue.workspaceId)}/${encodeURIComponent(issue.issueId)}`,
                )
              }}
              onOpenArtifact={openArtifact}
            />
          )
        ) : selectedIssue ? (
          issueDetailLoading ? (
            <PageLoading />
          ) : issueDetailError || !issueDetail ? (
            <DetailLoadError
              name={selectedIssueAnchor?.issue.title ?? selectedIssue.issueId}
              onRetry={() => setIssueDetailRequest((request) => request + 1)}
            />
          ) : (
            <IssueAnchorDetail
              detail={issueDetail}
              workspaceTag={selectedIssueAnchor?.workspaceTag ?? selectedIssue.workspaceId.slice(0, 8)}
              onOpenDetails={() => {
                navigate(
                  `/issues/${encodeURIComponent(selectedIssue.workspaceId)}/${encodeURIComponent(selectedIssue.issueId)}`,
                )
              }}
            />
          )
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

function GraphLoadError({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div role="alert" className="mx-auto flex max-w-[520px] flex-col items-center px-6 py-16 text-center">
      <CircleAlert size={24} strokeWidth={1.75} className="text-destructive" aria-hidden />
      <h2 className="mt-3 text-[15px] font-medium text-foreground">{t('tracked.graph.loadErrorTitle')}</h2>
      <p className="mt-1.5 text-[13px] leading-relaxed text-muted-foreground">{t('tracked.graph.loadErrorDescription')}</p>
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

function IssueAnchorDetail({
  detail,
  workspaceTag,
  onOpenDetails,
}: {
  detail: IssueDetailData
  workspaceTag: string
  onOpenDetails: () => void
}) {
  const { t } = useTranslation()
  const { issue } = detail
  const body = withoutDuplicateLeadingTitle(issue.what, issue.title)
  return (
    <div className="mx-auto max-w-[900px] px-4 py-6 md:px-8 md:py-8">
      <article className="overflow-hidden rounded-xl border border-border/80 bg-card/35 shadow-sm">
        <header className="border-b border-border/70 bg-secondary/20 px-5 py-5 md:px-7">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground shadow-sm">
              <ListChecks size={17} strokeWidth={1.8} aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="mb-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-medium text-muted-foreground">
                <span className="uppercase tracking-[0.14em]">{t('tracked.issue')}</span>
                <span className="text-border" aria-hidden>·</span>
                <span>{workspaceTag}</span>
                <span className="text-border" aria-hidden>·</span>
                <span className="font-mono">{issue.id}</span>
              </div>
              <h2 className="break-words text-[20px] font-semibold leading-snug tracking-[-0.01em] text-foreground md:text-[24px]">
                {issue.title}
              </h2>
              <div className="mt-3 flex flex-wrap gap-2">
                <IssueMetaPill>{t(`issues.status.${issue.status}`)}</IssueMetaPill>
                <IssueMetaPill>{t(`issues.priority.${issue.priority}`)}</IssueMetaPill>
              </div>
            </div>
            <button
              type="button"
              onClick={onOpenDetails}
              className="oa-pressable inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground shadow-sm transition-colors hover:border-primary/45 hover:bg-muted"
            >
              {t('tracked.openIssueDetails')}
              <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden />
            </button>
          </div>
        </header>
        <div className="px-5 py-6 md:px-7 md:py-7">
          <MarkdownContent
            text={body || t('tracked.issueNoDescription')}
            variant="reading"
            className="mx-auto max-w-[46rem]"
          />
        </div>
      </article>
    </div>
  )
}

function IssueMetaPill({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-border/80 bg-background/70 px-2.5 py-1 text-[11px] font-medium text-muted-foreground">
      {children}
    </span>
  )
}

/** Avoid repeating the Issue title when its Markdown document starts with it. */
function withoutDuplicateLeadingTitle(markdown: string, title: string): string {
  const lines = markdown.split(/\r?\n/)
  const firstContent = lines.findIndex((line) => line.trim().length > 0)
  if (firstContent < 0) return markdown
  const heading = lines[firstContent].trim().match(/^#{1,6}\s+(.+?)\s*#*$/)
  if (!heading || heading[1].trim().toLocaleLowerCase() !== title.trim().toLocaleLowerCase()) {
    return markdown
  }
  lines.splice(firstContent, 1)
  while (lines[firstContent]?.trim() === '') lines.splice(firstContent, 1)
  return lines.join('\n')
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

function useOpenTrackedArtifact() {
  const openOrFocus = useWorkspace((s) => s.openOrFocus)
  const setSidebar = useWorkspace((s) => s.setSidebar)
  return useCallback((artifact: Backlink | EntityGraphArtifactNode, trackedName: string) => {
    const issueId = issueIdFromPath(artifact.path)
    setSidebar('tracked')
    if (issueId) {
      openOrFocus({
        kind: 'tracked-issue-detail',
        params: { wsId: artifact.workspaceId, id: issueId },
      })
      return
    }
    openOrFocus({
      kind: 'file-viewer',
      params: {
        wsId: artifact.workspaceId,
        path: artifact.path,
        source: 'tracked',
        returnTrackedName: trackedName,
      },
    })
  }, [openOrFocus, setSidebar])
}

function BacklinkRow({
  backlink,
  trackedName,
}: {
  backlink: Backlink
  trackedName: string
}) {
  const openArtifact = useOpenTrackedArtifact()
  const issueId = issueIdFromPath(backlink.path)
  const open = () => openArtifact(backlink, trackedName)
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
