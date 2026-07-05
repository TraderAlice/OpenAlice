import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { InboxSidebar, InboxViewToggle } from '../components/InboxSidebar'
import { PageSidebarLayout } from '../components/PageSidebarLayout'

interface InboxPageShellProps {
  children: ReactNode
}

export function InboxPageShell({ children }: InboxPageShellProps) {
  const { t } = useTranslation()
  return (
    <PageSidebarLayout
      storageKey="inbox"
      title={t('nav.item.inbox')}
      defaultWidth={260}
      actions={<InboxViewToggle />}
      sidebar={<InboxSidebar />}
    >
      {children}
    </PageSidebarLayout>
  )
}
