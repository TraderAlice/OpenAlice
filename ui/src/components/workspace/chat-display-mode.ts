export type ChatDisplayMode = 'focused' | 'recent' | 'multi'

export const CHAT_DISPLAY_MODE_STORAGE_KEY = 'openalice.chat-sidebar-display-mode.v1'

export function readChatDisplayMode(): ChatDisplayMode {
  if (typeof window === 'undefined') return 'focused'
  try {
    const stored = window.localStorage.getItem(CHAT_DISPLAY_MODE_STORAGE_KEY)
    return stored === 'recent' || stored === 'multi' ? stored : 'focused'
  } catch {
    return 'focused'
  }
}

export function writeChatDisplayMode(mode: ChatDisplayMode): void {
  try {
    window.localStorage.setItem(CHAT_DISPLAY_MODE_STORAGE_KEY, mode)
  } catch {
    // A blocked preference store should not make the navigator unusable.
  }
}
