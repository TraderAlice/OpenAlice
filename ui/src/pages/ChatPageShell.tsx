import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { ChatChannelListContainer } from '../components/ChatChannelListContainer'
import {
  readChatDisplayMode,
  writeChatDisplayMode,
  type ChatDisplayMode,
} from '../components/workspace/chat-display-mode'

interface ChatPageShellProps {
  children: ReactNode
}

export function ChatPageShell({ children }: ChatPageShellProps) {
  const { t } = useTranslation()
  const [displayMode, setDisplayMode] = useState<ChatDisplayMode>(() => readChatDisplayMode())

  const requestDisplayMode = (next: ChatDisplayMode) => {
    if (next === displayMode) return
    setDisplayMode(next)
    writeChatDisplayMode(next)
  }

  return (
    <>
      <PageSidebarLayout
        storageKey="chat"
        title={t('nav.item.chat')}
        defaultWidth={260}
        sidebar={({ closeMobileDrawer }) => (
          <ChatChannelListContainer
            onNavigate={closeMobileDrawer}
            displayMode={displayMode}
            onRequestDisplayMode={requestDisplayMode}
          />
        )}
      >
        {children}
      </PageSidebarLayout>

    </>
  )
}
