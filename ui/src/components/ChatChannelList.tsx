import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, X } from 'lucide-react'
import type { ChannelListItem } from '../api/channels'
import { SidebarRow } from './SidebarRow'
import { ConfirmDialog } from './ConfirmDialog'

interface ChatChannelListProps {
  channels: ChannelListItem[]
  activeChannel: string
  onSelect: (id: string) => void
  onEdit: (channel: ChannelListItem) => void
  onDelete: (id: string) => Promise<void>
}

export function ChatChannelList({
  channels,
  activeChannel,
  onSelect,
  onEdit,
  onDelete,
}: ChatChannelListProps) {
  const { t } = useTranslation()
  // Channel pending delete confirmation. Tiny × buttons in a sidebar are
  // easy to mis-click — the dialog forces an explicit yes.
  const [pendingDelete, setPendingDelete] = useState<ChannelListItem | null>(null)

  const handleConfirmDelete = async () => {
    if (!pendingDelete) return
    try {
      await onDelete(pendingDelete.id)
    } finally {
      setPendingDelete(null)
    }
  }

  return (
    <>
      <div className="py-0.5">
        {channels.map((ch) => {
          // 'default' is editable but not deletable — it's the connector's
          // default-session pointer and must keep existing.
          const deletable = ch.id !== 'default'
          return (
            <SidebarRow
              key={ch.id}
              label={
                <>
                  <span className="text-text-muted/60 mr-0.5">#</span>
                  {ch.label}
                </>
              }
              active={activeChannel === ch.id}
              onClick={() => onSelect(ch.id)}
              trail={
                <span className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); onEdit(ch) }}
                    className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-secondary"
                    title="Settings"
                  >
                    <SettingsIcon size={12} strokeWidth={2} />
                  </button>
                  {deletable && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setPendingDelete(ch) }}
                      className="w-5 h-5 rounded flex items-center justify-center text-text-muted hover:text-red hover:bg-red/10"
                      title={t('common.delete')}
                    >
                      <X size={12} strokeWidth={2.5} />
                    </button>
                  )}
                </span>
              }
            />
          )
        })}

        {channels.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-text-muted/60">Loading…</p>
        )}
      </div>

      {pendingDelete && (
        <ConfirmDialog
          title="Delete channel"
          message={
            <>
              Delete channel <span className="font-mono text-text">#{pendingDelete.label}</span>?
              The session history stays on disk, but the channel will disappear from the sidebar
              and any open tab for it will close. This can&apos;t be undone from the UI.
            </>
          }
          confirmLabel="Delete"
          onConfirm={handleConfirmDelete}
          onClose={() => setPendingDelete(null)}
        />
      )}
    </>
  )
}
