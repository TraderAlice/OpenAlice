import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { PageSidebarLayout } from '../components/PageSidebarLayout'
import { ChatChannelListContainer } from '../components/ChatChannelListContainer'
import {
  AUTO_QUANT_DISPLAY_MODE_STORAGE_KEY,
  CHAT_DISPLAY_MODE_STORAGE_KEY,
  readChatDisplayMode,
  writeChatDisplayMode,
  type ChatDisplayMode,
} from '../components/workspace/chat-display-mode'
import { useWorkspaces } from '../contexts/workspaces-context'

export type HarnessSidebarMode = 'chat' | 'auto-quant'

interface ChatPageShellProps {
  children: ReactNode
  mode?: HarnessSidebarMode
}

export function ChatPageShell({ children, mode = 'chat' }: ChatPageShellProps) {
  if (mode === 'auto-quant') {
    return <AutoQuantReadyShell>{children}</AutoQuantReadyShell>
  }
  return <HarnessPageShell mode="chat">{children}</HarnessPageShell>
}

function AutoQuantReadyShell({ children }: { children: ReactNode }) {
  const ctx = useWorkspaces()
  const ready = ctx.autoQuantPreferenceLoaded
    && ctx.hasLoaded
    && ctx.workspaces.some((workspace) =>
      workspace.id === ctx.autoQuantDefaultWorkspaceId
      && workspace.template === 'auto-quant-v2')

  // AutoQuant owns an explicit readiness boundary: initialization or a
  // deliberate existing-desk choice must establish the default before any
  // research navigation is exposed. The shared chrome begins only afterward.
  if (!ready) return <>{children}</>
  return <HarnessPageShell mode="auto-quant">{children}</HarnessPageShell>
}

function HarnessPageShell({ children, mode }: { children: ReactNode; mode: HarnessSidebarMode }) {
  const { t } = useTranslation()
  const displayModeStorageKey = mode === 'auto-quant'
    ? AUTO_QUANT_DISPLAY_MODE_STORAGE_KEY
    : CHAT_DISPLAY_MODE_STORAGE_KEY
  const [displayMode, setDisplayMode] = useState<ChatDisplayMode>(() =>
    readChatDisplayMode(displayModeStorageKey))

  const requestDisplayMode = (next: ChatDisplayMode) => {
    if (next === displayMode) return
    setDisplayMode(next)
    writeChatDisplayMode(next, displayModeStorageKey)
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
