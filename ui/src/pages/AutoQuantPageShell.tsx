import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { AutoQuantWorkspaceSection } from '../components/workspace/AutoQuantWorkspaceSection'
import { useWorkspaces } from '../contexts/workspaces-context'

export function AutoQuantPageShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const ctx = useWorkspaces()
  const ready = ctx.autoQuantPreferenceLoaded
    && ctx.hasLoaded
    && ctx.workspaces.some((workspace) =>
      workspace.id === ctx.autoQuantDefaultWorkspaceId
      && workspace.template === 'auto-quant-v2')
  if (!ready) return <>{children}</>

  return (
    <PageSidebarLayout
      storageKey="auto-quant"
      title={t('nav.item.autoQuant')}
      defaultWidth={260}
      sidebar={({ closeMobileDrawer }) => (
        <AutoQuantWorkspaceSection onNavigate={closeMobileDrawer} />
      )}
    >
      {children}
    </PageSidebarLayout>
  )
}
