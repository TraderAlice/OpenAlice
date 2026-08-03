import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { ChatChannelListContainer } from '../components/ChatChannelListContainer'
import { ConfirmDialog } from '../components/ConfirmDialog'
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
  const [showMultiConfirm, setShowMultiConfirm] = useState(false)

  const activateDisplayMode = (next: ChatDisplayMode) => {
    setDisplayMode(next)
    writeChatDisplayMode(next)
  }

  const requestDisplayMode = (next: ChatDisplayMode, closeMobileDrawer: () => void) => {
    if (next === displayMode) return
    closeMobileDrawer()
    if (next === 'multi') {
      setShowMultiConfirm(true)
      return
    }
    activateDisplayMode(next)
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
            onRequestDisplayMode={(next) => requestDisplayMode(next, closeMobileDrawer)}
          />
        )}
      >
        {children}
      </PageSidebarLayout>

      {showMultiConfirm && (
        <ConfirmDialog
          title={t('chat.multiModeDialogTitle')}
          message={t('chat.multiModeDialogMessage')}
          confirmLabel={t('chat.multiModeDialogConfirm')}
          cancelLabel={t('common.cancel')}
          variant="primary"
          onConfirm={() => {
            activateDisplayMode('multi')
            setShowMultiConfirm(false)
          }}
          onClose={() => setShowMultiConfirm(false)}
        />
      )}
    </>
  )
}
