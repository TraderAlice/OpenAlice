import type { SessionStore } from '../../core/session.js'
import type { CompactionConfig } from '../../core/compaction.js'
import type { MediaAttachment } from '../../core/types.js'
import type { ClaudeCodeConfig } from './types.js'
import { toTextHistory } from '../../core/session.js'
import { compactIfNeeded } from '../../core/compaction.js'
import { extractMediaFromToolResultContent } from '../../core/media.js'
import { askClaudeCode } from './provider.js'

// ==================== Types ====================

export interface ClaudeCodeSessionConfig {
  /** Config passed through to askClaudeCode (allowedTools, disallowedTools, maxTurns, etc.). */
  claudeCode: ClaudeCodeConfig
  /** Compaction config for auto-summarization. */
  compaction: CompactionConfig
  /** Optional system prompt (passed to claude CLI --system-prompt). */
  systemPrompt?: string
  /** Max text history entries to include in <chat_history>. Default: 50. */
  maxHistoryEntries?: number
  /** Preamble text inside <chat_history> block. */
  historyPreamble?: string
}

export interface ClaudeCodeSessionResult {
  text: string
  media: MediaAttachment[]
}

// ==================== Default ====================

const DEFAULT_MAX_HISTORY = 50
const DEFAULT_PREAMBLE =
  'The following is the recent conversation history. Use it as context if it references earlier events or decisions.'

// ==================== Public ====================

/**
 * Call Claude Code CLI with full session management:
 * append user message → compact → build history prompt → call → persist messages.
 *
 * The raw `askClaudeCode` remains available for stateless one-shot calls (e.g. compaction callbacks).
 */
export async function askClaudeCodeWithSession(
  prompt: string,
  session: SessionStore,
  config: ClaudeCodeSessionConfig,
): Promise<ClaudeCodeSessionResult> {
  const maxHistory = config.maxHistoryEntries ?? DEFAULT_MAX_HISTORY
  const preamble = config.historyPreamble ?? DEFAULT_PREAMBLE

  // 1. Append user message to session
  await session.appendUser(prompt, 'human')

  // 2. Compact if needed (using askClaudeCode as summarizer)
  const compactionResult = await compactIfNeeded(
    session,
    config.compaction,
    async (summarizePrompt) => {
      const r = await askClaudeCode(summarizePrompt, {
        ...config.claudeCode,
        maxTurns: 1,
      })
      return r.text
    },
  )

  // 3. Read active window and build text history
  const entries = compactionResult.activeEntries ?? await session.readActive()
  const textHistory = toTextHistory(entries).slice(-maxHistory)

  // 4. Build full prompt with <chat_history> if history exists
  let fullPrompt: string
  if (textHistory.length > 0) {
    const lines = textHistory.map((entry) => {
      const tag = entry.role === 'user' ? 'User' : 'Bot'
      return `[${tag}] ${entry.text}`
    })
    fullPrompt = [
      '<chat_history>',
      preamble,
      '',
      ...lines,
      '</chat_history>',
      '',
      prompt,
    ].join('\n')
  } else {
    fullPrompt = prompt
  }

  // 5. Call askClaudeCode — collect media from tool results
  const media: MediaAttachment[] = []
  const result = await askClaudeCode(fullPrompt, {
    ...config.claudeCode,
    systemPrompt: config.systemPrompt,
    onToolResult: ({ content }) => {
      media.push(...extractMediaFromToolResultContent(content))
    },
  })

  // 6. Persist intermediate messages (tool calls + results) to session
  for (const msg of result.messages) {
    if (msg.role === 'assistant') {
      await session.appendAssistant(msg.content, 'claude-code')
    } else {
      await session.appendUser(msg.content, 'claude-code')
    }
  }

  // 7. Return unified result
  const prefix = result.ok ? '' : '[error] '
  return { text: prefix + result.text, media }
}
