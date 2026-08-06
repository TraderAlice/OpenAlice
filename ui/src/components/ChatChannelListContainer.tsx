import { ChatWorkspaceSection } from './workspace/ChatWorkspaceSection'
import type { ChatDisplayMode } from './workspace/chat-display-mode'

/**
 * Chat activity sidebar — **workspace chat only**.
 *
 * Mental model: Workspace is the atom for any unit of work; "Chat" is
 * the top-level shortcut for the chat-shape Workspace subset. Clicking
 * the Chat icon in the ActivityBar lands here, where the user sees
 * chat-template workspaces (each one is its own conversation thread
 * with `claude` / `codex` / `shell`).
 *
 * Traditional `/chat` channels and the legacy NotificationsStore inbox
 * have moved to the Legacy section of the ActivityBar — they're
 * pre-Workspace artifacts that don't share this surface anymore.
 */
export function ChatChannelListContainer({
  onNavigate,
  displayMode,
  onRequestDisplayMode,
}: {
  onNavigate?: () => void
  displayMode: ChatDisplayMode
  onRequestDisplayMode: (mode: ChatDisplayMode) => void
}) {
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatWorkspaceSection
        onNavigate={onNavigate}
        displayMode={displayMode}
        onRequestDisplayMode={onRequestDisplayMode}
      />
    </div>
  )
}
