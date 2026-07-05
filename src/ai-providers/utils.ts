/**
 * Shared utilities used across AI providers and AgentCenter.
 */

// ==================== Strip Image Data ====================

/** Strip base64 image data from tool_result content before persisting to session. */
export function stripImageData(raw: string): string {
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return raw
    let changed = false
    const cleaned = parsed.map((item: Record<string, unknown>) => {
      if (item.type === 'image' && (item.source as Record<string, unknown>)?.data) {
        changed = true
        return { type: 'text', text: '[Image saved to disk — use Read tool to view the file]' }
      }
      return item
    })
    return changed ? JSON.stringify(cleaned) : raw
  } catch { return raw }
}

// ==================== Chat History Prompt ====================

export interface TextHistoryEntry {
  role: 'user' | 'assistant'
  text: string
}

const DEFAULT_PREAMBLE =
  'The following is the recent conversation history. Use it as context if it references earlier events or decisions.'

/**
 * Build a full prompt with `<chat_history>` block prepended.
 * Used by text-based providers (Claude Code CLI, Agent SDK) that receive
 * a single string prompt rather than structured ModelMessage[].
 */
export function buildChatHistoryPrompt(
  prompt: string,
  textHistory: TextHistoryEntry[],
  preamble?: string,
): string {
  if (textHistory.length === 0) return prompt

  const lines = textHistory.map((entry) => {
    const tag = entry.role === 'user' ? 'User' : 'Bot'
    return `[${tag}] ${entry.text}`
  })
  return [
    '<chat_history>',
    preamble ?? DEFAULT_PREAMBLE,
    '',
    ...lines,
    '</chat_history>',
    '',
    prompt,
  ].join('\n')
}

/** Default max history entries for text-based providers. */
export const DEFAULT_MAX_HISTORY = 50

// ==================== Tool Call Logging ====================

/** Log a tool call with a short input preview. */
export function logToolCall(name: string, input: unknown) {
  const preview = JSON.stringify(input).slice(0, 120)
  console.log(`  ↳ ${name}(${preview})`)
}
