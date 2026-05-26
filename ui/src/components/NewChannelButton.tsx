import { useChannels } from '../contexts/ChannelsContext'
import { useTranslation } from 'react-i18next'

/**
 * The "+" affordance in the chat section's secondary-sidebar header.
 * Clicking opens the new-channel dialog (managed via ChannelsContext).
 */
export function NewChannelButton() {
  const { openCreateDialog } = useChannels()
  const { t } = useTranslation()
  return (
    <button
      onClick={openCreateDialog}
      className="w-6 h-6 rounded flex items-center justify-center text-text-muted hover:text-text hover:bg-bg-tertiary/60 transition-colors"
      title={t('common.newChannel')}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
        <path d="M12 5v14M5 12h14" />
      </svg>
    </button>
  )
}
