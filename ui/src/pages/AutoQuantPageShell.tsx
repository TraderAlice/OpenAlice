import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { ChatWorkspaceSection } from '../components/workspace/ChatWorkspaceSection'

export function AutoQuantPageShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  return (
    <PageSidebarLayout
      storageKey="auto-quant"
      title={t('nav.item.autoQuant')}
      defaultWidth={260}
      sidebar={({ closeMobileDrawer }) => (
        <ChatWorkspaceSection mode="auto-quant" onNavigate={closeMobileDrawer} />
      )}
    >
      {children}
    </PageSidebarLayout>
  )
}
