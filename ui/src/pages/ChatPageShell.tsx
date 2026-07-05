import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { ChatChannelListContainer } from '../components/ChatChannelListContainer'

interface ChatPageShellProps {
  children: ReactNode
}

export function ChatPageShell({ children }: ChatPageShellProps) {
  const { t } = useTranslation()
  return (
    <PageSidebarLayout
      storageKey="chat"
      title={t('nav.item.chat')}
      defaultWidth={260}
      sidebar={<ChatChannelListContainer />}
    >
      {children}
    </PageSidebarLayout>
  )
}
