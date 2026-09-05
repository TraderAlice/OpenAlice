import { useCallback, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Folder, Layers, RefreshCw } from 'lucide-react'
import { PageTopBar } from '../components/PageTopBar'
import { FileContentView } from '../components/FileContentView'
import { MarkdownContent } from '../components/MarkdownContent'
import { Button } from '../components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { CenteredLoading } from '../components/StateViews'
import { workspaceDisplayName } from '../components/workspace/display'
import { useWorkspaceDetails } from '../hooks/useWorkspaceDetails'
import { useWorkspace } from '../tabs/store'
import type { ViewSpec } from '../tabs/types'

export function WorkspaceDetailsPage({ spec }: { spec: Extract<ViewSpec, { kind: 'workspace-details' }> }) {
  const { t, i18n } = useTranslation()
  const { wsId, source } = spec.params
  const details = useWorkspaceDetails(wsId, source)
  const openOrFocus = useWorkspace(s => s.openOrFocus)
  const { workspace, template, readme, guide } = details
  const resolveRelativeHref = useCallback((href: string) => {
    const file = new URL(href, 'https://workspace.invalid/')
    let path = file.pathname.slice(1)
    try { path = decodeURIComponent(path) } catch { /* A literal percent is a valid filename. */ }
    return `/${source}/workspaces/${encodeURIComponent(wsId)}/view/${encodeURIComponent(path)}`
  }, [source, wsId])
  const back = () => openOrFocus({
    kind: source === 'chat' ? 'chat-landing' : source === 'auto-quant' ? 'auto-quant-landing' : 'auto-prediction-landing',
    params: { targetWsId: wsId },
  })
  const retry = <Button size="sm" variant="outline" onClick={details.retryDocuments}>{t('common.retry')}</Button>
  const created = workspace ? new Date(workspace.createdAt) : null
  const baseline = workspace?.currentVersion ?? workspace?.spawnedFromVersion

  return (
    <div className="h-full min-w-0 overflow-y-auto">
      <PageTopBar title={t('workspaceDetails.title')} actions={
        <>
          <Button size="icon-sm" variant="ghost" aria-label={t('harnessSurface.refresh')} title={t('harnessSurface.refresh')} onClick={() => {
            details.retryDocuments()
            void details.refresh()
          }}><RefreshCw size={14} aria-hidden /></Button>
          <Button size="sm" variant="ghost" onClick={back}><ArrowLeft size={14} aria-hidden />{t('workspaceDetails.back')}</Button>
        </>
      } />
      {details.loading ? <CenteredLoading label={t('common.loading')} /> : !workspace ? (
        <div className="mx-auto max-w-3xl space-y-3 p-6" role="status">
          <p>{details.error || t('workspaceDetails.notFound')}</p>
          {details.error && <Button variant="outline" onClick={() => void details.refresh()}>{t('common.retry')}</Button>}
        </div>
      ) : (
        <div className="mx-auto w-full max-w-4xl space-y-7 px-4 py-6 sm:px-7 sm:py-8">
          <header className="flex items-start gap-3.5">
            <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><Folder size={21} aria-hidden /></span>
            <div className="min-w-0">
              <p className="text-caption mb-1 text-muted-foreground">{t(`office.harness.${source}`)} · Workspace</p>
              <h1 className="break-words text-xl font-semibold tracking-tight [overflow-wrap:anywhere]">{workspaceDisplayName(workspace)}</h1>
              {workspace.description && <p className="text-body mt-2 max-w-2xl leading-relaxed text-muted-foreground">{workspace.description}</p>}
            </div>
          </header>

          {workspace.metadataError && <p role="alert" className="text-body text-destructive">{workspace.metadataError}</p>}
          <dl className="grid grid-cols-2 gap-x-5 gap-y-4 border-y border-border py-5 sm:gap-x-8">
            <Metadata label={t('workspaceDetails.harness')}>{template?.displayName || workspace.template}</Metadata>
            <Metadata label={source === 'chat' ? t('chat.recentConversations') : source === 'auto-quant' ? t('autoQuant.recentResearch') : t('autoPrediction.recentResearch')}>{details.sessionCount ?? '—'}</Metadata>
            <Metadata label={t('workspaceDetails.created')}>{created && !Number.isNaN(created.getTime()) ? created.toLocaleDateString(i18n.language, { year: 'numeric', month: 'short', day: 'numeric' }) : '—'}</Metadata>
            {baseline && <Metadata label={t('workspaceDetails.baseline')}>v{baseline.replace(/^v/, '')}</Metadata>}
            {workspace.harnessSource && <Metadata label={t('workspaceDetails.sourceVersion')}>{workspace.harnessSource.version} · <span className="font-mono text-caption">{workspace.harnessSource.commit.slice(0, 12)}</span></Metadata>}
            {workspace.harnessSource && <Metadata label={t('workspaceDetails.repository')} wide>{workspace.harnessSource.repository}</Metadata>}
            <Metadata label={t('workspaceDetails.location')} wide><span className="font-mono text-caption">{workspace.dir}</span></Metadata>
          </dl>

          <Tabs defaultValue="workspace" key={wsId} className="min-w-0">
            <TabsList aria-label={t('workspaceDetails.documents')} className="mb-4 max-w-full">
              <TabsTrigger value="workspace" className="flex-none max-[380px]:px-2">{t('workspaceDetails.overview')}</TabsTrigger>
              <TabsTrigger value="guide" className="flex-none max-[380px]:px-2"><Layers size={14} className="shrink-0" aria-hidden />{t('workspaceDetails.guide')}</TabsTrigger>
            </TabsList>
            <TabsContent value="workspace" className="min-w-0 space-y-5">
              <p className="text-caption leading-relaxed text-muted-foreground">{t('workspaceDetails.overviewHint')}</p>
              {!readme ? <CenteredLoading label={t('common.loading')} /> : readme.kind === 'file_missing' ? (
                <p className="text-body rounded-lg bg-muted/40 p-5 leading-relaxed text-muted-foreground">{t('workspaceDetails.noReadme')}</p>
              ) : <div className="min-w-0 break-words [overflow-wrap:anywhere]"><FileContentView path="README.md" result={readme} resolveRelativeHref={resolveRelativeHref} /></div>}
              {readme?.kind === 'error' && retry}
            </TabsContent>
            <TabsContent value="guide" className="min-w-0 space-y-5">
              <p className="text-caption leading-relaxed text-muted-foreground">{t('workspaceDetails.guideHint')}{template?.version ? ` · v${template.version}` : ''}</p>
              {!guide ? <CenteredLoading label={t('common.loading')} /> : guide.error ? (
                <div role="alert" className="text-body space-y-3"><p>{guide.error}</p>{retry}</div>
              ) : guide.content ? (
                <div className="min-w-0 break-words [overflow-wrap:anywhere]"><MarkdownContent text={guide.content} variant="reading" /></div>
              ) : <p className="text-body text-muted-foreground">{t('workspaceDetails.noGuide')}</p>}
            </TabsContent>
          </Tabs>
        </div>
      )}
    </div>
  )
}

function Metadata({ label, children, wide }: { label: string; children: ReactNode; wide?: boolean }) {
  return <div className={`min-w-0 ${wide ? 'col-span-2' : ''}`}><dt className="text-caption mb-1 text-muted-foreground">{label}</dt><dd className="text-body break-words [overflow-wrap:anywhere]">{children}</dd></div>
}
