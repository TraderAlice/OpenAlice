import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'

type NavTitleKey =
  | 'nav.item.tracked'
  | 'nav.item.workspaces'
  | 'nav.item.tradingAsGit'
  | 'nav.item.settings'
  | 'nav.item.dev'
  | 'nav.item.market'
  | 'nav.item.portfolio'
  | 'nav.item.automation'

interface PageSidebarShellProps {
  storageKey: string
  titleKey: NavTitleKey
  defaultWidth: number
  sidebar: ReactNode
  actions?: ReactNode
  children: ReactNode
}

export function PageSidebarShell({
  storageKey,
  titleKey,
  defaultWidth,
  sidebar,
  actions,
  children,
}: PageSidebarShellProps) {
  const { t } = useTranslation()
  return (
    <PageSidebarLayout
      storageKey={storageKey}
      title={t(titleKey)}
      defaultWidth={defaultWidth}
      actions={actions}
      sidebar={sidebar}
    >
      {children}
    </PageSidebarLayout>
  )
}
