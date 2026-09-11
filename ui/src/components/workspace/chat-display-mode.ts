export type ChatDisplayMode = 'focused' | 'recent' | 'multi'

export const CHAT_DISPLAY_MODE_STORAGE_KEY = 'openalice.chat-sidebar-display-mode.v1'
export const AUTO_QUANT_DISPLAY_MODE_STORAGE_KEY = 'openalice.auto-quant-sidebar-display-mode.v1'
export const AUTO_PREDICTION_DISPLAY_MODE_STORAGE_KEY = 'openalice.auto-prediction-sidebar-display-mode.v1'

export function readChatDisplayMode(
  storageKey = CHAT_DISPLAY_MODE_STORAGE_KEY,
): ChatDisplayMode {
  if (typeof window === 'undefined') return 'focused'
  try {
    const stored = window.localStorage.getItem(storageKey)
    return stored === 'recent' || stored === 'multi' ? stored : 'focused'
  } catch {
    return 'focused'
  }
}

export function writeChatDisplayMode(
  mode: ChatDisplayMode,
  storageKey = CHAT_DISPLAY_MODE_STORAGE_KEY,
): void {
  try {
    window.localStorage.setItem(storageKey, mode)
  } catch {
    // A blocked preference store should not make the navigator unusable.
  }
}
