import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Focus, PanelsTopLeft } from 'lucide-react'
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
        actions={({ closeMobileDrawer }) => (
          <div
            role="group"
            aria-label={t('chat.displayModeLabel')}
            className="mr-0.5 flex items-center rounded-md bg-muted/70 p-0.5"
          >
            <button
              type="button"
              onClick={() => requestDisplayMode('focused', closeMobileDrawer)}
              aria-pressed={displayMode === 'focused'}
              aria-label={t('chat.focusedMode')}
              title={t('chat.focusedModeDescription')}
              className={`oa-icon-action flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground ${
                displayMode === 'focused' ? 'bg-background text-foreground shadow-sm' : ''
              }`}
            >
              <Focus size={13} strokeWidth={2} aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => requestDisplayMode('multi', closeMobileDrawer)}
              aria-pressed={displayMode === 'multi'}
              aria-label={t('chat.multiMode')}
              title={t('chat.multiModeDescription')}
              className={`oa-icon-action flex h-6 w-6 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground ${
                displayMode === 'multi' ? 'bg-background text-foreground shadow-sm' : ''
              }`}
            >
              <PanelsTopLeft size={13} strokeWidth={2} aria-hidden />
            </button>
          </div>
        )}
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
