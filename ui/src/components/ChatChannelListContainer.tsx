import { Bell, HelpCircle } from 'lucide-react'
import { useChannels } from '../contexts/ChannelsContext'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { useUnreadNotificationsCount } from '../live/notifications-read'
import { ChatChannelList } from './ChatChannelList'
import { ChatWorkspaceSection } from './workspace/ChatWorkspaceSection'
import { SidebarRow } from './SidebarRow'

/**
 * Chat activity sidebar. Two conceptual sections:
 *
 *   - **Workspace chat** (recommended) — chat-template workspaces, each
 *     wrapping a native CLI session (claude / codex / shell). Native
 *     prompt cache + native frontend; the path most users should default
 *     to. See README "Two kinds of chat".
 *   - **Traditional chat** — the original /chat channels backed by
 *     OpenAlice's ChatHook. Required for connectors (Telegram / MCP Ask
 *     / webhook) which have no PTY to host a CLI in.
 *
 * Above both: Notifications — a system-push surface that shares this
 * sidebar because the unifying mental model is "everything Alice-shaped".
 *
 * Active row tracking is derived from the focused tab — switching tabs
 * naturally shifts the highlight without bespoke wiring.
 */
export function ChatChannelListContainer() {
  const { channels, openEditDialog, deleteChannel } = useChannels()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const focusedKind = focused?.kind
  const focusedChannelId = focusedKind === 'chat' ? focused.params.channelId : ''
  const inboxActive = focusedKind === 'notifications-inbox'
  const openOrFocus = useWorkspace((state) => state.openOrFocus)
  const unreadCount = useUnreadNotificationsCount()

  return (
    <div className="flex flex-col h-full">
      <div className="py-0.5 space-y-0.5">
        <SidebarRow
          label={
            <span className="flex items-center gap-2">
              <Bell size={14} strokeWidth={1.8} className="shrink-0" />
              <span>Notifications</span>
            </span>
          }
          active={inboxActive}
          onClick={() => openOrFocus({ kind: 'notifications-inbox', params: {} })}
          trail={
            unreadCount > 0 ? (
              <span
                className="min-w-[16px] h-[16px] px-1 rounded-full bg-red text-[10px] font-semibold text-white tabular-nums flex items-center justify-center"
                aria-label={`${unreadCount} unread`}
              >
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            ) : undefined
          }
        />
      </div>

      <div className="flex-1 overflow-y-auto min-h-0">
        <ChatWorkspaceSection />

        <div className="px-3 mt-3 text-[10px] font-medium text-text-muted/60 uppercase tracking-wider">
          Traditional
        </div>
        <div className="mt-0.5">
          <ChatChannelList
            channels={channels}
            activeChannel={focusedChannelId}
            onSelect={(id) => openOrFocus({ kind: 'chat', params: { channelId: id } })}
            onEdit={openEditDialog}
            onDelete={deleteChannel}
          />
        </div>

        <a
          href="https://github.com/TraderAlice/OpenAlice#two-kinds-of-chat"
          target="_blank"
          rel="noreferrer"
          className="mx-3 my-3 flex items-center gap-1.5 text-[11px] text-text-muted/70 hover:text-text transition-colors"
          title="Open README — Two kinds of chat"
        >
          <HelpCircle size={11} strokeWidth={2} aria-hidden="true" />
          <span>Why two kinds of chat?</span>
        </a>
      </div>
    </div>
  )
}
