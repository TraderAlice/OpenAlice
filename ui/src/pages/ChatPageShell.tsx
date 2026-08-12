import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { ChatChannelListContainer } from '../components/ChatChannelListContainer'
import {
  readChatDisplayMode,
  writeChatDisplayMode,
  type ChatDisplayMode,
} from '../components/workspace/chat-display-mode'

export type HarnessSidebarMode = 'chat' | 'auto-quant'

interface ChatPageShellProps {
  children: ReactNode
  mode?: HarnessSidebarMode
}

export function ChatPageShell({ children, mode = 'chat' }: ChatPageShellProps) {
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
        storageKey={mode === 'auto-quant' ? 'auto-quant' : 'chat'}
        title={t(mode === 'auto-quant' ? 'nav.item.autoQuant' : 'nav.item.chat')}
        defaultWidth={260}
        sidebar={({ closeMobileDrawer }) => (
          <ChatChannelListContainer
            mode={mode}
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
