import { HelpCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChannels } from '../contexts/ChannelsContext'
import { useWorkspace } from '../tabs/store'
import { getFocusedTab } from '../tabs/types'
import { ChatChannelList } from './ChatChannelList'

/**
 * Traditional chat sidebar — legacy `/chat` channels backed by
 * OpenAlice's ChatHook (the pre-Workspace single-session AI surface).
 *
 * Kept around specifically because Telegram / MCP Ask / webhook
 * callbacks have no terminal to host a CLI in — those connector
 * surfaces still land here. Lives in the ActivityBar's Legacy section
 * because, for any user with a shell, Workspace chat is the
 * recommended path.
 */
export function TraditionalChatSidebar() {
  const { channels, openEditDialog, deleteChannel } = useChannels()
  const focused = useWorkspace((state) => getFocusedTab(state)?.spec)
  const focusedChannelId = focused?.kind === 'chat' ? focused.params.channelId : ''
  const openOrFocus = useWorkspace((state) => state.openOrFocus)

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto min-h-0">
        <div className="px-3 py-2 text-[11px] text-text-muted/70 leading-relaxed border-b border-border/40">
          Legacy single-session AI chat — kept for connector flows
          (Telegram, MCP Ask, webhook callbacks) that can't host a CLI.
          Use Workspace chat for everything else.
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
