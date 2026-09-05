import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useWorkspaces } from '../contexts/workspaces-context'
import { CenteredLoading } from '../components/StateViews'
import { Button } from '../components/ui/button'
import { useWorkspace } from './store'
import type { ViewSpec, WorkspaceSource } from './types'

const harnessForTemplate: Record<string, WorkspaceSource | undefined> = {
  chat: 'chat', 'auto-quant-v2': 'auto-quant', 'auto-prediction': 'prediction',
}

/** Resolve old/unspecified destinations without ever mounting a global desk.
 * Membership comes from Workspace metadata, never from its tag or Session id. */
export function WorkspaceHarnessRedirect({ spec }: {
  spec: Extract<ViewSpec, { kind: 'workspace' | 'file-viewer' }>
}) {
  const { t } = useTranslation()
  const { workspaces, hasLoaded, listError, refresh } = useWorkspaces()
  const openOrFocus = useWorkspace(s => s.openOrFocus)
  const setSidebar = useWorkspace(s => s.setSidebar)
  const workspace = workspaces.find(w => w.id === spec.params.wsId)
  const source = workspace?.template ? harnessForTemplate[workspace.template] : undefined
  useEffect(() => {
    if (!source) return
    setSidebar(source)
    openOrFocus(spec.kind === 'workspace'
      ? { kind: 'workspace', params: { ...spec.params, source } }
      : { kind: 'file-viewer', params: { ...spec.params, source } })
  }, [source, spec, openOrFocus, setSidebar])

  if (source || (!hasLoaded && !listError)) return <CenteredLoading label={t('common.loading')} />
  return <div className="space-y-3 p-6" role="status">
    <p className="text-body text-muted-foreground">{listError || t('workspaceDetails.notFound')}</p>
    {listError && <Button variant="outline" onClick={() => void refresh()}>{t('common.retry')}</Button>}
    <Button variant="outline" onClick={() => {
      setSidebar('chat')
      openOrFocus({ kind: 'chat-landing', params: {} })
    }}>{t('workspaceDetails.back')}</Button>
  </div>
}
