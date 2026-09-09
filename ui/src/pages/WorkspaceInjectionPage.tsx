import { StickerManager } from '../components/workspace-capabilities/StickerManager'
import { InjectionVersion, SkillProjectionBrowser } from '../components/workspace-capabilities/SkillProjectionBrowser'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '../components/PageHeader'
import { SettingsScrollArea } from '../components/form'
import { Button } from '../components/ui/button'
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '../components/ui/dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { useProjectInjection, injectionStatus, type InjectionWorkspace } from '../hooks/useProjectInjection'
import { WorkspaceTemplateUpgradePanel } from '../components/workspace/WorkspaceTemplateUpgradePanel'
import { RefreshCw } from 'lucide-react'

export function WorkspaceInjectionPage() {
  const { t } = useTranslation()
  const state = useProjectInjection()
  const [review, setReview] = useState<InjectionWorkspace | null>(null)
  const ready = state.data?.workspaces.filter((row) => ['update', 'record'].includes(injectionStatus(row))).length ?? 0
  return <div className="flex min-h-0 flex-1 flex-col">
    <PageHeader title={t('distribution.title')} />
    <SettingsScrollArea className="px-4 py-4 md:px-6">
      <div className="mx-auto max-w-[1100px] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
          <span className="flex flex-wrap items-center gap-2 text-muted-foreground">{t('skillManager.projectVersion')}{state.data && <InjectionVersion version={state.data.version} empty="—" />}</span>
          <Button size="icon" variant="ghost" aria-label={t('harnessSurface.refresh')} title={t('harnessSurface.refresh')} disabled={state.busy} onClick={state.refresh}><RefreshCw size={15} /></Button>
        </div>
        {state.error && <p role="alert">{state.error}</p>}
        {!state.data && !state.error && <p role="status">{t('common.loading')}</p>}
        {state.data && <>
          <Tabs defaultValue="skills">
            <TabsList><TabsTrigger value="skills">{t('distribution.workspaces')}</TabsTrigger><TabsTrigger value="project">{t('skillManager.prototype')}</TabsTrigger><TabsTrigger value="cli">CLI</TabsTrigger><TabsTrigger value="stickers">{t('stickers.title')}</TabsTrigger></TabsList>
            <TabsContent value="stickers" className="mt-4"><StickerManager /></TabsContent><TabsContent value="skills" className="mt-4"><SkillProjectionBrowser data={state.data} disabled={state.busy || !!state.error} onChange={state.refresh} />
              <details className="mt-6 border-t border-border pt-3"><summary className="cursor-pointer text-xs text-muted-foreground">{t('skillManager.bundleUpdates')}</summary>
              <div className="mt-4">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><p className="max-w-xl text-xs text-muted-foreground">{t('distribution.batchHint')}</p><Button disabled={state.busy || !!state.error || !ready} onClick={() => void state.updateReady()}>{state.busy ? t('common.loading') : t('distribution.updateReady', { count: ready })}</Button></div>
              {!state.data.workspaces.length && <p>{t('distribution.empty')}</p>}
              {state.data.workspaces.map((row) => <section key={row.id} className="border-t border-border py-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0"><h3 className="font-medium">{row.name || row.id}</h3><p className="mt-1 break-all text-xs text-muted-foreground">{row.template} · {row.plan?.fromVersion === 'unversioned' ? t('aliceHarness.unversioned') : row.plan?.fromVersion}</p></div>
                  <div className="flex items-center gap-3"><span className="text-xs text-muted-foreground">{t(`distribution.${injectionStatus(row)}`)}</span><Button variant="outline" disabled={state.busy || !row.plan || !!state.error} onClick={() => setReview(row)}>{t('distribution.review')}</Button></div>
                </div>
                {row.error && <p role="alert" className="mt-2 text-xs">{row.error}</p>}
                {state.results[row.id] && <p role="status" className="mt-2 text-xs">{state.results[row.id] === 'ok' ? t('distribution.updated') : state.results[row.id]}</p>}
              </section>)}
              </div></details>
            </TabsContent>
            <TabsContent value="project" className="mt-4"><SkillProjectionBrowser mode="project" data={state.data} disabled={state.busy} onChange={state.refresh} /></TabsContent>
            <TabsContent value="cli" className="mt-5"><p className="mb-4 text-sm text-muted-foreground">{t('distribution.cliHint')}</p>{Object.entries(state.data.commands).map(([binary, groups]) => <section className="border-t border-border py-4" key={binary}><h3 className="font-mono font-semibold">{binary}</h3>{Object.entries(groups).map(([group, verbs]) => <details className="py-2" key={group}><summary className="font-mono text-sm">{group} <span className="text-muted-foreground">{verbs.length}</span></summary><div className="mt-2 grid gap-2 pl-4 text-xs sm:grid-cols-2">{verbs.map((verb) => <code key={verb}>{binary} {group} {verb}</code>)}</div></details>)}</section>)}</TabsContent>
          </Tabs>
        </>}
      </div>
    </SettingsScrollArea>
    <Dialog open={!!review} onOpenChange={(open) => { if (!open) setReview(null) }}><DialogContent className="max-h-[90vh] overflow-auto sm:max-w-4xl" closeLabel={t('common.close')}><DialogTitle>{review?.name}</DialogTitle><DialogDescription>{t('distribution.reviewHint')}</DialogDescription>{review && <WorkspaceTemplateUpgradePanel key={review.id} wsId={review.id} layer="alice-harness" onWorkspaceChanged={state.refresh} onClose={() => setReview(null)} />}</DialogContent></Dialog>
  </div>
}
