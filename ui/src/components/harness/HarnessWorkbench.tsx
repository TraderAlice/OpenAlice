import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PanelRightClose, Plus, X, Folder, PanelsTopLeft, Globe } from 'lucide-react'
import { usePanelRef } from 'react-resizable-panels'
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from '../ui/resizable'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../ui/tabs'
import { Button } from '../ui/button'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '../ui/dropdown-menu'
import { useHarnessWorkbench, emptyWorkbench, type WorkTab } from '../../live/harness-workbench'
import { HarnessWorkbenchContext } from './context'
import { BrowserPane } from './BrowserPane'
import { FilesPanel } from '../workspace/FilesPanel'
import { FileContentView } from '../FileContentView'
import { useWorkspaceSessionData } from '../../hooks/useWorkspaceData'
import { useWorkspaces } from '../../contexts/workspaces-context'
import { agentSupportsWeb, workspaceContentHref } from '../workspace/api'
import { useWorkbenchFile } from '../../hooks/useWorkbenchFile'
import { HarnessSurfacePage } from '../../pages/HarnessSurfacePage'
import { PageContentLayout } from '../PageTopBar'
import { WorkspacePage } from '../../pages/WorkspacePage'
import type { ViewSpec, WorkspaceSource } from '../../tabs/types'
import './workbench.css'

export function HarnessWorkbench({ spec, source, children, title = 'Conversation' }: { spec: ViewSpec; source: WorkspaceSource; children: ReactNode; title?: string }) {
  const wsId = 'wsId' in spec.params ? spec.params.wsId : 'targetWsId' in spec.params ? spec.params.targetWsId : undefined
  if (!wsId) return <PageContentLayout title={title}>{children}</PageContentLayout>
  return <WorkspaceWorkbench wsId={wsId} spec={spec} source={source} title={title}>{children}</WorkspaceWorkbench>
}

function WorkspaceWorkbench({ wsId, spec, source, children, title }: { wsId: string; spec: ViewSpec; source: WorkspaceSource; children: ReactNode; title: string }) {
  const { t } = useTranslation()
  const states = useHarnessWorkbench((s) => s.workspaces)
  const patch = useHarnessWorkbench((s) => s.patch)
  const openTab = useHarnessWorkbench((s) => s.openTab)
  const state = states[wsId] ?? emptyWorkbench
  const panel = usePanelRef()
  const motionRoot = useRef<HTMLDivElement>(null)
  const previousDisclosure = useRef({ wsId, open: state.open })
  // A Workspace stays in this Harness shell while its Session child changes.
  const seen = useRef(new Map<string, WorkspaceSource>())
  seen.current.set(wsId, source)
  useEffect(() => {
    if (spec.kind === 'workspace' && spec.params.sessionId) patch(wsId, { sessionId: spec.params.sessionId })
    if (spec.kind === 'harness-surface') openTab(wsId, { kind: 'studio', id: 'studio' })
  }, [wsId, spec, patch, openTab])
  useLayoutEffect(() => {
    const root = motionRoot.current
    const previous = previousDisclosure.current
    const animate = previous.wsId === wsId && previous.open !== state.open
    previousDisclosure.current = { wsId, open: state.open }
    root?.style.setProperty('--work-motion-width', `${state.open ? (root.clientWidth * state.width / 100) : panel.current?.getSize().inPixels ?? 0}px`)
    root?.classList.toggle('is-disclosing', animate)
    if (state.open) panel.current?.resize(`${state.width}%`)
    else panel.current?.collapse()
    const timer = window.setTimeout(() => root?.classList.remove('is-disclosing'), 280)
    return () => window.clearTimeout(timer)
  }, [wsId, state.open, panel])
  const toggle = () => {
    if (state.open) patch(wsId, { open: false })
    else if (state.tabs.length) patch(wsId, { open: true })
    else openTab(wsId, { kind: 'files', id: 'files' })
  }
  const conversation = spec.kind === 'harness-surface'
    ? <WorkspacePage spec={{ kind: 'workspace', params: { wsId, source, ...(state.sessionId ? { sessionId: state.sessionId } : {}) } }} visible />
    : children
  return <HarnessWorkbenchContext.Provider value={{ wsId, open: state.open, toggle }}>
    <div ref={motionRoot} className={`harness-workbench ${state.open ? 'is-open' : ''}`}>
      <ResizablePanelGroup orientation="horizontal" onLayoutChanged={(layout) => {
        const width = layout['work']
        if (state.open && width && width >= 25 && Math.abs(width - state.width) > 0.2) patch(wsId, { width })
      }}>
        <ResizablePanel id="conversation" minSize="25%" className="harness-conversation">
          <PageContentLayout title={title}>{conversation}</PageContentLayout>
        </ResizablePanel>
        <ResizableHandle className={state.open ? 'harness-divider' : 'hidden'} aria-label={t('workbench.resize', { defaultValue: 'Resize work panel' })} />
        <ResizablePanel id="work" panelRef={panel} collapsible collapsedSize={0} minSize="25%" maxSize="75%" defaultSize={state.open ? `${state.width}%` : 0} className="harness-work" style={{ overflow: 'hidden' }}>
          <div className="harness-work-inner" inert={!state.open} aria-hidden={!state.open}>
            {[...seen.current].map(([id, owner]) => <div key={id} hidden={id !== wsId} className="h-full min-h-0">
              <WorkPanel wsId={id} source={owner} onCollapse={() => {
                patch(wsId, { open: false })
                requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-view-visible="true"] .workspace-files-toggle')?.focus())
              }} />
            </div>)}
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </HarnessWorkbenchContext.Provider>
}

function WorkPanel({ wsId, source, onCollapse }: { wsId: string; source: WorkspaceSource; onCollapse(): void }) {
  const { t } = useTranslation()
  const state = useHarnessWorkbench((s) => s.workspaces[wsId] ?? emptyWorkbench)
  const { patch, openTab, closeTab } = useHarnessWorkbench.getState()
  const ctx = useWorkspaces()
  const { session } = useWorkspaceSessionData(wsId, state.sessionId ?? null)
  const canSwitch = session?.state === 'running' && agentSupportsWeb(ctx.agents, session.agent)
  const label = (tab: WorkTab) => tab.kind === 'file' ? tab.path.split('/').at(-1)! : tab.kind === 'files' ? t('workspace.files') : tab.kind === 'browser' ? tab.title || t('workbench.browser') : t('harnessSurface.studio')
  return <Tabs value={state.active ?? ''} onValueChange={(value) => patch(wsId, { active: String(value) })} className="harness-work-tabs">
    <div className="harness-work-toolbar">
      <TabsList aria-label={t('workbench.tabs', { defaultValue: 'Work panel tabs' })} className="harness-work-tablist">
        {state.tabs.map((tab) => <div key={tab.id} className={`harness-tab-item ${state.active === tab.id ? 'is-active' : ''}`}>
          <TabsTrigger value={tab.id} className="harness-work-tab" title={tab.kind === 'file' ? tab.path : label(tab)}>{label(tab)}</TabsTrigger>
          <Button variant="ghost" size="icon" className="harness-tab-close" onClick={() => closeTab(wsId, tab.id)} aria-label={t('workbench.closeNamed', { name: label(tab) })}><X className="size-3.5" /></Button>
        </div>)}
      </TabsList>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={t('workbench.add', { defaultValue: 'Open in work panel' })}><Plus size={16} /></Button>} />
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openTab(wsId, { kind: 'browser', id: `browser:${Date.now()}-${Math.random().toString(36).slice(2)}` })}><Globe size={14} />{t('workbench.browser')}</DropdownMenuItem>
          <DropdownMenuItem onClick={() => openTab(wsId, { kind: 'files', id: 'files' })}><Folder size={14} />{t('workspace.files')}</DropdownMenuItem>
          {source !== 'chat' && <DropdownMenuItem onClick={() => openTab(wsId, { kind: 'studio', id: 'studio' })}><PanelsTopLeft size={14} />{t('harnessSurface.studio')}</DropdownMenuItem>}
          {canSwitch && session && <DropdownMenuItem onClick={() => {
            if (session.surface === 'webpi') void ctx.resumeSession(wsId, session.id, source)
            else void ctx.openWebSession(wsId, session.id, source)
          }}>{session.surface === 'webpi' ? 'Open TUI' : 'Web Beta'}</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button variant="ghost" size="icon" className="harness-work-collapse" onClick={onCollapse} aria-label={t('workbench.collapse', { defaultValue: 'Return to conversation / collapse panel' })}><PanelRightClose size={16} /></Button>
    </div>
    {state.tabs.map((tab) => <TabsContent key={tab.id} value={tab.id} keepMounted className="harness-work-content">
      {tab.kind === 'files' ? <FilesPanel embedded wsId={wsId} sessionId={state.sessionId ?? null} source={source} onOpenFile={(path) => openTab(wsId, { id: `file:${path}`, kind: 'file', path })} />
        : tab.kind === 'browser' ? <BrowserPane title={label(tab)} onNavigate={(url) => {
            const current = useHarnessWorkbench.getState().workspaces[wsId]
            if (current) patch(wsId, { tabs: current.tabs.map((item) => item.id === tab.id ? { ...item, title: new URL(url).host } : item) })
          }} />
        : tab.kind === 'studio' && source !== 'chat' ? <HarnessSurfacePage workspaceId={wsId} source={source} embedded />
          : tab.kind === 'file' ? <WorkFile key={`${tab.id}:${tab.revision ?? 0}`} wsId={wsId} path={tab.path} /> : null}
    </TabsContent>)}
  </Tabs>
}
function WorkFile({ wsId, path }: { wsId: string; path: string }) {
  const href = workspaceContentHref(wsId, path)
  if (/\.(png|jpe?g|gif|webp)$/i.test(path)) return <div className="h-full overflow-auto p-5"><img src={href} alt={path} className="max-w-full h-auto" /><a href={href} download className="block mt-4 text-sm underline">{path}</a></div>
  if (/\.pdf$/i.test(path)) return <iframe src={href} title={path} className="h-full w-full border-0" />
  if (/\.[^/.]+$/.test(path) && !/\.(md|markdown|html?|txt|log|csv|json|ya?ml|toml|ini|conf|cfg|env|ts|tsx|js|jsx|mjs|cjs|css|scss|sql|py|rb|rs|go|java|c|cpp|h|sh|bash|zsh|xml|svg)$/i.test(path)) return <a href={href} download className="block p-5 underline">Download {path}</a>
  return <WorkTextFile wsId={wsId} path={path} />
}
function WorkTextFile({ wsId, path }: { wsId: string; path: string }) {
  const result = useWorkbenchFile(wsId, path)
  return <div className="h-full overflow-auto p-5"><div className="mb-5 break-all text-xs text-muted-foreground">{path}</div>{result ? <FileContentView path={path} result={result} /> : <div role="status">Loading…</div>}</div>
}
